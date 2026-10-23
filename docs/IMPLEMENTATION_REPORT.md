# TAKE-TUK — Implementation report (first increment)

| | |
|---|---|
| Date | 2026-10-23 |
| Branch | `claude/take-tuk-architecture-zdr973` |
| Scope | Phases 1–7 of the project directive: documentation foundation, backend foundation, identity, ride-booking vertical slice, verification, handoff |

This report distinguishes **implemented and tested**, **implemented but not verified against a live service**, and **planned**. Every test result quoted below was actually run in this environment.

## 1. What was implemented

### Documentation

`MANIFESTO.md`, PRD and open-decision register, system architecture, database design, domain model, state machines, API conventions, security, operations, roadmap, ADRs 0001–0016, and a generated OpenAPI 3.0 document (`docs/api/openapi.json`, 55 paths).

### Database (`supabase/migrations`, 9 files)

- Private schema `taketuk` and least-privilege role `taketuk_api`. RLS is on every table, and `anon`, `authenticated` and `service_role` have no access.
- Database-level state machines: a `status_transitions` table and a trigger on 9 lifecycle tables.
- Declarative invariants:
  - one confirmed driver per ride,
  - one active job per driver,
  - one open offer per driver,
  - one open ride per passenger,
  - fares ≥ minimum (rides, offers, agreements),
  - passenger services only on passenger-capable vehicles,
  - online ⇒ approved driver with an owned active vehicle,
  - immutable policies after draft,
  - balanced, append-only double-entry ledger,
  - append-only audit and fare agreements.
- Guarded creation of the private `driver-documents` Storage bucket.
- Supabase CLI `config.toml` (domain schema not exposed; phone OTP with local test numbers) and a labelled development seed.

### Backend (NestJS 12, TypeScript 6, Node 24)

| Module | Implemented |
|---|---|
| Platform | Validated configuration (production refuses dev substitutes and insecure settings). RFC 9457 problem details with stable codes. Request ids, structured logs, security headers. Health and readiness. Transaction helper with bounded retry. Audit trail. Transactional outbox with retry, backoff, claim lapse and retention. Idempotency keys stored in the effect's transaction. In-process periodic workers. |
| Identity | Supabase JWT verification (JWKS ES256/RS256 or legacy HS256, exclusive). Issuer, audience, expiry, `role = authenticated` and non-anonymous checks. Deny-by-default access guard. Roles from the database mapped to permissions. Passenger registration. Profile updates. Disabled accounts blocked everywhere. |
| Geography | Service-area resolution (PostGIS `ST_Covers`, both trip points). Routing port with a Google Routes adapter and a production-refused dev fake. |
| Fleet | Vehicle types, service types and compatibility catalogue. Vehicle records and review state machine. |
| Drivers | Registration (idempotent). Profile edits only when editable. Vehicle registration. Documents through backend-chosen paths and signed upload URLs, confirmed only once the object exists. Submission requirements. Admin review: approve, reject (note required), suspend (forces offline), reinstate. Vehicle review, where suspending the active vehicle forces the driver offline. Self-review forbidden. Audited signed document view URLs. Availability (approved driver and approved owned vehicle). Latest-position location updates using server receive time. |
| Pricing | Versioned fare policies (draft → active → retired, one active per scope, advisory-locked version allocation). Integer minimum-fare formula. Negotiation rules. Single-use, owner-bound, expiring quotes with route provenance. Per-user quote rate limit. Fails closed on routing or pricing unavailability. |
| Finance | Versioned commission policies. Cash payment records (obligation separate from reported collection). Commission posting as a balanced ledger transaction. Driver earnings with commission owed. |
| Mobility | Ride creation from quotes (idempotency key, minimum-fare check, one open ride). Batched dispatch rounds with an eligibility query covering approval, availability, approved active vehicle, compatibility, area, freshness, radius, no job, no open offer, not previously offered, and not the passenger. Accept, decline and counteroffer. Passenger accept or reject of counteroffers. **Atomic assignment critical section** (ride → offer → driver locks, eligibility re-check, commission snapshot, immutable fare agreement). Trip lifecycle by the assigned driver only. Cancellation rules per actor and stage (facts recorded, no penalty). Search and offer expiry by database clock. Sweeper for expiry, ineligible-driver withdrawal and re-dispatch. Admin ride view and force-cancel. |
| Notifications | Device registration limited to apps of held roles. Outbox handlers mapping events to pushes (never authoritative). FCM HTTP v1 adapter and a dev log provider. Invalid-token cleanup. |
| Operator CLI | `migrate` (plain PostgreSQL only; refuses Supabase databases), `seed-dev` (refused in production), and `grant-role` (audited). |
| Delivery | Multi-stage Dockerfile. GitHub Actions workflow (format, lint, typecheck, tests against PostGIS, build, audit). |

## 2. What was tested

All of the following ran and passed in this environment (PostgreSQL 16.15 with PostGIS 3.4, Node 24.22.1).

| Suite | Tests | Covers |
|---|---:|---|
| `src/config/app-config.spec.ts` | 9 | derivations, defaults, production refusals, provider credentials |
| `src/modules/identity/.../supabase-token-verifier.spec.ts` | 13 | expired, wrong issuer, wrong audience, wrong role, anonymous, forged key, `alg=none`, HS256 confusion, garbage, legacy mode, JWKS outage → 503 |
| `src/modules/pricing/domain/pricing.spec.ts` | 8 | minimum-fare formula, floor, rounding, big integers, invalid inputs, negotiation rules |
| `src/modules/finance/domain/finance.spec.ts` | 5 | commission rounding, balance of postings, payment state machine |
| `src/modules/mobility/domain/state-machines.spec.ts` | 9 | **exhaustive** ride transition × actor matrix, terminal states, negotiation self-dealing rules |
| `src/modules/drivers/domain/driver.spec.ts` | 5 | verification requirements, driver state machine |
| `src/modules/geography/routing/routing-providers.spec.ts` | 12 | Google request and response format, error mapping, timeout, no fallback; dev fake |
| `src/modules/notifications/notifications.spec.ts` | 7 | event → recipient routing; FCM request format, invalid tokens, transient errors |
| `src/shared/shared.spec.ts` | 9 | problem mapping (no leaks, DB outage, conflicts), idempotency fingerprints, backoff, cursors |
| `test/architecture/architecture.spec.ts` | 6 | public module APIs, documented acyclic graph, platform independence, domain purity, **SQL write ownership** |
| `test/unit/openapi.spec.ts` | 3 | every operation has an access rule, unique operationIds, committed document up to date |
| `test/integration/schema-security.int-spec.ts` | 9 | **clean migration and re-run no-op**, RLS on all tables, no API-role grants, append-only grants, no DDL by backend role, compatibility constraint, transition trigger, policy immutability, ledger balance |
| `test/integration/state-machines-parity.int-spec.ts` | 10 | database transition table = code transition tables (9 entities) |
| `test/integration/identity.int-spec.ts` | 12 | health, request ids, 401 cases, unregistered access, idempotent registration, unknown-field rejection, malformed JSON, 413, disabled users, unknown routes |
| `test/integration/ride-booking.int-spec.ts` | 19 | quote → ride → dispatch → accept → trip → completion → commission → cash report (end to end); counteroffer flow; minimum fare; quote misuse; one open ride; expiry; privacy; audit trail; outbox delivery |
| `test/integration/drivers-and-matching.int-spec.ts` | 10 | onboarding, documents, submission requirements, review and self-review, suspension, vehicle suspension, **matching eligibility exclusions (incl. motorcycles and pickups for passenger rides)**, own-ride exclusion, deferred dispatch |
| `test/integration/concurrency.int-spec.ts` | 9 | **5 drivers accepting the same ride simultaneously, 10 rounds: exactly one assignment each time**; counteroffer-accept vs driver-accept race (10 rounds); retry storms; concurrent idempotent creation; one open ride; one open offer per driver; concurrent completion; concurrent policy activation; database rejects a second assignment when the application is bypassed |
| `test/integration/failures.int-spec.ts` | 9 | routing unavailable or no route (nothing stored), rate limit, pricing retired (fail closed, snapshot honoured), storage outage, **atomic rollback on mid-transaction failure**, push retry, backoff and permanent failure, crash-claim recovery, database unavailable (readiness 503, API 503) |
| `test/integration/authorization.int-spec.ts` | 6 | **generated from the OpenAPI document**: every operation requires a token; unregistered users, passengers and drivers are denied everything outside their permissions; unapproved drivers blocked from commercial work |
| **Total** | **170** | **170 passed, 0 failed** |

The integration project (84 tests) was run 3 additional consecutive times with no failures, to check the concurrency tests for flakiness.

**CI.** The GitHub Actions workflow (`.github/workflows/backend.yml`) ran on [altyebv/TakeTuk#1](https://github.com/altyebv/TakeTuk/pull/1) and passed: format check, lint, type check, all 170 tests against a `postgis/postgis:16-3.4` service container, build, and `npm audit --omit=dev` with 0 vulnerabilities.

**Compiled-server smoke test** (manual, scripted): built the server, migrated and seeded a fresh database with the CLI, created a least-privilege login role, and started `node dist/src/main.js` with workers enabled and HS256 auth. The following completed with the expected status codes:
- passenger and driver registration,
- vehicle registration,
- driver approval (via SQL for this test only),
- online, location, quote (`dev_fake`, 3 212 m, minimum 26 500),
- ride, automatic offer, counteroffer, passenger acceptance,
- arrive, start, complete, cash collection,
- earnings (commission 3 150 = 10% of 31 500),
- CLI admin grant, audit query, and a passenger denied the audit endpoint (403).

All 7 outbox events were published by the live worker, and the log contained 0 error lines.

## 3. Commands executed

```bash
# environment
apt-get install -y postgresql-16-postgis-3        # PostGIS for the local PostgreSQL 16
# Node 24.22.1 LTS installed to /opt/node24 (Node 22 cannot run Jest's require(esm) path)

cd backend
npm ci
npm run format:check && npm run lint && npm run typecheck   # all clean
npm test                                                     # 170/170 passed (19 suites)
npm run test:integration   (x3)                              # 84/84 passed each run
npm run openapi                                              # regenerated docs/api/openapi.json
npm run build
npm audit --omit=dev --audit-level=high                     # 0 vulnerabilities
DATABASE_ADMIN_URL=… node dist/src/cli/main.js migrate       # 9 applied; re-run: 0 applied, 9 already applied
DATABASE_ADMIN_URL=… node dist/src/cli/main.js seed-dev
node dist/src/main.js                                        # smoke test (§2)
```

**Tests that failed during development and were fixed** (none fail now):
- an invalid `INSERT … o (` alias in the offer insert,
- test-pool `bigint` parsing,
- audit ordering on completion,
- the body-parser 413 mapping,
- the loser code in acceptance races, now `RIDE_NO_LONGER_AVAILABLE`,
- a keyset-pagination precision bug, found by review: JS `Date` truncates microseconds, so cursors now carry exact database timestamps,
- an architecture violation: outbox retention had lived in the idempotency module.

## 4. Integrations that remain unconfigured or unverified

| Integration | State | To complete |
|---|---|---|
| Supabase project (Auth JWKS, Storage, roles) | Code paths implemented. **Not verified live.** | Create staging project; enable asymmetric signing keys; `supabase db push`; create the API login role (OPERATIONS §4); run the smoke test with real tokens |
| Supabase CLI local stack | Config and migrations ready. **`supabase start` not run** (Docker image pulls were rate-limited or blocked in this environment) | Run `supabase start && supabase db reset` |
| Supabase Storage adapter | storage-js based. **Not verified live.** | Exercise upload URL, existence check and view URL against staging |
| Google Routes API | Adapter matches the documented format. **Not verified live.** No key. | Server key restricted to Routes API; compare distances for Wad Madani routes (MAP-1); terms review (MAP-2) |
| FCM / APNs | HTTP v1 adapter. **Not verified live.** No Firebase project. | Firebase project, service account, APNs key; device test |
| SMS OTP delivery to Sudan | Not evaluated | Choose provider; test (IDN-1) |
| Container image | Dockerfile written. **Not built** (no registry access here). | Build in CI or locally |

## 5. Assumptions made

Every assumption is listed with its consequences in [`docs/product/OPEN_DECISIONS.md`](product/OPEN_DECISIONS.md). The most consequential:
- driver acceptance of the proposal confirms immediately (PRC-2),
- counteroffers must exceed the proposal (PRC-3),
- both trip ends inside the service area (PRC-7),
- one open offer per driver (DSP-2),
- no re-dispatch after a driver cancels (DSP-3),
- commission charged at completion on the agreed fare (FIN-2/3),
- cash only (FIN-5),
- the required document set (DRV-1),
- phone reveal during active assignment (IDN-2),
- `DRIVE` travel mode for raksha (MAP-3).

All fare and commission numbers are development values.

## 6. Known limitations

- No mobile or web clients. Real-time is by polling plus push. There is no live tracking or location history.
- Dispatch thresholds are development defaults. Ranking is by straight-line distance, not ETA.
- Reference data (service areas, vehicle and service types, compatibility) is managed by migrations and operator SQL; there are no admin endpoints for it yet.
- No dispute workflow, cancellation fees, commission settlement, refunds or reversals. The ledger is designed for them.
- Only a per-user quote rate limit; no global or per-IP limiting.
- Pagination exists for ride history, driver lists, earnings and audit. Admin listing of rides by filter is not implemented (rides are looked up by id).
- No account deletion process. `users` has no FK to `auth.users` by design (ADR-0003), so deletion needs an explicit backend process.
- Tests run on PostgreSQL 16. New hosted Supabase projects default to PostgreSQL 17 (`supabase/config.toml major_version = 17`). No incompatibility is known, but none has been tested.
- Notification text is English placeholder copy. Arabic localisation is planned.

## 7. Security and operational concerns requiring attention

1. **Hosted Supabase role creation** for the least-privilege login role must be verified (ADR-0015). Until then, a deployment might be tempted to use the `postgres` role, which bypasses every database safeguard. Do not do that.
2. **Exposed schemas**: confirm `taketuk` is not in the Data API's exposed schemas on every project (OPERATIONS §4 checklist).
3. **Phone number exposure** between passenger and driver during an active trip (IDN-2). Consider masked calling before scale.
4. **Admin accounts**: enforce MFA (`aal2`) for admin routes (planned). Admin grants are CLI-only and audited.
5. **Commission on unpaid rides** (FIN-3) can be unfair to drivers until reversals exist. This is an operator process risk.
6. **Routing cost**: the quote rate limit protects spend per user, but not against many accounts. Add global limits and monitoring.
7. **Document uploads**: no malware scanning, and no retention policy yet (DRV-5).
8. **Monitoring**: failed outbox events and stuck dispatch need alerting (OPERATIONS §8). Only logs exist today.
9. **Backups**: restore drill not performed.

## 8. Recommended next phase

**Phase 8: live integration verification (staging)** comes before any client work, because every client depends on it. Create a staging Supabase project and verify:
- `supabase db push`,
- the login role,
- JWKS verification with real phone-OTP tokens,
- Storage signed URLs,
- the Google Routes distances on real Wad Madani routes,
- FCM delivery.

Then build the container image. Feed findings back into ADR-0004/0008/0015.

After that: **Phase 9–10 (Flutter foundation and ride UX)**, starting with the shared `taketuk_api` package generated from `docs/api/openapi.json`, and **Phase 11 (admin web)** for verification and policy management. The roadmap has the full sequence.
