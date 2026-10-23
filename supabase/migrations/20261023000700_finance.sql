-- Finance: ride payment records (cash obligations and reported collection) and the
-- platform's append-only double-entry ledger (ADR-0016).

create table taketuk.ride_payments (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null unique references taketuk.rides (id),
  driver_id uuid not null references taketuk.drivers (user_id),
  passenger_id uuid not null references taketuk.users (id),
  method text not null,
  status text not null,
  currency text not null,
  amount_due_minor bigint not null,
  amount_collected_minor bigint,
  reported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ride_payments_method_valid check (method in ('cash')),
  constraint ride_payments_status_valid check (status in ('awaiting_collection', 'collected', 'reported_unpaid')),
  constraint ride_payments_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint ride_payments_amount_due_positive check (amount_due_minor > 0),
  constraint ride_payments_collection_consistency check (
    case status
      when 'awaiting_collection' then amount_collected_minor is null and reported_at is null
      when 'collected' then amount_collected_minor is not null and amount_collected_minor > 0 and reported_at is not null
      else amount_collected_minor is null and reported_at is not null
    end)
);
create index ride_payments_driver_created_idx on taketuk.ride_payments (driver_id, created_at desc, id desc);
create trigger ride_payments_set_updated_at before update on taketuk.ride_payments
  for each row execute function taketuk.set_updated_at();
create trigger ride_payments_status_transition before insert or update of status on taketuk.ride_payments
  for each row execute function taketuk.enforce_status_transition('ride_payment');
select taketuk.apply_table_security('taketuk.ride_payments', 'select, insert, update');

create table taketuk.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  ride_id uuid references taketuk.rides (id),
  description text not null,
  created_by_user_id uuid references taketuk.users (id),
  created_at timestamptz not null default now(),
  constraint ledger_transactions_kind_valid check (kind in ('ride_commission')),
  constraint ledger_transactions_ride_required check (kind <> 'ride_commission' or ride_id is not null),
  -- At most one transaction of a given kind per ride: makes postings idempotent.
  constraint ledger_transactions_kind_ride_key unique (kind, ride_id)
);
select taketuk.apply_table_security('taketuk.ledger_transactions', 'select, insert');

create table taketuk.ledger_entries (
  id bigint generated always as identity primary key,
  transaction_id uuid not null references taketuk.ledger_transactions (id),
  account_type text not null,
  driver_id uuid references taketuk.drivers (user_id),
  currency text not null,
  amount_minor bigint not null,
  created_at timestamptz not null default now(),
  constraint ledger_entries_account_type_valid check (account_type in
    ('driver_commission_receivable', 'platform_commission_revenue')),
  constraint ledger_entries_driver_scope check (
    (account_type like 'driver\_%') = (driver_id is not null)),
  constraint ledger_entries_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint ledger_entries_amount_nonzero check (amount_minor <> 0)
);
create index ledger_entries_transaction_idx on taketuk.ledger_entries (transaction_id);
create index ledger_entries_driver_account_idx on taketuk.ledger_entries (driver_id, account_type) where driver_id is not null;
select taketuk.apply_table_security('taketuk.ledger_entries', 'select, insert');

-- Every ledger transaction must have at least two entries summing to zero per currency.
-- Deferred to commit time so a transaction's entries can be inserted one by one.
create function taketuk.assert_ledger_transaction_balanced() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_transaction_id uuid;
begin
  if tg_table_name = 'ledger_transactions' then
    v_transaction_id := new.id;
  else
    v_transaction_id := new.transaction_id;
  end if;

  if (select pg_catalog.count(*) from taketuk.ledger_entries e where e.transaction_id = v_transaction_id) < 2 then
    raise exception 'ledger transaction % has fewer than two entries', v_transaction_id using errcode = 'TK003';
  end if;
  if exists (
    select 1 from taketuk.ledger_entries e
    where e.transaction_id = v_transaction_id
    group by e.currency
    having pg_catalog.sum(e.amount_minor) <> 0
  ) then
    raise exception 'ledger transaction % does not balance', v_transaction_id using errcode = 'TK003';
  end if;
  return null;
end;
$$;

create constraint trigger ledger_transactions_balanced
  after insert on taketuk.ledger_transactions
  deferrable initially deferred
  for each row execute function taketuk.assert_ledger_transaction_balanced();
create constraint trigger ledger_entries_balanced
  after insert on taketuk.ledger_entries
  deferrable initially deferred
  for each row execute function taketuk.assert_ledger_transaction_balanced();

insert into taketuk.status_transitions (entity, from_status, to_status) values
  ('ride_payment', '(initial)', 'awaiting_collection'),
  ('ride_payment', 'awaiting_collection', 'collected'),
  ('ride_payment', 'awaiting_collection', 'reported_unpaid');
