# ADR-0013: Data access with node-postgres and explicit SQL

- Status: Accepted
- Date: 2026-10-23

## Context

The critical operations depend on precise SQL semantics: `SELECT … FOR UPDATE`, `FOR UPDATE SKIP LOCKED`, status-conditional updates, partial unique indexes with `ON CONFLICT`, PostGIS functions, deferred constraint triggers and explicit isolation. Supabase migrations are the authoritative schema (ADR-0003).

## Decision

- Use `pg` (node-postgres) directly, through a small `Database` service that provides a pool, `query`, and `transaction(fn)`. The transaction helper runs at READ COMMITTED and retries on `40001`/`40P01` (at most 3 attempts).
- Each module writes SQL in its own `infrastructure/*.repository.ts` files, with typed row mapping. Transactions are passed explicitly (`tx` parameter), never through implicit context.
- No ORM schema or ORM migrations.

## Alternatives considered

- **Prisma, TypeORM, MikroORM.** Their migration and schema systems would compete with Supabase migrations, and they obscure locking and PostGIS SQL.
- **Drizzle or Kysely (type-safe query builders).** Reasonable, and could be adopted later. Today's queries are few, and explicit SQL is easier to review against the documented invariants.

## Rationale

The SQL is the specification of the concurrency guarantees, so it is kept visible and reviewable.

## Consequences

- Row types are written by hand. Integration tests catch mismatches between SQL and types.
- PostgreSQL `bigint` columns are returned as strings by `pg` and converted explicitly. Money values are kept within `Number.MAX_SAFE_INTEGER` by validation.

## Risks

- SQL typos are found only at test time. Mitigated by integration tests for every repository path.
