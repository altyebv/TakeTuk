# ADR-0008: Google Maps Platform as the initial mapping provider

- Status: Accepted, pending review of coverage, pricing and terms (MAP-1, MAP-2)
- Date: 2026-10-23

## Context

The minimum fare depends on an authoritative road-distance estimate. Clients need map display and place search. The directive names Google Maps Platform as the initial provider, subject to review.

## Decision

- **Routing (server side):** Google Routes API `computeRoutes`, called only from the backend, once per quote, with a field mask limited to `routes.distanceMeters` and `routes.duration`. Travel mode `DRIVE` approximates raksha travel (MAP-3).
- **Map display and place autocomplete (clients):** the Google Maps SDK and Places in the Flutter apps ([P]).
- Only derived numbers are stored as fare-calculation inputs (distance in meters, duration in seconds, provider name and time). Raw responses, polylines and place content are not stored. This must pass a terms review before production (MAP-2).
- Google map content is never extracted, bulk downloaded, cached beyond permitted periods, or mixed into independent datasets such as OpenStreetMap.

## Alternatives considered

- **OpenStreetMap with self-hosted OSRM, Valhalla or GraphHopper.** Lower marginal cost and no terms restrictions on derived data. But it requires hosting and monitoring a routing engine, and OSM coverage in Wad Madani is unverified. It is the planned long-term direction (MANIFESTO), and ADR-0009 keeps the switch cheap.
- **Mapbox.** Similar trade-offs to Google, with unverified coverage.

## Rationale

The directive specifies Google, it has broad coverage, and it involves no infrastructure to operate. The cost is bounded by computing routes only for quotes (never for discovery) and by per-user quote rate limits.

## Consequences

- A Google Maps API key with Routes API enabled, restricted to the backend server, is required for production. It is **not configured**. Development and tests use the `dev_fake` routing provider, which the configuration refuses in production.

## Risks

- Cost growth with quote volume. Mitigation: rate limits, and caching only where the terms permit (not implemented).
- Terms restricting storage of derived distance. Mitigation: legal review, and the provider abstraction allows switching.
- The Google adapter is unit-tested against the documented request and response shapes but has **not** been verified against the live API.
