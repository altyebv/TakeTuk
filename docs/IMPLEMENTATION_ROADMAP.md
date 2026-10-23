# TAKE-TUK — Implementation roadmap

Status legend: ✅ done (implemented and tests passing) · 🟡 partial · ⏳ in progress · 📋 planned.

## Phase 1: Repository reconnaissance and planning ✅

- The repository held one placeholder file (`init.md`: "almost ready !"). It was removed. No other prior work existed.
- Environment: Node 22 was preinstalled, and Node 24 LTS was installed for the toolchain (ADR-0002). PostgreSQL 16 was available and PostGIS 3.4 was installed. No Docker daemon (so no Supabase CLI local stack) and no Flutter SDK.
- No blocking ambiguity. Assumptions are recorded in [OPEN_DECISIONS](product/OPEN_DECISIONS.md).

## Phase 2: Documentation foundation ✅

PRD, system architecture, domain model, state machines, API conventions, security, manifesto, ADRs 0001–0016 and the open-decision register.

## Phase 3: Repository and infrastructure foundation ⏳

- NestJS backend with strict TypeScript, ESLint, Prettier and Jest.
- Validated configuration, structured logging, request ids, health and readiness endpoints.
- Supabase configuration and migrations. A plain-PostgreSQL migration runner for tests and CI.
- `.env.example`, Dockerfile, CI workflow.

**Done when:** a clean database migrates; lint, type check and tests pass; the service starts locally against the migrated database.

## Phase 4: Identity and authorization ⏳

Supabase JWT verification (JWKS and legacy HS256), users and roles, permission guards, registration endpoints, operator CLI for admin grants.

**Done when:** security tests pass for missing, expired, forged, wrong-issuer and anonymous tokens, unregistered users, disabled users, missing permissions, and cross-user access.

## Phase 5: Ride-booking vertical slice ⏳

Driver onboarding and verification, vehicles and compatibility, availability and location, fare policies and quotes, routing port, ride creation, dispatch, negotiation, atomic assignment, trip lifecycle, cancellation, payment record and commission ledger, audit, outbox and notifications.

**Done when:** an end-to-end HTTP test runs a ride from quote to cash collection; concurrency tests prove a single assignment; idempotency tests prove no duplicates.

## Phase 6: Testing and verification ⏳

## Phase 7: Handoff ⏳

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

Kept current in [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md) §7–§8.
