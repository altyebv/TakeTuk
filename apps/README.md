# Client applications (planned)

No client code exists yet. The backend API (`docs/api/openapi.json`) is the contract every client builds on (ADR-0007).

| Directory (planned) | Stack | Notes |
|---|---|---|
| `apps/passenger_app` | Flutter | Ride request, negotiation, trip, history (ADR-0006) |
| `apps/driver_app` | Flutter | Onboarding and documents, availability and location, offers, trips, earnings |
| `apps/admin_web` | React + TypeScript | Driver verification queue, document viewer, policies, rides, audit |
| `apps/merchant_web` | React + TypeScript | Marketplace phase |
| `packages/` | Dart / TypeScript | `taketuk_api` (generated from OpenAPI), `taketuk_auth`, `taketuk_ui`, `taketuk_core` |

The apps were not scaffolded in the first increment: no Flutter SDK was available to build and verify them, and the directive puts the backend security model first. See `docs/IMPLEMENTATION_ROADMAP.md`, phases 9–11.
