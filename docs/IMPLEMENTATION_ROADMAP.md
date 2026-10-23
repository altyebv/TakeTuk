# TAKE-TUK — Implementation roadmap

Status legend: ✅ done (implemented and tests passing) · 🟡 partial · ⏳ in progress · 📋 planned.

## Phase 1: Repository reconnaissance and planning ✅

- The repository held one placeholder file (`init.md`: "almost ready !"). It was removed. No other prior work existed.
- Environment: Node 22 was preinstalled, and Node 24 LTS was installed for the toolchain (ADR-0002). PostgreSQL 16 was available and PostGIS 3.4 was installed. A Docker daemon could be started, but registry pulls were rate-limited or blocked, so neither the Supabase CLI local stack nor an image build was possible. There was no Flutter SDK.
- No blocking ambiguity. Assumptions are recorded in [OPEN_DECISIONS](product/OPEN_DECISIONS.md).

## Phase 2: Documentation foundation ✅

PRD, system architecture, domain model, state machines, API conventions, security, manifesto, ADRs 0001–0016 and the open-decision register.

## Phase 3: Repository and infrastructure foundation ✅

NestJS 12 backend on Node 24 with strict TypeScript, ESLint, Prettier and Jest. Validated configuration, structured logs, request ids, and health and readiness endpoints. Nine Supabase migrations, Supabase CLI configuration, a development seed, a plain-PostgreSQL migration runner and operator CLI. `.env.example`, Dockerfile and CI workflow.

Completion criteria met: a clean database migrates (tested); lint, type check and tests pass; the compiled service starts against a migrated database (smoke test).

The CI workflow has run and passed on GitHub Actions.

🟡 **Not verified yet:** the Docker build and the Supabase CLI stack (see the implementation report §4).

## Phase 4: Identity and authorization ✅

Supabase JWT verification (JWKS / HS256), the users and roles model, the deny-by-default access guard, permissions, registration, and the operator CLI for admin grants. Security tests cover every case listed in the completion criteria, plus a route-by-route authorization sweep.

## Phase 5: Ride-booking vertical slice ✅

The full slice was implemented as specified: quote → negotiated ride → dispatch → accept or counteroffer → atomic assignment → trip → completion → cash obligation, commission ledger and cash report. It also includes cancellation and expiry, audit and outbox notifications.

## Phase 6: Testing and verification ✅

170 tests across 19 suites, all passing (see [IMPLEMENTATION_REPORT](IMPLEMENTATION_REPORT.md) §2): unit, architecture, integration, concurrency, idempotency, authorization, failure and migration tests.

## Phase 7: Handoff ✅

Documentation reconciled with the implementation, and the implementation report written.

## Second increment

### Self-hosted routing (OSRM) ✅ adapter · 🟡 real data

`ROUTING_PROVIDER=osrm` (ADR-0017), because Google Maps Platform billing needs a payment card the team cannot use for now. The adapter was verified against a real `osrm-routed` on a synthetic street grid. It has **not** yet run on real Wad Madani OpenStreetMap data, because no extract could be downloaded in the build environment (MAP-1).

### API contract fixes ✅

Found while generating the Dart client:
- the OpenAPI document declared no path or query parameters;
- the 204 response of `DELETE /v1/me/devices/{id}` was undocumented;
- general problem codes were not published.

All three are fixed and tested. Contract fixtures are recorded from the backend and checked on both sides.

### Phase 9: Flutter foundation 🟡

Implemented and tested (47 Dart tests):
- a pub workspace;
- `taketuk_api`, generated from the OpenAPI document;
- `taketuk_auth`: Supabase phone OTP, session and sign-in screens;
- `taketuk_ui`: theme, Arabic/RTL and error messages;
- passenger and driver app shells with sign-in and registration.

Completion criterion "apps build in CI" is met: the `mobile` workflow builds debug APKs of both apps. **Pending:** "sign-in against staging", which needs Supabase reachable from the build environment and test credentials (phase 8).

## Third increment

### Phase 10: ride UX 🟡

Implemented and tested with widget tests over recorded backend responses (65 Dart tests in total):
- **Passenger:** trip planner on a map (`flutter_map`), quote, offer, retry-safe ride request, searching with counteroffers, the trip, the cash fare, cancellation and history.
- **Driver:** onboarding (document photos to signed URLs, vehicle, submission), going online, position reports, offers and counteroffers, the trip, cash reporting and earnings.

**Pending:** completion criterion "pilot-ready ride flow on devices", which needs a device test against staging. Known limits: polling instead of push (API-1), and foreground-only driver positions (DRV-6).

Also in this increment: the backend accepts the FCM key from an environment variable (`FCM_SERVICE_ACCOUNT_JSON`).

### Phase 8: live integration verification 🟡 started

- ✅ **Supabase Auth.** Token verification works against the live project, using email sign-in. Email codes are a stopgap for development builds while SMS is unavailable (IDN-6). The check is repeatable with `npm run test:live -- supabase`.
- ✅ **Schema and Storage.** The schema was applied with `supabase db push`. The private bucket, the Data API exposure and document uploads are verified with `npm run test:live -- supabase-storage`.
- 📋 **Pending:**
  - the API connecting to the project's database (OPERATIONS §2c);
  - FCM;
  - OSRM on real data.
- 📋 **Phone sign-in** waits for an SMS provider (IDN-1).

---

## Next phases (planned)

| Phase | Scope | Depends on | Completion criteria |
|---|---|---|---|
| 8. Live integration verification | Supabase project (Auth JWKS, Storage bucket, role creation, `supabase db push`), FCM project, an OSRM dataset built from a real extract (Google Routes once billing is possible). Run the existing adapters against them | Accounts and credentials | Each adapter exercised in staging; findings fed back into ADRs |
| 11. Admin web (React) | Driver verification queue, document viewer, policy management, ride lookup, audit | Phase 8 | Operators can approve drivers and configure policies without SQL |
| 12. Operations hardening | Global rate limiting, alerting on failed outbox and dispatch, account deletion, document retention, restore drill, admin MFA (`aal2`) | — | Runbooks exercised |
| 13. Marketplace and orders | Merchants, branches, catalogue, merchant dashboard, orders | Phase 11 | Order state machine implemented and tested |
| 14. Delivery jobs | Delivery-job aggregate reusing dispatch and assignment | Phase 13 | Food and package deliveries end to end |
| 15. Payments beyond cash | Provider evaluation (mobile money and bank apps), reconciliation jobs, settlements | Product decision FIN-5 | Reconciled ledger in staging |

## Known gaps and risks

Kept current in [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md) §4, §6 and §7. The largest outstanding risks:
- some live integrations are unverified: Supabase Auth, the schema and Storage work, but FCM and OSRM on real data are pending, and Google Routes has no key,
- pricing, commission and dispatch values are placeholders awaiting product decisions,
- the apps have not run on a device or against a running backend, and phone sign-in waits for an SMS provider (IDN-1, IDN-6).
