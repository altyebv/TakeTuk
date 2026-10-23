-- Versioned, immutable fare and commission policies, and fare quotes.
-- No real-world price appears in any migration. Development values live in supabase/seed.sql only.

-- Shared trigger: once a policy leaves 'draft', only lifecycle columns may change.
create function taketuk.prevent_policy_parameter_change() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_lifecycle_columns text[] := array['status', 'activated_at', 'activated_by', 'retired_at', 'retired_by', 'updated_at'];
begin
  if old.status <> 'draft'
     and (pg_catalog.to_jsonb(new) - v_lifecycle_columns) is distinct from (pg_catalog.to_jsonb(old) - v_lifecycle_columns) then
    raise exception 'policy % is % and its parameters are immutable', old.id, old.status
      using errcode = 'TK002';
  end if;
  return new;
end;
$$;

create table taketuk.fare_policies (
  id uuid primary key default gen_random_uuid(),
  service_area_id uuid not null references taketuk.service_areas (id),
  service_type_code text not null references taketuk.service_types (code),
  version integer not null,
  status text not null,
  currency text not null,
  base_fare_minor bigint not null,
  per_km_fare_minor bigint not null,
  minimum_fare_minor bigint not null,
  rounding_increment_minor bigint not null,
  notes text,
  created_by uuid references taketuk.users (id),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  activated_by uuid references taketuk.users (id),
  retired_at timestamptz,
  retired_by uuid references taketuk.users (id),
  updated_at timestamptz not null default now(),
  constraint fare_policies_version_positive check (version > 0),
  constraint fare_policies_status_valid check (status in ('draft', 'active', 'retired')),
  constraint fare_policies_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint fare_policies_amounts_valid check (
    base_fare_minor >= 0 and per_km_fare_minor >= 0 and minimum_fare_minor > 0 and rounding_increment_minor > 0
    and base_fare_minor <= 1000000000000 and per_km_fare_minor <= 1000000000000
    and minimum_fare_minor <= 1000000000000 and rounding_increment_minor <= 1000000000000),
  constraint fare_policies_notes_length check (notes is null or char_length(notes) <= 1000),
  constraint fare_policies_scope_version_key unique (service_area_id, service_type_code, version)
);
create unique index fare_policies_one_active_per_scope
  on taketuk.fare_policies (service_area_id, service_type_code) where status = 'active';
create trigger fare_policies_set_updated_at before update on taketuk.fare_policies
  for each row execute function taketuk.set_updated_at();
create trigger fare_policies_immutable_parameters before update on taketuk.fare_policies
  for each row execute function taketuk.prevent_policy_parameter_change();
create trigger fare_policies_status_transition before insert or update of status on taketuk.fare_policies
  for each row execute function taketuk.enforce_status_transition('fare_policy');
select taketuk.apply_table_security('taketuk.fare_policies', 'select, insert, update');

create table taketuk.commission_policies (
  id uuid primary key default gen_random_uuid(),
  service_area_id uuid not null references taketuk.service_areas (id),
  service_type_code text not null references taketuk.service_types (code),
  version integer not null,
  status text not null,
  rate_basis_points integer not null,
  notes text,
  created_by uuid references taketuk.users (id),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  activated_by uuid references taketuk.users (id),
  retired_at timestamptz,
  retired_by uuid references taketuk.users (id),
  updated_at timestamptz not null default now(),
  constraint commission_policies_version_positive check (version > 0),
  constraint commission_policies_status_valid check (status in ('draft', 'active', 'retired')),
  constraint commission_policies_rate_valid check (rate_basis_points between 0 and 10000),
  constraint commission_policies_notes_length check (notes is null or char_length(notes) <= 1000),
  constraint commission_policies_scope_version_key unique (service_area_id, service_type_code, version)
);
create unique index commission_policies_one_active_per_scope
  on taketuk.commission_policies (service_area_id, service_type_code) where status = 'active';
create trigger commission_policies_set_updated_at before update on taketuk.commission_policies
  for each row execute function taketuk.set_updated_at();
create trigger commission_policies_immutable_parameters before update on taketuk.commission_policies
  for each row execute function taketuk.prevent_policy_parameter_change();
create trigger commission_policies_status_transition before insert or update of status on taketuk.commission_policies
  for each row execute function taketuk.enforce_status_transition('commission_policy');
select taketuk.apply_table_security('taketuk.commission_policies', 'select, insert, update');

-- A quote fixes the server-computed pricing inputs for a short period (ADR-0011).
create table taketuk.fare_quotes (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references taketuk.users (id),
  service_area_id uuid not null references taketuk.service_areas (id),
  service_type_code text not null references taketuk.service_types (code),
  pickup extensions.geography(Point, 4326) not null,
  pickup_label text,
  destination extensions.geography(Point, 4326) not null,
  destination_label text,
  route_distance_meters integer not null,
  route_duration_seconds integer,
  route_provider text not null,
  route_estimated_at timestamptz not null,
  fare_policy_id uuid not null references taketuk.fare_policies (id),
  fare_policy_version integer not null,
  currency text not null,
  minimum_fare_minor bigint not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint fare_quotes_distance_valid check (route_distance_meters >= 0),
  constraint fare_quotes_duration_valid check (route_duration_seconds is null or route_duration_seconds >= 0),
  constraint fare_quotes_minimum_positive check (minimum_fare_minor > 0),
  constraint fare_quotes_labels_length check (
    (pickup_label is null or char_length(pickup_label) <= 200) and
    (destination_label is null or char_length(destination_label) <= 200)),
  constraint fare_quotes_expiry_after_creation check (expires_at > created_at)
);
create index fare_quotes_passenger_created_idx on taketuk.fare_quotes (passenger_id, created_at);
create index fare_quotes_expires_idx on taketuk.fare_quotes (expires_at);
select taketuk.apply_table_security('taketuk.fare_quotes', 'select, insert, update, delete');

insert into taketuk.status_transitions (entity, from_status, to_status) values
  ('fare_policy', '(initial)', 'draft'),
  ('fare_policy', 'draft', 'active'),
  ('fare_policy', 'draft', 'retired'),
  ('fare_policy', 'active', 'retired'),
  ('commission_policy', '(initial)', 'draft'),
  ('commission_policy', 'draft', 'active'),
  ('commission_policy', 'draft', 'retired'),
  ('commission_policy', 'active', 'retired');
