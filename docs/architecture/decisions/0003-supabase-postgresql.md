# ADR-0003: Supabase PostgreSQL as the primary database

- Status: Accepted
- Date: 2026-10-23

## Context

TAKE-TUK needs a relational, transactional database with geographic support, managed operations (backups, upgrades), and low cost. The directive mandates Supabase PostgreSQL.

## Decision

- Supabase-hosted PostgreSQL is the system of record.
- `supabase/migrations/*.sql` (Supabase CLI format, timestamped) are the **only** mechanism for schema changes. Dashboard schema edits are prohibited.
- Domain tables live in a dedicated, non-exposed schema `taketuk` (ADR-0015).
- Migrations are written so they also apply to a plain PostgreSQL ≥ 16 database with PostGIS. CI and integration tests use such a database. The migrations do not depend on Supabase-internal schemas (`auth`, `storage`) except in one migration that is explicitly guarded and skipped when the `storage` schema is absent.
- Supabase environments use the Supabase CLI (`supabase db reset` locally, `supabase db push` for linked projects). The repository's Node migration runner (`backend/scripts/migrate.ts`) is only for plain PostgreSQL test and CI databases.

## Alternatives considered

- **Self-managed PostgreSQL.** Lower vendor dependency, but higher operational cost and risk at launch.
- **Other managed Postgres (Neon, RDS).** Viable, but Supabase also provides the mandated Auth and Storage.

## Rationale

Managed Postgres with Auth and Storage in one product keeps operations simple. Keeping the schema portable (no foreign keys into `auth.users`, extensions in `extensions`) means tests do not need the full Supabase stack, and leaves a migration path if the hosting choice changes.

## Consequences

- `taketuk.users.id` equals the Supabase Auth user id but has no foreign key to `auth.users`. Account deletion therefore needs an explicit backend process ([P], tracked in the roadmap) instead of a cascade.
- Two migration runners exist for two environment types, and this is documented in OPERATIONS. Do not use the Node runner against a Supabase project.
- The local test database is PostgreSQL 16 with PostGIS 3.4. New hosted Supabase projects may run a newer major version. Migrations avoid version-specific features.

## Risks

- Behaviour differences between Supabase's Postgres image and vanilla Postgres (roles, default privileges). Mitigation: validate with `supabase db reset` once Docker is available (not yet verified; see the implementation report).
