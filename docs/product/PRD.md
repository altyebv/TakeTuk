# TAKE-TUK — Product Requirements Document

| | |
|---|---|
| Status | Living document. Initial version written with the first backend vertical slice. |
| Owner | Product + engineering leads |
| Related | [MANIFESTO](../../MANIFESTO.md), [Domain model](../domain/DOMAIN_MODEL.md), [State machines](../domain/STATE_MACHINES.md), [Open decisions](OPEN_DECISIONS.md), [Roadmap](../IMPLEMENTATION_ROADMAP.md) |

Each requirement has a tag:

- **[C] Confirmed**: stated in the project directive.
- **[A] Assumption**: a reasonable interpretation that engineering adopted so work could continue. Each one is listed in [OPEN_DECISIONS.md](OPEN_DECISIONS.md) and must be confirmed or replaced by product.
- **[P] Planned**: confirmed as a direction but outside the current increment.

## 1. Vision

TAKE-TUK is a transportation, food-marketplace and logistics platform. It launches in **Wad Madani, Sudan** [C]. It connects passengers, drivers, restaurants, merchants and delivery providers [C].

The problems it addresses [C]:

- Passengers wait a long time for transport.
- Underserved neighbourhoods have little transport available.
- There is no convenient digital way to book a local tuk-tuk (raksha).
- No integrated local food-delivery marketplace exists.
- There is no affordable, accessible way to deliver goods other than food.

Expansion will happen one city at a time [C]. A future city may use different vehicles and workflows, so the domain must not hard-code Wad Madani's transport model [C].

## 2. Target users

| User | Description | Status |
|---|---|---|
| Passenger | Initially university students and others who rely on affordable local transport [C]. | Backend implemented for the ride slice |
| Driver | Operates a raksha, pickup or motorcycle. Must be verified and approved before taking commercial work [C]. | Backend implemented for the ride slice |
| Merchant | A restaurant or shop that sells through the marketplace and uses a web dashboard [C]. | [P] |
| Administrator / operator | TAKE-TUK staff who verify drivers, configure policies, investigate disputes and review finances [C]. | Backend foundation implemented (driver/vehicle review, policies, ride review, audit) |

## 3. Vehicles and services

| Vehicle type | Description | Passenger-capable | Initial compatible services |
|---|---|---|---|
| `raksha` | Covered three-wheeler, mainly for passengers [C] | Yes [C] | `passenger_transport` [C], `package_delivery` [A] |
| `pickup` | Open, roofless three-wheeler for goods [C] | **No** [C] | `goods_transport` [C], `package_delivery` [A] |
| `motorcycle` | Food and eligible package delivery [C] | **No**: must never be assigned passenger requests [C] | `food_delivery` [C], `package_delivery` [C] |

Service types: `passenger_transport`, `food_delivery`, `package_delivery` and `goods_transport`. Splitting "general logistics" into small parcels (`package_delivery`) and bulky goods (`goods_transport`) is [A].

Vehicles, services and the compatibility between them are separate concepts [C]. A vehicle's compatibility with a service is checked before every assignment [C]. The rule that a passenger service needs a passenger-capable vehicle is also enforced as a declarative database constraint (see [DATABASE_DESIGN](../architecture/DATABASE_DESIGN.md)).

## 4. Initial release scope

### 4.1 Passenger (ride booking)

| # | Requirement | Tag | Backend status |
|---|---|---|---|
| P1 | Register and authenticate (Supabase Auth; TAKE-TUK profile created by the backend) | C | Implemented |
| P2 | Maintain a passenger profile (display name) | C | Implemented |
| P3 | Select pickup and destination (coordinates plus optional labels) | C | Implemented |
| P4 | Get a quote with an estimated route distance and the minimum permitted fare | C | Implemented |
| P5 | Propose a fare of at least the minimum | C | Implemented |
| P6 | Track the request status (searching, counteroffers, assigned, and so on) | C | Implemented (polling; push notifications through the outbox) |
| P7 | Accept or reject a driver's counteroffer | C | Implemented |
| P8 | See the assigned driver's name, vehicle and phone number | C | Implemented |
| P9 | Contact the driver by phone (native dialer, using the revealed number) | C/A | Number revealed after assignment; in-app messaging and masked calling are [P] |
| P10 | Follow the trip lifecycle | C | Implemented |
| P11 | Cancel when the rules allow it | C | Implemented |
| P12 | View completed rides and their fare information | C | Implemented |
| P13 | Have at most one open ride at a time | A | Implemented (database constraint) |

### 4.2 Driver

| # | Requirement | Tag | Backend status |
|---|---|---|---|
| D1 | Register an account | C | Implemented |
| D2 | Submit driver and vehicle information | C | Implemented |
| D3 | Upload verification documents to private storage | C | Implemented behind a storage interface. The Supabase Storage adapter is written but has not been verified against a live project |
| D4 | Submit for verification and wait for approval before commercial work | C | Implemented |
| D5 | Set availability (online/offline) with an approved vehicle | C | Implemented |
| D6 | Submit location updates | C | Implemented (explicit updates; no continuous streaming) |
| D7 | Receive eligible ride offers | C | Implemented (automatic dispatch; polling plus push) |
| D8 | Accept the proposed fare, decline, or counteroffer | C | Implemented |
| D9 | Receive assignment confirmation | C | Implemented |
| D10 | Update trip status (arrived, started, completed) | C | Implemented |
| D11 | Confirm the cash collected, or report non-payment | A | Implemented |
| D12 | View earnings and financial records | C | Implemented (per-ride fare, collection and commission; commission balance owed) |

### 4.3 Merchant [P]

Register a business, submit it for approval, manage branches, menus, product availability and images, accept or reject orders, update preparation status, mark orders ready for collection, and view order history. The architecture reserves a Marketplace/Orders module and a React merchant dashboard. None of this is implemented.

### 4.4 Administration

| # | Requirement | Tag | Backend status |
|---|---|---|---|
| A1 | Review driver verification submissions and documents | C | Implemented (document view through short-lived signed URLs) |
| A2 | Approve, reject, suspend and reinstate drivers | C | Implemented |
| A3 | Review vehicles and manage service eligibility | C | Vehicle review implemented. Compatibility is managed by migration in v1 [A] |
| A4 | Manage merchants | C | [P] |
| A5 | Review rides | C | Implemented (read and force-cancel) |
| A6 | Investigate cancellations and disputes | C | Cancellation data recorded. Dispute workflow [P] |
| A7 | Configure fare policies | C | Implemented (versioned, draft → active) |
| A8 | Configure commission policies | C | Implemented (versioned, draft → active) |
| A9 | Review financial records | C | Partial: per-driver ledger readable. A dedicated finance reporting UI is [P] |
| A10 | View operational audit records | C | Implemented (query by entity) |

The administrative web interface is [P]. The backend enforces every administrative rule and never trusts frontend code [C].

### 4.5 Logistics and food delivery [P]

Both are represented in the domain model (service types, vehicle compatibility, and the delivery-job and merchant-order state machines in [STATE_MACHINES](../domain/STATE_MACHINES.md)). Neither is implemented. Ride booking comes first [C].

## 5. Key workflow: negotiated ride booking

The complete workflow, including timeouts, is in [STATE_MACHINES.md](../domain/STATE_MACHINES.md).

1. The passenger selects pickup and destination and requests a **quote**. The backend checks that both points lie in an active service area. It gets a road-distance estimate from the routing provider and computes the **minimum fare** with the active, versioned fare policy [C]. The quote is persisted, owned by the passenger, single-use and short-lived.
2. The passenger creates a **ride** from the quote with a **proposed fare**. The backend rejects proposals below the minimum [C]. Ride creation requires an `Idempotency-Key`.
3. The dispatcher selects eligible drivers. It checks approval, availability, vehicle compatibility, proximity, location freshness and existing assignments [C]. It creates time-limited **offers** in rounds, and no fare or assignment is confirmed at this point [C].
4. A driver may **accept** the proposed fare, **decline**, or **counteroffer** a higher amount that still meets the minimum [C].
   - Accepting the passenger's own proposal satisfies both parties, so the backend confirms the assignment atomically. The first valid acceptance wins [A].
   - A counteroffer must be accepted by the passenger before anything is confirmed [C].
5. The **fare agreement** is stored as an immutable record [C]. It holds the agreed amount, its basis, the passenger proposal, the counteroffer, the minimum fare, the fare-policy version and the route inputs.
6. The assigned driver moves the trip through arrived → in progress → completed. Completion creates a cash **payment record** (awaiting collection) and a **commission** ledger transaction [A]. The driver then confirms the amount collected [A].

The value types are never interchangeable [C]: estimated distance, minimum permitted fare, passenger proposal, driver counteroffer, final agreed fare, actual amount collected, and platform commission.

## 6. Non-functional requirements

| Area | Requirement |
|---|---|
| Correctness | PostgreSQL is authoritative. Critical invariants (one confirmed driver per ride, one active job per driver, fare ≥ minimum, motorcycle never passenger) are enforced by database constraints as well as application code [C]. |
| Concurrency | Concurrent acceptances never produce more than one assignment [C]. Verified by automated concurrency tests. |
| Idempotency | Retried ride creation, acceptance, completion and payment recording produce no duplicate effects [C]. |
| Security | Supabase JWT verification, backend authorization by role, ownership and state, private documents, least-privilege database role, and an append-only audit trail [C]. |
| Affordability | One deployable service, managed PostgreSQL, no message broker, and routing calls limited to one per quote with a per-user rate limit [C]. |
| Network conditions | Mobile networks may be slow or intermittent [A]. The API is designed for safe retries (idempotency) and small payloads. Clients reconcile state by polling the backend [C]. |
| Observability | Structured logs with request IDs; health and readiness endpoints. |
| Localisation | Arabic-first UI with English [A] (mobile scope, [P]). Amounts in SDG minor units [A]. |
| Data protection | Collect only the sensitive data that verification needs. Driver documents are private. Exact location history is not retained (only the latest driver position) [A]. |

## 7. Explicit exclusions from the initial release

- Merchant dashboard, marketplace, menus and food ordering.
- Delivery-job dispatch for food, packages and goods (modelled, not implemented).
- Digital payments and payment-provider integrations; cash only [A].
- Commission settlement workflows, payouts, refunds and penalties. The ledger is designed for them, but none is implemented.
- Dispute resolution workflow.
- Cancellation fees. Cancellation facts are recorded; no penalty is applied [C: do not hard-code a penalty].
- In-app chat, masked calling, live trip tracking and continuous location streaming.
- Ratings.
- Machine-learning or optimisation-based matching [C].
- Multi-city operations tooling (the data model is multi-area ready).
- Mobile (Flutter) and web (React) applications. The backend API comes first; the clients are the next phases.

## 8. Open product decisions

[OPEN_DECISIONS.md](OPEN_DECISIONS.md) lists every assumption that needs a product decision. The most significant are:

1. Real fare and commission values for Wad Madani. Only development values exist.
2. Whether a driver accepting the passenger's proposal confirms the ride immediately, or the passenger chooses among drivers.
3. What happens after a driver cancels an assigned ride: re-dispatch automatically, or require a new request (current behaviour).
4. Cancellation penalties and no-show rules.
5. When commission is charged when cash is not collected.
6. The legally required driver and vehicle documents in Sudan.
7. Phone-number exposure versus masked calling.
8. Google Maps Platform coverage, pricing and data-retention terms for Wad Madani.
