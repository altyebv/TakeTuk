# ADR-0011: Fare negotiation with a policy-driven minimum fare

- Status: Accepted
- Date: 2026-10-23

## Context

The directive requires negotiated pricing, with a server-enforced minimum fare derived from estimated trip distance. The values involved (distance, minimum fare, proposal, counteroffer, agreed fare, collected amount, commission) must remain distinct and explainable.

## Decision

- **Quote first.** The passenger requests a quote. The backend validates the service area, obtains a road distance from the routing provider, computes the minimum fare with the **active fare-policy version**, and persists a single-use quote (default validity 10 minutes). Rides are created only from quotes, so the client never supplies distance or minimum fare.
- **Minimum-fare formula** (integer minor units): `roundUp(max(floor, base + ceil(per_km × distance_m / 1000)), increment)`. The parameters live in versioned, immutable `fare_policies` per (service area, service type). No real price exists in code or migrations.
- **Negotiation per offer:**
  - The driver may accept the proposal, decline, or counteroffer a higher amount ≥ minimum (PRC-3).
  - Driver acceptance of the passenger's own proposal confirms the ride (PRC-2). A counteroffer requires the passenger's acceptance.
  - Each response window has a timeout, and nothing is confirmed until the acceptance conditions are met.
- **Agreement record.** A confirmed fare creates an immutable `fare_agreement` holding the basis, every input value, and the policy id and version.
- **Database backstops.** CHECK constraints keep the proposal, counteroffer and agreed fare at or above the snapshotted minimum. A trigger keeps policy parameters immutable after activation.

## Alternatives considered

- **Fixed fares.** Contradicts the product requirement.
- **Free negotiation without a minimum.** Rejected by the directive (it leads to unreasonably low fares).
- **Computing the minimum at ride creation instead of at quote time.** It forces a second routing call, and the passenger could see a different price than the one quoted.
- **Passenger chooses among accepting drivers.** It adds a step and latency. Kept open (PRC-2). The assignment logic supports either.

## Rationale

The quote fixes server-computed facts once, so every later step only compares integers against a snapshot. That is cheap, consistent and explainable.

## Consequences

- A policy change does not affect quotes already issued (PRC-6).
- Real prices need a product decision (PRC-1). Until then, environments only have development values, labelled in `seed.sql`.

## Risks

- Routing unavailability blocks quotes, and therefore new rides. That is intentional: the system fails closed. It is monitored through error rates.
