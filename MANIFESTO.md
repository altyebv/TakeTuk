# The TAKE-TUK Engineering Manifesto

This is the engineering constitution of TAKE-TUK. It is not marketing. It states what we build, the principles that govern how we build it, and why. Detailed specifications live in `docs/`. This document explains the reasoning behind them and changes only when a principle changes.

## 1. What TAKE-TUK is

TAKE-TUK is a transportation, food-marketplace and logistics platform that starts in Wad Madani, Sudan. Passengers, many of them university students, book affordable rides in local three-wheelers (raksha). Later, they will order food and send goods through the same platform. Drivers find paid work. Merchants reach customers. Operators keep it trustworthy.

## 2. What we are trying to accomplish

A platform that works **reliably under the real conditions of its first market**:

- intermittent mobile networks,
- low-end phones,
- cash payments,
- negotiated prices,
- a small operations team,
- a tight budget.

Beyond that, it should grow one city at a time without a rewrite. We will judge success by rides completed correctly, drivers paid correctly, and incidents explained quickly. The size of the feature list or the codebase is not the measure.

## 3. Governing principles

1. **Build for the market we have.** Cash first, negotiation first, retry-safe APIs for flaky networks. Do not import assumptions from other markets without checking them.
2. **Correctness before features.** One correct ride-booking flow is worth more than five half-working services.
3. **The backend decides.** Prices, minimum fares, assignments, state transitions, financial records and authorization are computed and enforced on the server. Client values are requests, never facts.
4. **PostgreSQL is the source of truth.** What the database says, happened. Notifications, caches and client state are hints that clients reconcile against the API.
5. **Make illegal states unrepresentable, in two places.** Business invariants live in domain code and as database constraints, triggers and privileges. One layer may have a bug. The other still holds.
6. **Explicit lifecycles.** Every critical entity has a documented state machine. Statuses change only through named use cases that check actor, ownership and current state.
7. **Boundaries over cleverness.** Modules own their data and expose small interfaces. Abstraction is added where it protects the domain from change, such as providers, and nowhere else.
8. **Fail closed, loudly.** If the routing provider is down, there is no quote. We do not invent a fallback fare. If configuration is invalid, the process does not start. Silent fallbacks are bugs.
9. **Explainability.** Every fare, commission and assignment can be explained after the fact from stored inputs: policy versions, route provenance, offer rows and audit events.
10. **Honesty in status.** We distinguish implemented, tested, partially implemented and planned work, in code comments, documentation and reports. We never claim an integration works until it has been verified.

## 4. Why this architecture

- **A modular monolith (ADR-0001).** The hardest guarantees, one driver per ride and financial consistency, are single-database transactions. One deployable is cheap to run and easy to reason about. Explicit modules with enforced boundaries keep it maintainable and leave the door open to extracting a service when a demonstrated need appears.
- **NestJS and strict TypeScript (ADR-0002).** These are mandated. NestJS supplies structure (modules, dependency injection, guards) that suits a domain-oriented monolith. Strictness and runtime validation (Zod, ADR-0014) close the gap between types and untrusted input.
- **PostgreSQL authoritative (ADR-0003, ADR-0013).** Concurrency safety comes from row locks, conditional updates and unique constraints. These are database features, so we write the SQL explicitly and keep it reviewable.
- **Server-controlled operations (ADR-0007, ADR-0015).** Clients cannot reach domain tables at all. One authorization model, in one place, tested.
- **State machines and transaction boundaries.** Most production incidents in dispatch systems are about state: double assignment, stuck rides, phantom payments. Each use case is one transaction that locks in a fixed order and commits state, audit and outbox together. That makes those incidents structurally impossible rather than unlikely.

## 5. How we approach security

Security is built in from the first commit:

- verified tokens, not trusted claims,
- deny-by-default routes,
- ownership and approval checks inside transactions,
- a least-privilege database role that cannot alter history or schema,
- private documents behind short-lived signed URLs,
- an append-only audit trail.

No security or authorization check is ever bypassed to make a demo work. Secrets never enter the repository. Details: `docs/security/SECURITY.md`.

## 6. How we evaluate new dependencies

A dependency must:

- solve a problem we actually have,
- be actively maintained,
- have a license compatible with commercial use,
- be small relative to what it saves.

Each new runtime dependency is justified in the change that introduces it, and in an ADR when it is architectural. We prefer the platform (PostgreSQL features, Node built-ins) and a few well-known libraries over frameworks that hide behaviour. Example: transactions and the outbox use PostgreSQL directly instead of a job-queue library (ADR-0010).

## 7. How we control infrastructure cost

- One API service, one managed database, no broker, no cluster orchestration.
- Paid APIs are called only where they change a business decision: one routing call per quote, never for driver discovery. Expensive endpoints are rate-limited.
- Development and test environments use local substitutes (a fake routing provider, in-memory storage, logged notifications) instead of paid services.
- The long-term plan is to reduce map-provider dependency by building independent geographic capability from lawfully obtained data, such as OpenStreetMap under its license and consented GPS observations. Provider content is never used beyond its terms.

## 8. When we introduce more complexity

Only with evidence:

- a measured bottleneck,
- an operational incident,
- a confirmed product requirement.

The bar rises with the cost: a new index is cheap, a new service is not. Each step on the scaling path in `SYSTEM_ARCHITECTURE.md §10` is taken only when the previous one is insufficient. Speculative infrastructure is a cost we pay now for a benefit we may never receive.

## 9. How we document and review architectural change

- Decisions are recorded as ADRs (`docs/architecture/decisions/`). They are amended or superseded when experience changes them, never silently contradicted.
- Assumptions are recorded in `docs/product/OPEN_DECISIONS.md` until product confirms them. An assumption is not a business rule.
- Specifications (`DOMAIN_MODEL`, `STATE_MACHINES`, `DATABASE_DESIGN`, `API_CONVENTIONS`, `SECURITY`, `OPERATIONS`) are updated in the same change as the behaviour they describe. Migrations remain authoritative over documentation.
- Every change is reviewed against this manifesto. A reviewer may block a change for violating a principle even if the tests pass.

## 10. What "done" means

A feature is done when:

1. its rules are documented (domain, state machine, API),
2. it is implemented through explicit use cases with backend authorization,
3. its schema changes are migrations that apply to a clean database,
4. it has tests for its business rules, and, where relevant, for concurrency, idempotency, authorization and failure behaviour,
5. those tests **have run and passed** (compiling is not passing),
6. documentation and the OpenAPI contract match the behaviour,
7. its known gaps are written down.

Anything less is "partially implemented", and is reported as such.

## 11. Implementation status

As of 2026-10-23 (second increment). Details are in the linked documents.

| Area | Status | Reference |
|---|---|---|
| Documentation foundation, ADRs 0001–0016 | Written and reconciled with the implementation | `docs/` |
| Backend scaffold, configuration, health, logging, CLI | Implemented and tested | `docs/operations/OPERATIONS.md` |
| Database schema and migrations | Implemented. Tested from a clean database on PostgreSQL 16 + PostGIS 3.4. **Not yet applied through the Supabase CLI** | `docs/architecture/DATABASE_DESIGN.md` |
| Identity and authorization | Implemented and tested with locally signed tokens. **Not verified against a live Supabase project** | `docs/security/SECURITY.md` |
| Ride-booking vertical slice (negotiation, dispatch, atomic assignment, trip, cash payment, commission ledger) | Implemented and tested end to end against PostgreSQL, including concurrency, idempotency and failure tests | `docs/domain/STATE_MACHINES.md` |
| External integrations (Google Routes, FCM, Supabase Storage) | Adapters written and unit-tested against documented formats. **Not verified against live services** | `docs/IMPLEMENTATION_REPORT.md` |
| Self-hosted routing (OSRM) | Implemented. Verified against a real OSRM server on a synthetic network. **Not yet run on Wad Madani map data** | ADR-0017, `infra/osrm/README.md` |
| Flutter apps (passenger, driver) and shared packages | Foundation implemented and tested: generated API client, sign-in, registration, session, Arabic/RTL. Debug APKs build in CI. **Not yet run on a device or signed in against a live Supabase project** | `apps/README.md`, ADR-0018 |
| CI workflow | Runs and passes on GitHub Actions (format, lint, type check, tests against PostGIS, build, audit) | `.github/workflows/backend.yml` |
| Container image | Dockerfile written. **Not yet built** | `backend/Dockerfile` |
| Ride screens in the apps, web dashboards, marketplace, deliveries, disputes, digital payments | Planned | `docs/IMPLEMENTATION_ROADMAP.md` |

This table is updated at every milestone. If it disagrees with the implementation report, the report is authoritative and this table is corrected.
