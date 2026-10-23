# ADR-0012: Initial driver matching and assignment strategy

- Status: Accepted
- Date: 2026-10-23

## Context

Requests must be offered to eligible drivers automatically, while negotiation happens per driver, and assignment must be safe under concurrency. The policy must be simple and explainable at first.

## Decision

- **Batch offers in rounds.** Each round offers the ride to up to `DISPATCH_BATCH_SIZE` (default 5) eligible drivers within `DISPATCH_RADIUS_METERS` (default 3000) of the pickup, nearest first by straight-line distance from their last position received within `DRIVER_LOCATION_MAX_AGE_SECONDS` (default 120). When every offer of a round is closed and the ride is still searching, the next round excludes drivers already offered.
- **Eligibility** is evaluated in a single SQL statement: approval, availability, approved active vehicle, compatibility, service area, location freshness and radius, no active assignment, no open offer, not previously offered, and not the passenger.
- **One open offer per driver** (database-unique), so a driver negotiates one ride at a time (DSP-2).
- **First valid acceptance wins.** The assignment transaction locks the ride row, then re-checks every precondition. Partial unique indexes guarantee one active assignment per ride and per driver (STATE_MACHINES §3).
- **Thresholds are configuration**, not code constants.

## Alternatives considered

- **Sequential single-driver offers (classic ride-hailing).** Slower with negotiation, because each driver could counter in turn.
- **Broadcast to all nearby drivers.** Maximises contention and annoys drivers.
- **ETA-based ranking through the routing API.** Accurate, but it costs one routing call per candidate. Revisit with a self-hosted routing engine.
- **Optimisation or ML matching.** Prohibited until evidence justifies it.

## Rationale

Small batches give passengers quick responses without flooding drivers. Every rule can be explained to an operator by looking at the stored offer rows (`dispatch_round` and `distance_to_pickup_meters`).

## Consequences

- Straight-line distance can mis-rank drivers across obstacles (rivers, closed roads). Accepted for v1.
- One-open-offer-per-driver means a driver who has counteroffered receives no other offers until the passenger answers or the window expires.

## Risks

- Default thresholds are guesses and need operational tuning (DSP-1).
