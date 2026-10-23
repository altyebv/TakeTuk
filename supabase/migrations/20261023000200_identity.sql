-- Identity: TAKE-TUK user records and roles.
-- users.id equals the Supabase Auth user id (JWT "sub"). There is intentionally no foreign key
-- to auth.users so the schema stays portable to plain PostgreSQL (ADR-0003).

create table taketuk.users (
  id uuid primary key,
  display_name text not null,
  phone_e164 text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_display_name_length check (char_length(btrim(display_name)) between 1 and 100),
  constraint users_phone_format check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  constraint users_status_valid check (status in ('active', 'disabled'))
);
create trigger users_set_updated_at before update on taketuk.users
  for each row execute function taketuk.set_updated_at();
select taketuk.apply_table_security('taketuk.users', 'select, insert, update');

create table taketuk.user_roles (
  user_id uuid not null references taketuk.users (id),
  role text not null,
  granted_at timestamptz not null default now(),
  granted_by uuid references taketuk.users (id),
  primary key (user_id, role),
  constraint user_roles_role_valid check (role in ('passenger', 'driver', 'admin'))
);
select taketuk.apply_table_security('taketuk.user_roles', 'select, insert, delete');
