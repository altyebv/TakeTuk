# ADR-0017: Self-hosted OSRM as a routing provider

- Status: Accepted
- Date: 2026-10-23

## Context

The minimum fare depends on a road-distance estimate (ADR-0011). ADR-0008 chose the Google Routes API, but Google Maps Platform needs a billing account with a payment card that the team cannot use for now: prepaid cards are refused. Without a real provider the API cannot run in production, because configuration refuses the `dev_fake` provider there.

ADR-0008 already named OpenStreetMap with a self-hosted routing engine as the long-term direction (MANIFESTO §7), and ADR-0009 keeps adding a provider to one adapter plus configuration.

## Decision

- Add `OsrmRoutingProvider` (`ROUTING_PROVIDER=osrm`) behind the existing `RoutingProvider` port. It calls the OSRM HTTP `route` service (API v1) of a **self-hosted** `osrm-routed` serving an OpenStreetMap extract with the stock car profile and the MLD algorithm. Results are labelled `osrm`.
- **Bounded snapping.** Every request sends `radiuses` (`OSRM_SNAP_RADIUS_METERS`, default 500 m). Without it OSRM moves a point to the nearest mapped road however far away it is. Against a real server, a pin 3.3 km from any road was silently moved and priced as a 545 m trip. Beyond the radius OSRM answers `NoSegment`, which maps to `NO_ROUTE_FOUND`.
- **Error mapping:**
  - `NoRoute` and `NoSegment` (HTTP 400) map to `NO_ROUTE_FOUND`.
  - Other OSRM error codes, any other HTTP status, timeouts and unparseable bodies map to `ROUTING_UNAVAILABLE`.
  - There is never a fallback distance (ADR-0009).
- **One dataset per instance.** `osrm-routed` serves one profile whatever the URL says, so the configured instance is used for `drive` only. `two_wheeler` requests (food delivery, not yet launched) fail closed with `ROUTING_UNAVAILABLE` rather than silently using car data.
- **Transport.** Route requests carry trip coordinates, which are personal data. In production `OSRM_BASE_URL` must be `https`, unless `OSRM_ALLOW_HTTP=true` declares that OSRM is reachable only over a private network that is itself encrypted.
- Google remains a supported provider (`ROUTING_PROVIDER=google`). Which one runs in production is a configuration choice (MAP-5).

## Alternatives considered

- **Public OSRM demo server (`router.project-osrm.org`).** Its usage policy forbids production use, and it offers no availability guarantee.
- **Hosted OSM routing APIs** such as openrouteservice, GraphHopper or Mapbox. Each needs its own account and terms review, and free tiers have daily quotas. Each could be another adapter later.
- **Valhalla or GraphHopper, self-hosted.** Comparable engines. OSRM was chosen for its small HTTP surface, fast queries and simple preprocessing for a single small region.
- **Waiting for a Google billing account.** That blocks production on a payment problem, and Google content cannot later be mixed into independent datasets (ADR-0008).

## Rationale

OSRM removes the payment blocker and the per-request cost, and lets us improve the map ourselves: missing streets fixed in OpenStreetMap appear in our routing after a dataset rebuild. The adapter is small, and the port isolates pricing from it.

## Consequences

- An `osrm-routed` service has to run, be monitored and be rebuilt when the extract is refreshed. The Wad Madani region is small, so the memory and preprocessing needs are modest, but they have not been measured on the real extract. `infra/osrm/README.md` covers dataset preparation.
- OpenStreetMap data is licensed under the ODbL. Distances derived from it are used internally for pricing. Any map or data shown to users needs "© OpenStreetMap contributors" attribution (MAP-2).
- The car profile approximates raksha travel, the same approximation as Google `DRIVE` (MAP-3). A custom profile is possible later.

## Verification

- **Done:** the adapter was exercised against a real `osrm-routed` v26.4.0 (prebuilt binaries, car profile, MLD) on a **synthetic** street grid at Wad Madani coordinates. Tested cases: a routed trip, the same point, a point beyond the snap radius, disconnected roads, and an unreachable server (`npm run test:live`). The unit tests use response bodies recorded from that server.
- **Not done:** routing on real Wad Madani OpenStreetMap data. No OSM extract could be downloaded in the build environment. Coverage and distance quality are therefore unknown (MAP-1). The Docker-based dataset preparation path has not been run.

## Risks

- **Incomplete OpenStreetMap coverage** of Wad Madani streets gives longer-than-real routes or `NO_ROUTE_FOUND`. Mitigation: check coverage before launch, contribute missing streets, and tune the snap radius.
- **A self-hosted service down means no quotes.** This fails closed, as with any provider. Mitigation: health monitoring and a restart policy; Google can be configured as an alternative.
