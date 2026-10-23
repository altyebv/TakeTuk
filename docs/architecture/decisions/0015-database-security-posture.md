# ADR-0015: Private schema, least-privilege backend role, RLS as defence in depth

- Status: Accepted
- Date: 2026-10-23

## Context

On Supabase, tables in exposed schemas are reachable through the Data API using the public `anon` key and user JWTs (role `authenticated`). The service-role key and the `postgres` role bypass RLS. TAKE-TUK's design (ADR-0007) routes all business access through the backend.

## Decision

1. **Private schema.** All domain tables live in `taketuk`. The schema is not listed in the Data API's exposed schemas. `anon`, `authenticated` and `PUBLIC` receive no schema `USAGE` and no table privileges, and migrations revoke them explicitly.
2. **Least-privilege backend role.** Migrations create `taketuk_api` (`NOLOGIN`). It has only `USAGE` on `taketuk` and `extensions`, plus per-table DML grants. Append-only tables (fare agreements, ledger, audit) get `SELECT, INSERT` only. The role has no DDL rights, no `TRUNCATE`, and no ownership. The backend connects as a **login role that is a member of `taketuk_api`**, created by an operator with a secret password outside migrations (OPERATIONS).
3. **RLS enabled on every table**, with one permissive policy for `taketuk_api`. Any other role, should it ever receive grants by mistake, sees no rows. A migration test asserts that RLS is enabled on every table and that `anon` and `authenticated` hold no privileges.
4. The Supabase **service-role/secret key** is used only server-side, for Storage signed URLs. It is never used for database access by the API and never reaches clients.

## Alternatives considered

- **Tables in `public` with full RLS policies per user.** Requires duplicating authorization in SQL policies and exposes the schema.
- **Backend connects as `postgres`.** Simplest, but a compromised backend could drop tables and bypass every RLS and privilege safeguard.

## Rationale

The database refuses the most damaging operations (schema changes, deleting history), even if the application is compromised or buggy.

## Consequences

- Each new table needs explicit grants and an RLS policy in its migration. The migration test enforces this.
- Migrations run as the schema owner (`postgres` on Supabase), never as the backend role.

## Risks

- Creating roles on hosted Supabase is done by `postgres`. That works in standard Supabase projects but has **not been verified** against a live project in this environment. Fallback: create the login role through the SQL editor, following OPERATIONS. This is a documented, auditable step.
