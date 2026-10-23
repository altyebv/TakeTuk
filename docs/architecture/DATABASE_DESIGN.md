# TAKE-TUK — Database design

| | |
|---|---|
| Authority | `supabase/migrations/*.sql` are authoritative. If this document and a migration disagree, the migration is right and this document is a bug. |
| Engine | PostgreSQL ≥ 16 with PostGIS 3 (Supabase-hosted in production; plain PostgreSQL + PostGIS in tests and CI). |
| Related | ADR-0003, ADR-0005, ADR-0013, ADR-0015, ADR-0016, [STATE_MACHINES](../domain/STATE_MACHINES.md) |

## 1. Schemas, roles and privileges

| Object | Purpose |
|---|---|
| `extensions` | PostGIS (Supabase convention). Code calls PostGIS by schema-qualified names (`extensions.st_dwithin`). |
| `taketuk` | All domain tables, trigger functions and the `status_transitions` table. **Not** exposed through the Supabase Data API. |
| `taketuk_migrations` | Migration history kept by the plain-PostgreSQL runner (`backend/src/infrastructure/database/migrator.ts`). Absent on Supabase, where the Supabase CLI keeps its own history. |
| role `taketuk_api` | `NOLOGIN` group role for the backend. Holds only `USAGE` on `taketuk` and `extensions`, plus per-table DML. The API logs in as a separate login role that is a member of it (OPERATIONS §4). |

`taketuk.apply_table_security(table, privileges)` (migration 0100) is called for every table. It:
- enables RLS,
- creates a single policy `taketuk_api_access` (permissive, `to taketuk_api`),
- revokes everything from `PUBLIC`, `anon`, `authenticated`, `service_role` and `taketuk_api`,
- grants exactly the listed privileges to `taketuk_api`.

**Privilege matrix for `taketuk_api`.** No table grants TRUNCATE, DDL or ownership.

| Privileges | Tables |
|---|---|
| `SELECT` | `status_transitions`, `service_areas`, `service_area_services`, `vehicle_types`, `service_types`, `service_vehicle_compatibility` |
| `SELECT, INSERT` (append-only) | `fare_agreements`, `ledger_transactions`, `ledger_entries`, `audit_events` |
| `SELECT, INSERT, DELETE` | `user_roles` |
| `SELECT, INSERT, UPDATE` | `users`, `drivers`, `vehicles`, `driver_locations`, `driver_documents`, `fare_policies`, `commission_policies`, `rides`, `ride_offers`, `ride_assignments`, `ride_payments` |
| `SELECT, INSERT, UPDATE, DELETE` | `fare_quotes`, `outbox_events`, `idempotency_keys`, `device_registrations` |

These grants are asserted by `backend/test/integration/schema-security.int-spec.ts`.

Reference and configuration data (service areas, vehicle and service types, compatibility) is read-only for the backend in v1. It changes through migrations and operator SQL. Admin endpoints for it are planned.

## 2. Tables by owning module

Write ownership is enforced by the architecture test (`backend/test/architecture/architecture.spec.ts`).

### identity
| Table | Key | Notable constraints |
|---|---|---|
| `users` | `id` = Supabase Auth user id (no FK to `auth.users`; ADR-0003) | display name 1–100 chars; E.164 phone format; `status ∈ {active, disabled}` |
| `user_roles` | (`user_id`, `role`) | `role ∈ {passenger, driver, admin}` |

### geography
| Table | Key | Notable constraints / indexes |
|---|---|---|
| `service_areas` | `id` | unique `code`; `boundary geography(MultiPolygon,4326)` with GiST index; `status ∈ {active, inactive}` |
| `service_area_services` | (`service_area_id`, `service_type_code`) | which services an area offers |

### fleet
| Table | Key | Notable constraints |
|---|---|---|
| `vehicle_types` | `code` | `passenger_capable`; unique (`code`, `passenger_capable`) for the compatibility FK |
| `service_types` | `code` | `requires_passenger_capable_vehicle`; unique (`code`, flag) |
| `service_vehicle_compatibility` | (`service_type_code`, `vehicle_type_code`) | **Composite FKs onto both flag pairs with `ON UPDATE CASCADE`, plus `CHECK (NOT requires_passenger_capable_vehicle OR vehicle_passenger_capable)`.** No row can pair a passenger service with a non-passenger vehicle, and flipping a type's flag that would create such a pair is rejected. |
| `vehicles` | `id` | unique (`driver_id`, `plate_number`); unique (`id`, `driver_id`) for ownership FKs; status trigger |

Seeded reference data: vehicle types `raksha` (passenger-capable), `pickup`, `motorcycle`. Service types `passenger_transport`, `food_delivery`, `package_delivery`, `goods_transport`. The compatibility pairs are listed in PRD §3.

### drivers
| Table | Key | Notable constraints / indexes |
|---|---|---|
| `drivers` | `user_id` | `CHECK (availability = 'offline' OR (status = 'approved' AND active_vehicle_id IS NOT NULL))`; composite FK (`active_vehicle_id`, `user_id`) → `vehicles(id, driver_id)` (owned vehicle only); status trigger |
| `driver_locations` | `driver_id` (latest position only) | `location geography(Point,4326)` GiST index; index on `received_at` |
| `driver_documents` | `id` | unique `storage_path`; `vehicle_id` present ⇔ vehicle document type; composite FK onto the driver's own vehicle; status trigger |

### pricing
| Table | Key | Notable constraints / indexes |
|---|---|---|
| `fare_policies` | `id` | unique (scope, `version`); **partial unique (scope) WHERE status = 'active'**; parameters immutable after draft (trigger `prevent_policy_parameter_change`, SQLSTATE `TK002`); bounded positive amounts; status trigger |
| `fare_quotes` | `id` | route distance ≥ 0; minimum > 0; `expires_at > created_at`; indexes (`passenger_id`, `created_at`) for the rate limit, and `expires_at` |

### finance
| Table | Key | Notable constraints / indexes |
|---|---|---|
| `commission_policies` | `id` | as fare policies; `rate_basis_points ∈ [0, 10000]` |
| `ride_payments` | `id` | **unique `ride_id`**; status-dependent consistency of `amount_collected_minor` and `reported_at`; status trigger |
| `ledger_transactions` | `id` | **unique (`kind`, `ride_id`)**; `ride_commission` requires `ride_id` |
| `ledger_entries` | identity | non-zero signed amounts; driver-scoped accounts require `driver_id`; **deferred constraint triggers ensure every transaction has ≥ 2 entries summing to zero per currency (SQLSTATE `TK003`)** |

### mobility
| Table | Key | Notable constraints / indexes |
|---|---|---|
| `rides` | `id` | **unique `quote_id`**; `proposed ≥ minimum`, `agreed ≥ minimum`; assignment fields required in every post-assignment status (`rides_assignment_consistency`); cancellation facts present ⇔ cancelled; **partial unique (`passenger_id`) WHERE status is open** (one open ride per passenger); partial indexes for dispatch and expiry sweeps; status trigger |
| `ride_offers` | `id` | **unique (`ride_id`, `driver_id`)** (offered once); **partial unique (`driver_id`) WHERE status IN ('pending','countered')** (one open offer per driver); offered ≥ minimum and counter ≥ minimum; counter present in counter states; `closed_at` ⇔ terminal; status trigger |
| `fare_agreements` | `id` | **unique `ride_id`**, unique `offer_id`; agreed ≥ minimum; basis ⇔ which amount was agreed (`fare_agreements_basis_consistency`); append-only |
| `ride_assignments` | `id` | unique `fare_agreement_id`; **partial unique (`ride_id`) and (`driver_id`) WHERE status = 'active'**; `ended_at` ⇔ not active; status trigger |

### platform
| Table | Key | Notable constraints / indexes |
|---|---|---|
| `audit_events` | identity | actor consistency; dotted action format; object metadata; index (`entity_type`, `entity_id`, `id desc`); append-only |
| `outbox_events` | identity | `status ∈ {pending, published, failed}`; partial index on due pending events |
| `idempotency_keys` | (`user_id`, `operation`, `idempotency_key`) | key format; `expires_at` index for cleanup |
| `device_registrations` | `installation_id` | unique `push_token`; app ∈ {passenger, driver}; platform ∈ {android, ios} |

## 3. Database-level state machines

`taketuk.status_transitions(entity, from_status, to_status)` lists every legal transition. `'(initial)'` as `from_status` lists the legal creation statuses. Trigger `taketuk.enforce_status_transition(entity)` runs `BEFORE INSERT OR UPDATE OF status` on `drivers`, `vehicles`, `driver_documents`, `fare_policies`, `commission_policies`, `rides`, `ride_offers`, `ride_assignments` and `ride_payments`. It raises SQLSTATE `TK001` for anything else, and the API maps `TK001` to `409 INVALID_STATE_TRANSITION`. The test `state-machines-parity.int-spec.ts` asserts that the table equals the TypeScript transition tables.

Custom SQLSTATEs: `TK001` illegal status transition, `TK002` immutable policy parameters, `TK003` unbalanced ledger transaction.

## 4. Transaction boundaries and locking

All business writes run in a single READ COMMITTED transaction per use case (`Database.transaction`). The transaction is retried up to 3 times on `40001`/`40P01`. No external call (routing, storage, push) happens inside a transaction.

| Use case | Locks (in order) | Atomic effects |
|---|---|---|
| Create ride | quote row | consume quote, insert ride, idempotency record, audit, outbox |
| Dispatch round | ride (`SKIP LOCKED` in the sweeper) | expire stale offers of candidates, insert offers, round bookkeeping, audit, outbox |
| Accept offer / accept counteroffer | ride → offer → driver | agreement, assignment, ride assigned, offers closed or withdrawn, audit, outbox |
| Counteroffer / decline / reject | ride → offer (→ driver for counteroffer) | offer transition, dispatch nudge, audit, outbox |
| Trip transition / complete | ride | status; on completion, assignment completed, payment record, commission ledger transaction, audit, outbox |
| Cancel | ride | ride cancelled, assignment cancelled, offers withdrawn, audit, outbox |
| Vehicle suspension | driver → vehicle | vehicle status, driver offline if it was the active vehicle, audit |
| Policy create / activate | advisory lock per scope → policy | version allocation, retire previous active, activate, audit |

Sweeper statements that touch offers and rides are separate autocommit statements, so no transaction ever holds an offer lock while waiting for a ride lock.

Every expiry decision uses the database clock (`now()`).

## 5. Geographic data strategy

- Points are `geography(Point, 4326)` and boundaries are `geography(MultiPolygon, 4326)`. Distances are in meters.
- Matching uses `ST_DWithin(location, pickup, radius)` (GiST-indexed) and orders by `ST_Distance`. Service-area checks use `ST_Covers`.
- Only the **latest** driver position is stored (privacy, size). If history is needed later (live tracking, map building from consented GPS traces), it goes in a separate, time-partitioned table with an explicit retention policy.
- Route distances from providers are stored only as calculation inputs, with provenance (`route_provider`, `route_estimated_at` on quotes). Provider responses are not stored (MAP-2).
- The dev seed boundary for Wad Madani is an approximate box (MAP-4).

## 6. Money

All amounts are `bigint` minor units with an explicit `currency` column (ISO 4217). Application code rejects values beyond `Number.MAX_SAFE_INTEGER`: the pool's `int8` parser throws, and API validation caps amounts at 10¹². Calculations use `BigInt` arithmetic (`minimum-fare.ts`, `finance.ts`).

## 7. Migration workflow

- New schema change → new timestamped file in `supabase/migrations`. Applied migrations are **immutable**: the plain-PostgreSQL runner refuses a changed checksum.
- Every new table must call `taketuk.apply_table_security(...)`. The schema-security test fails if RLS is missing or a Supabase API role has privileges.
- Every new status-bearing table must add rows to `status_transitions`, attach the trigger, and be added to the parity test.
- Verification: integration tests build a template database from an empty database by running every migration, which doubles as the clean-migration test. They also assert that re-running is a no-op.
