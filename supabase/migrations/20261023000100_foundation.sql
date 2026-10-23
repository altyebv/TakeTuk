-- TAKE-TUK foundation: extensions, private domain schema, least-privilege backend role,
-- and shared helpers (updated_at, table security, database-level status transitions).
--
-- These migrations are authoritative. They must apply both to a Supabase project
-- (via the Supabase CLI) and to a plain PostgreSQL >= 16 database with PostGIS (tests/CI).
-- See docs/architecture/DATABASE_DESIGN.md and ADR-0015.

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

create schema taketuk;
comment on schema taketuk is
  'TAKE-TUK domain schema. Not exposed through the Supabase Data API; accessed only by members of taketuk_api.';

-- Backend role. NOLOGIN: operators create a separate LOGIN role that is a member of it
-- (password managed outside migrations; see docs/operations/OPERATIONS.md).
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'taketuk_api') then
    create role taketuk_api nologin;
  end if;
end
$$;

revoke all on schema taketuk from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_catalog.pg_roles where rolname = r) then
      execute format('revoke all on schema taketuk from %I', r);
    end if;
  end loop;
end
$$;

grant usage on schema taketuk to taketuk_api;
grant usage on schema extensions to taketuk_api;

-- ---------------------------------------------------------------------------
-- Helper: maintain updated_at columns.
-- ---------------------------------------------------------------------------
create function taketuk.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helper: apply the standard security posture to a table (ADR-0015).
--   * RLS enabled, single permissive policy for taketuk_api only.
--   * No privileges for PUBLIC / anon / authenticated / service_role.
--   * Exactly the given privileges for taketuk_api.
-- Executable only by the migration owner.
-- ---------------------------------------------------------------------------
create function taketuk.apply_table_security(p_table regclass, p_api_privileges text) returns void
language plpgsql
set search_path = ''
as $$
declare
  r text;
begin
  if p_api_privileges !~ '^\s*(select|insert|update|delete)(\s*,\s*(select|insert|update|delete))*\s*$' then
    raise exception 'apply_table_security: unsupported privilege list %', p_api_privileges;
  end if;

  execute format('alter table %s enable row level security', p_table);
  execute format('create policy taketuk_api_access on %s as permissive for all to taketuk_api using (true) with check (true)', p_table);

  execute format('revoke all on %s from public', p_table);
  foreach r in array array['anon', 'authenticated', 'service_role', 'taketuk_api'] loop
    if exists (select 1 from pg_catalog.pg_roles where rolname = r) then
      execute format('revoke all on %s from %I', p_table, r);
    end if;
  end loop;

  execute format('grant %s on %s to taketuk_api', p_api_privileges, p_table);
end;
$$;
revoke all on function taketuk.apply_table_security(regclass, text) from public;

-- ---------------------------------------------------------------------------
-- Database-level state machines (docs/domain/STATE_MACHINES.md).
-- Each lifecycle-bearing table has a trigger that rejects any status change not listed here.
-- '(initial)' as from_status lists the statuses a row may be created with.
-- The backend role may read but never modify this table.
-- ---------------------------------------------------------------------------
create table taketuk.status_transitions (
  entity text not null,
  from_status text not null,
  to_status text not null,
  primary key (entity, from_status, to_status)
);
select taketuk.apply_table_security('taketuk.status_transitions', 'select');

create function taketuk.enforce_status_transition() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_entity text := tg_argv[0];
  v_from text;
begin
  if tg_op = 'INSERT' then
    v_from := '(initial)';
  elsif new.status is not distinct from old.status then
    return new;
  else
    v_from := old.status;
  end if;

  if not exists (
    select 1
    from taketuk.status_transitions t
    where t.entity = v_entity and t.from_status = v_from and t.to_status = new.status
  ) then
    raise exception 'illegal % status transition: % -> %', v_entity, v_from, new.status
      using errcode = 'TK001';
  end if;
  return new;
end;
$$;
