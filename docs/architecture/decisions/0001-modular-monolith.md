# ADR-0001: Modular monolith backend

- Status: Accepted
- Date: 2026-10-23

## Context

TAKE-TUK will eventually cover ride booking, a food marketplace, deliveries, payments and administration. At launch it serves one city with a small engineering team and a tight infrastructure budget. The most critical behaviours, assignment and financial records, need strong transactional consistency across several business concepts. Examples are a ride, its offers, the fare agreement, the assignment, the payment record and the ledger.

## Decision

Build one deployable NestJS application, organised into explicit business modules: identity, geography, fleet, drivers, pricing, mobility (which includes driver matching), finance, notifications, and the platform modules audit and outbox. Each module:

- owns its tables and is the only module that writes them,
- exposes a small public API from its `index.ts` (application services and types),
- keeps domain rules in `domain/` (pure TypeScript, no framework), use cases in `application/`, persistence and adapters in `infrastructure/`, and HTTP in `http/`.

Cross-module calls go through public services. When a cross-module change must be atomic (for example, trip completion creating the payment record and ledger entries), the caller passes its transaction handle to the other module's public service. Module boundaries, the absence of cycles, and table write ownership are checked by an automated architecture test.

## Alternatives considered

- **Microservices per domain.** These bring network calls, distributed transactions or sagas for assignment and payment consistency, many deployments, and service discovery. That is far too much operational cost for a one-city launch.
- **Unstructured monolith.** Fast at first, but boundaries erode and later extraction becomes very hard.
- **Separate deployments for workers.** Possible later. Background workers currently run in-process behind a feature flag, so they can be split into a second process from the same codebase without code changes.

## Rationale

One process and one database give ACID transactions for the invariants that matter most, a single deployment, and low cost. Explicit modules keep the codebase navigable and preserve the option of extracting a module when a real scaling or ownership need appears.

## Consequences

- All modules scale together. Horizontal scaling means running more identical instances. Workers coordinate through `FOR UPDATE SKIP LOCKED` and claim timestamps, so multiple instances are safe.
- Boundaries need discipline: the architecture test fails the build on violations.
- A cross-module read query (the dispatch candidate query reads driver, fleet and offer tables) is allowed only in the module that owns the use case. It is documented and read-only.

## Risks

- Developers bypassing a module's public API for convenience. Mitigated by the architecture test, which covers imports and SQL write ownership.
- A slow module (for example, heavy reporting) affecting others. Mitigation: reporting queries move to a read replica when needed.
