# ADR-0007: Backend-controlled business operations

- Status: Accepted
- Date: 2026-10-23

## Context

Supabase lets clients read and write tables directly through its Data API, with authorization done by Row Level Security policies. TAKE-TUK's critical operations involve multi-step validation across entities, concurrency control and financial effects: quoting and minimum fares, negotiation, assignment, trip completion, ledger entries and driver approval.

## Decision

All business operations go through the NestJS API. Clients never read or write domain tables directly:

- Domain tables live in the `taketuk` schema, which is not exposed through the Supabase Data API. `anon` and `authenticated` have no privileges on it (ADR-0015).
- State transitions happen only through named use cases that validate actor, ownership and state.
- Prices, minimum fares, distances, assignment decisions and financial amounts are computed on the server. Client-supplied values are proposals (for example, a proposed fare) and are validated against server-computed facts.
- Push notifications and client caches are never authoritative. Clients reconcile by calling the API.

## Alternatives considered

- **Direct client access with RLS for simple reads (profile, ride history).** It would save some endpoints. It also exposes the schema as a public contract and creates two authorization systems to keep consistent. This may be revisited for specific read-only, high-volume cases such as Realtime subscriptions, through views designed for the purpose.
- **Database functions (RPC) for business logic.** Keeps logic near the data but splits the domain between SQL and TypeScript, and is harder to test and review.

## Rationale

One authorization model, one place for business rules, testable use cases, and the ability to change the schema without breaking clients.

## Consequences

- More endpoints to build than with a direct-database approach.
- A privileged database connection (the backend role) must be protected, and authorization correctness rests on backend code, which is covered by security tests.

## Risks

- A bug in backend authorization exposes data. Mitigated by deny-by-default route guards (every route must declare its access rule), ownership checks in use cases, and authorization tests.
