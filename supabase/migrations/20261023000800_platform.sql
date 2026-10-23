-- Platform: audit trail, transactional outbox, idempotency records, device registrations.

create table taketuk.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_type text not null,
  actor_user_id uuid references taketuk.users (id),
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  constraint audit_events_actor_type_valid check (actor_type in ('user', 'system')),
  constraint audit_events_actor_consistency check ((actor_type = 'user') = (actor_user_id is not null)),
  constraint audit_events_action_format check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  constraint audit_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);
create index audit_events_entity_idx on taketuk.audit_events (entity_type, entity_id, id desc);
create index audit_events_actor_idx on taketuk.audit_events (actor_user_id, occurred_at desc) where actor_user_id is not null;
-- Append-only for the backend role.
select taketuk.apply_table_security('taketuk.audit_events', 'select, insert');

create table taketuk.outbox_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  claimed_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  constraint outbox_events_status_valid check (status in ('pending', 'published', 'failed')),
  constraint outbox_events_attempts_valid check (attempts >= 0),
  constraint outbox_events_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint outbox_events_published_consistency check ((status = 'published') = (published_at is not null))
);
create index outbox_events_due_idx on taketuk.outbox_events (available_at, id) where status = 'pending';
select taketuk.apply_table_security('taketuk.outbox_events', 'select, insert, update, delete');

create table taketuk.idempotency_keys (
  user_id uuid not null references taketuk.users (id),
  operation text not null,
  idempotency_key text not null,
  request_hash text not null,
  response_status integer not null,
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, operation, idempotency_key),
  constraint idempotency_keys_key_format check (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$')
);
create index idempotency_keys_expires_idx on taketuk.idempotency_keys (expires_at);
select taketuk.apply_table_security('taketuk.idempotency_keys', 'select, insert, update, delete');

create table taketuk.device_registrations (
  installation_id uuid primary key,
  user_id uuid not null references taketuk.users (id),
  app text not null,
  platform text not null,
  push_token text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_registrations_app_valid check (app in ('passenger', 'driver')),
  constraint device_registrations_platform_valid check (platform in ('android', 'ios')),
  constraint device_registrations_token_length check (char_length(push_token) between 10 and 4096)
);
create index device_registrations_user_idx on taketuk.device_registrations (user_id, app);
create trigger device_registrations_set_updated_at before update on taketuk.device_registrations
  for each row execute function taketuk.set_updated_at();
select taketuk.apply_table_security('taketuk.device_registrations', 'select, insert, update, delete');
