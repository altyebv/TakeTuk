# ADR-0009: Narrow provider abstraction for routing and geocoding

- Status: Accepted
- Date: 2026-10-23

## Context

The mapping provider may change for reasons of cost, coverage or terms, and TAKE-TUK intends to build independent geographic capabilities over time. Domain logic (pricing, mobility) must not depend on any provider's response format.

## Decision

- Define a `RoutingProvider` port in the geography module with one operation:
  `estimateRoute({ origin, destination, travelMode }) → { distanceMeters, durationSeconds | null, provider, estimatedAt }`
  It fails only with typed errors: `RoutingUnavailableError` (timeout, network, 5xx, quota) or `NoRouteFoundError`.
- Adapters: `GoogleRoutesProvider` (production) and `DevFakeRoutingProvider`. The fake is deterministic, development and test only, labels its results `dev_fake`, and is rejected by configuration when `NODE_ENV=production`.
- **Failure policy:** when the provider is unavailable, the quote fails with `503 ROUTING_UNAVAILABLE`. The backend never falls back to straight-line distance and never invents a fare.
- Geocoding and place search are not needed by the backend in v1. A `GeocodingProvider` port is added only when a backend use case needs one. This is deliberately not a generic mapping framework.

## Alternatives considered

- **Calling Google directly from the pricing module.** It couples domain code to Google's formats and makes tests depend on network mocks.
- **A generic "maps service" covering tiles, places, geocoding and routing.** Speculative. Clients render maps directly.

## Rationale

One small interface isolates the only provider capability that affects business decisions.

## Consequences

- Adding OSRM or Valhalla later means adding one adapter and changing configuration. Pricing and mobility code stay as they are. This held for OSRM (ADR-0017): one adapter file, configuration, and no change to pricing or mobility.

## Risks

- The interface may need extension (waypoints, vehicle profiles). It is extended when a requirement appears.
