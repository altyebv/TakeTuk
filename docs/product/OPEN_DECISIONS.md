# Open product and API decisions

This is the register of unresolved decisions. The engineering team made a choice for each item so implementation could continue, but each choice is **provisional** until product confirms it. Do not treat a provisional behaviour as a permanent business rule. Resolving an item means updating this file, the affected specification and the code, and recording the outcome below.

Status values: `open` (provisional behaviour implemented), `needs-input` (blocked on external information), `resolved`.

## Pricing and negotiation

| ID | Decision | Current provisional behaviour | Consequence of changing it | Status |
|---|---|---|---|---|
| PRC-1 | Real minimum-fare parameters (base, per-km, floor, rounding) for Wad Madani | Only development values in `supabase/seed.sql`, clearly labelled. No migration contains a price. | Configuration only (create and activate a new fare-policy version). | needs-input |
| PRC-2 | Should a driver's acceptance of the passenger's proposal confirm the ride immediately, or should the passenger pick among drivers? | Immediate confirmation, first valid acceptance wins. | Adds a `driver_accepted` offer state and a passenger "choose driver" step. Assignment logic stays the same. | open |
| PRC-3 | Can a counteroffer be lower than the passenger's proposal? | No. It must be strictly greater than the proposal and at least the minimum fare. An equal amount is an acceptance. | Validation change in `negotiation.ts`. | open |
| PRC-4 | Is there a maximum fare or counteroffer cap (fat-finger and abuse protection)? | No business cap. A technical bound prevents overflow. | Add a policy field and validation. | open |
| PRC-5 | Can the passenger raise the proposed fare while searching? | No. They cancel and request again. | New transition `searching → searching` with re-offer semantics. | open |
| PRC-6 | Does a quote lock the policy version for its lifetime? | Yes. A quote is valid for 10 minutes (configurable) and fixes the minimum fare and policy version. | None for the API. | open |
| PRC-7 | Must the destination also lie inside the service area? | Yes, both pickup and destination. | Relax the quote validation. | open |
| PRC-8 | Currency and minor units | SDG, amounts as integer minor units (ISO 4217 exponent 2). | Changing the currency needs a new policy version. The amount representation is stable. | open |

## Dispatch and assignment

| ID | Decision | Current provisional behaviour | Status |
|---|---|---|---|
| DSP-1 | Matching parameters (radius, batch size, offer timeout, counteroffer timeout, search timeout, location freshness) | Environment configuration with development defaults (see OPERATIONS). | open |
| DSP-2 | May a driver hold more than one open offer at a time? | No. At most one open offer per driver (enforced by a database constraint). This keeps conflicts rare and the driver UI simple. | open |
| DSP-3 | After a driver cancels an assigned ride, should the system re-dispatch? | No. The ride ends as `cancelled` (cancelled by driver) and the passenger may request again. | open |
| DSP-4 | Re-offering a ride to a driver who declined or let an offer expire | Never re-offered for the same ride. | open |
| DSP-5 | Ordering of candidates | Straight-line distance from the last fresh position, nearest first. Ties are broken by driver id. ETA-based ordering is planned. | open |

## Cancellation, payments and finance

| ID | Decision | Current provisional behaviour | Status |
|---|---|---|---|
| FIN-1 | Real commission rate(s) | Development value only (seed). | needs-input |
| FIN-2 | When is commission charged? | At trip completion, based on the **agreed fare**, using the commission policy snapshotted at assignment. Reversal through disputes is planned. | open |
| FIN-3 | Commission when the passenger does not pay | Still charged. The driver reports `reported_unpaid` for admin follow-up. A reversal workflow is planned. | open |
| FIN-4 | Cancellation penalties and passenger no-show compensation | None applied. Cancellation actor, reason, stage and timestamps are recorded so a future policy can be applied and explained. | open |
| FIN-5 | Payment methods | Cash only. Mobile-money and bank-app payments (common in Sudan) need provider evaluation. | open |
| FIN-6 | Commission settlement (how drivers pay owed commission) | Not implemented. The ledger records amounts owed. | open |
| FIN-7 | Rounding of commission | Round half up to whole minor units. | open |

## Drivers and vehicles

| ID | Decision | Current provisional behaviour | Status |
|---|---|---|---|
| DRV-1 | Legally required documents for drivers and vehicles in Sudan | Required for submission: `driver_photo`, `driving_license`, `national_id`, plus `vehicle_registration` and `vehicle_photo` for at least one vehicle. Configured in one code constant. | needs-input |
| DRV-2 | Do we store a national ID number? | No. Only the document image is stored, in private storage. | open |
| DRV-3 | Vehicle ownership and shared vehicles (shift driving, fleet owners) | A vehicle record belongs to one driver. The same plate may be registered by different drivers, and reviewers see duplicates. | open |
| DRV-4 | Can a driver go offline with an active trip? | Yes. Offline only stops new offers. | open |
| DRV-5 | Document retention period after approval or rejection | Not defined. Documents are kept until a retention policy exists. | needs-input |

## Identity, contact and privacy

| ID | Decision | Current provisional behaviour | Status |
|---|---|---|---|
| IDN-1 | Sign-in method | Supabase Auth. The phone number is taken from the verified token claim when present. Whether SMS OTP delivery to Sudanese numbers is reliable must be checked with the SMS provider. | needs-input |
| IDN-2 | Phone numbers exposed between passenger and driver | The assigned counterpart's phone is revealed only while the assignment is active, and only to the two parties. Masked calling is planned. | open |
| IDN-3 | Can one person be both passenger and driver? | Yes (separate roles). A driver can never receive their own ride request. | open |
| IDN-4 | Admin roles granularity | A single `admin` role mapped to fine-grained permissions in code, so it can be split later (support, finance, verification). | open |
| IDN-5 | Where the apps keep the session | `supabase_flutter` persists the session (including the refresh token) in the app's private storage, which is not an encrypted keystore. A secure-storage adapter can replace it. | open |

## Maps and data

| ID | Decision | Current provisional behaviour | Status |
|---|---|---|---|
| MAP-1 | Road coverage and distance quality for Wad Madani (OpenStreetMap for OSRM, Google Maps Platform for Google) | Not evaluated for either. The OSRM adapter is verified against a real OSRM server on a synthetic network only; the Google adapter is not exercised live. Check before launch: compare quotes for known trips with distances measured on the ground, and tune `OSRM_SNAP_RADIUS_METERS` (default 500 m). | needs-input |
| MAP-2 | Retention of route distance and duration, and data licensing | Stored as fare-calculation inputs (distance, duration, provider name, timestamp). Raw responses and polylines are not stored. Google: **terms review required** before production. OpenStreetMap (OSRM): ODbL. Internal use of derived distances is allowed; maps or data shown to users need "© OpenStreetMap contributors" attribution. | needs-input |
| MAP-3 | Travel mode for raksha | Car routing is used as an approximation (Google `DRIVE`, OSRM car profile). Tuk-tuks may use roads that cars do not. With OSRM a custom raksha profile is possible. | open |
| MAP-4 | Official Wad Madani service-area boundary | Only an approximate development bounding box in `seed.sql`. | needs-input |
| MAP-5 | Production routing provider | Self-hosted OSRM (ADR-0017), because Google billing needs a payment card the team cannot use for now. Google stays configurable. Switching is a configuration change; quotes record which provider priced them. | open |
| MAP-6 | Map display and place search in the apps | Not built yet. Google Maps SDK keys need the same billing account as the Routes API (ADR-0008 amendment). Candidates: `flutter_map` with an OpenStreetMap-based map provider (attribution required), or Google once billing is possible. | needs-input |

## Apps

| ID | Decision | Current provisional behaviour | Status |
|---|---|---|---|
| APP-1 | Store identity and release signing | Android application ids `app.taketuk.passenger` and `app.taketuk.driver`; they cannot change after the first Play Store upload. Release signing is not configured: release builds use the debug key and must not be published. | needs-input |
| APP-2 | iOS at the pilot | Android first. iOS projects exist but are not built or tested (no macOS runner; push also needs an Apple Developer account). | needs-input |
| APP-3 | Arabic copy | Arabic strings were written during development and need review by a native speaker familiar with Sudanese usage (for example "مشوار" for a ride). | needs-input |
| APP-4 | Service area chosen by drivers at registration | Build configuration (`SERVICE_AREA_CODE`, default `wad_madani`), since there is one city. A service-area list endpoint is added when there is a second city. | open |

## API

| ID | Decision | Current provisional behaviour | Status |
|---|---|---|---|
| API-1 | Real-time channel for clients | Polling plus FCM push. Supabase Realtime or WebSockets are being evaluated. | open |
| API-2 | Idempotency key retention | 24 hours. | open |
| API-3 | Rate limits | Quote creation is limited per user per minute (configurable). There is no global rate limiter yet. | open |

## Resolved decisions

None yet.
