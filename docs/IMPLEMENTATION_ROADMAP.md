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

🟡 **Not verified here:** the Docker build, the Supabase CLI stack, and the CI run (see the implementation report §4).

## Phase 4: Identity and authorization ✅

Supabase JWT verification (JWKS / HS256), the users and roles model, the deny-by-default access guard, permissions, registration, and the operator CLI for admin grants. Security tests cover every case listed in the completion criteria, plus a route-by-route authorization sweep.

## Phase 5: Ride-booking vertical slice ✅

The full slice was implemented as specified: quote → negotiated ride → dispatch → accept or counteroffer → atomic assignment → trip → completion → cash obligation, commission ledger and cash report. It also includes cancellation and expiry, audit and outbox notifications.

## Phase 6: Testing and verification ✅

170 tests across 19 suites, all passing (see [IMPLEMENTATION_REPORT](IMPLEMENTATION_REPORT.md) §2): unit, architecture, integration, concurrency, idempotency, authorization, failure and migration tests.

## Phase 7: Handoff ✅

Documentation reconciled with the implementation, and the implementation report written.

---

## Next phases (planned)

| Phase | Scope | Depends on | Completion criteria |
|---|---|---|---|
| 8. Live integration verification | Supabase project (Auth JWKS, Storage bucket, role creation, `supabase db push`), Google Routes key, FCM project. Run the existing adapters against them | Accounts and credentials | Each adapter exercised in staging; findings fed back into ADRs |
| 9. Flutter foundation | Monorepo packages (`taketuk_api`, `taketuk_auth`, `taketuk_ui`), passenger and driver app shells, sign-in, registration | Phase 8 (Auth) | Apps build in CI; sign-in against staging |
| 10. Passenger and driver ride UX | Quote → request → negotiation → trip screens; driver onboarding, availability, offers | Phase 9 | Pilot-ready ride flow on devices |
| 11. Admin web (React) | Driver verification queue, document viewer, policy management, ride lookup, audit | Phase 8 | Operators can approve drivers and configure policies without SQL |
| 12. Operations hardening | Global rate limiting, alerting on failed outbox and dispatch, account deletion, document retention, restore drill, admin MFA (`aal2`) | — | Runbooks exercised |
| 13. Marketplace and orders | Merchants, branches, catalogue, merchant dashboard, orders | Phase 11 | Order state machine implemented and tested |
| 14. Delivery jobs | Delivery-job aggregate reusing dispatch and assignment | Phase 13 | Food and package deliveries end to end |
| 15. Payments beyond cash | Provider evaluation (mobile money and bank apps), reconciliation jobs, settlements | Product decision FIN-5 | Reconciled ledger in staging |

## Known gaps and risks

Kept current in [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md) §4, §6 and §7. The largest outstanding risks:
- live integrations are unverified (Supabase, Google Routes, FCM),
- CI has not run,
- pricing, commission and dispatch values are placeholders awaiting product decisions,
- there is no client application yet.
