# TAKE-TUK — API conventions

These conventions apply to every HTTP endpoint of the TAKE-TUK backend. The machine-readable contract is [`openapi.json`](openapi.json). It is generated from the code (`cd backend && npm run openapi`), and a test fails if the committed file is stale.

## 1. Base URL and versioning

- Business endpoints are under `/v1/…`. The version is the major API version, carried in the path.
- Within a major version, changes are **additive only**: new endpoints, new optional request fields, new response fields, new enum values in responses. Clients must ignore unknown response fields and tolerate unknown enum values.
- Breaking changes (removing or renaming fields, changing semantics, new required inputs) require `/v2`. The previous version stays available for a published deprecation period.
- Operational endpoints are unversioned: `GET /health/live`, `GET /health/ready`.

## 2. Authentication

- `Authorization: Bearer <Supabase access token>` on every `/v1` endpoint.
- Verification: see [SECURITY](../security/SECURITY.md) §2 and ADR-0004. Missing or invalid tokens → `401`.
- Identity comes **only** from the verified token (`sub`). Request bodies never carry user ids or roles for the caller.

## 3. Authorization

- **Deny by default.** Every route declares exactly one access rule:
  - `@Public()`: no token (health only),
  - `@Authenticated()`: any verified token, even unregistered (registration endpoints, `GET /v1/me`),
  - `@RequirePermissions(...)`: a registered, active user whose roles grant every listed permission.
  A route without a declaration fails closed (`500` in development, caught by an architecture test before merge).
- Permission checks are necessary but not sufficient. Use cases also check **ownership** (is this the caller's ride or offer?), **approval** (is the driver approved?) and **state** (is the transition legal now?).
- Resources the caller may not see return `404` (for example, another passenger's ride), so their existence is not revealed.

## 4. Request validation

- JSON bodies only (`Content-Type: application/json`), with a 64 KB size limit.
- Bodies, path parameters and query parameters are validated with strict Zod schemas. Unknown body fields are rejected (`400 VALIDATION_FAILED`, listing the offending paths).
- Identifiers are UUIDs. Coordinates are `{ "lat": number, "lng": number }` within WGS84 bounds.
- **Money** is always `{ "amountMinor": integer, "currency": "SDG" }`. `amountMinor` is in ISO 4217 minor units, is a safe integer, and is never a float. Requests must use the currency of the applicable policy.
- **Timestamps** are ISO 8601 UTC strings (`2026-10-23T10:15:30.000Z`).
- Field names are `camelCase`. Enum values are `snake_case`.

## 5. Responses

- Success responses are JSON objects, never bare arrays. Collections are wrapped in `{ "items": [...], "nextCursor": string | null }`.
- `201 Created` for resource creation, `200 OK` otherwise. Responses are the resource representation after the operation.
- Every response has an `X-Request-Id` header. The client may supply one (`[A-Za-z0-9-]{8,64}`); otherwise the server generates it. It appears in logs, problem responses and audit events.

## 6. Errors: RFC 9457 problem details

```json
{
  "type": "https://docs.taketuk.app/problems/fare-below-minimum",
  "title": "Proposed fare is below the minimum fare",
  "status": 422,
  "code": "FARE_BELOW_MINIMUM",
  "detail": "The proposed fare 1500 SDG minor units is below the minimum fare 2000.",
  "requestId": "0d6f6a8e-…",
  "errors": [{ "path": "proposedFare.amountMinor", "message": "…" }]
}
```

- `Content-Type: application/problem+json`.
- `code` is the stable, machine-readable identifier that clients switch on. `title` and `detail` are for humans and may change.
- `errors` appears only for validation problems.
- `type` is a stable URI that identifies the problem type. It is not guaranteed to be resolvable yet.
- `500` responses never include stack traces or internal messages.

| HTTP | Meaning | Example codes |
|---|---|---|
| 400 | Malformed or invalid input | `VALIDATION_FAILED`, `IDEMPOTENCY_KEY_REQUIRED` |
| 401 | Missing or invalid credentials | `AUTHENTICATION_REQUIRED`, `INVALID_TOKEN` |
| 403 | Authenticated but not allowed | `REGISTRATION_REQUIRED`, `ACCOUNT_DISABLED`, `PERMISSION_DENIED`, `DRIVER_NOT_APPROVED`, `SELF_REVIEW_FORBIDDEN` |
| 404 | Not found **or not visible to the caller** | `RIDE_NOT_FOUND`, `OFFER_NOT_FOUND`, `QUOTE_NOT_FOUND`, … |
| 409 | Conflicts with current state | `INVALID_STATE_TRANSITION`, `RIDE_NO_LONGER_AVAILABLE`, `OFFER_NOT_OPEN`, `OFFER_EXPIRED`, `QUOTE_EXPIRED`, `QUOTE_ALREADY_USED`, `RIDE_ALREADY_OPEN`, `DRIVER_BUSY`, `DRIVER_NOT_AVAILABLE`, `PROFILE_NOT_EDITABLE`, `PAYMENT_ALREADY_REPORTED`, `ALREADY_REGISTERED` |
| 422 | Well-formed but violates a business rule | `FARE_BELOW_MINIMUM`, `COUNTEROFFER_NOT_ABOVE_PROPOSAL`, `CURRENCY_MISMATCH`, `OUTSIDE_SERVICE_AREA`, `SERVICE_NOT_AVAILABLE`, `NO_ROUTE_FOUND`, `IDEMPOTENCY_KEY_REUSED`, `VERIFICATION_REQUIREMENTS_NOT_MET`, `VEHICLE_NOT_ELIGIBLE` |
| 429 | Rate limited | `RATE_LIMITED` (with `Retry-After`) |
| 503 | Dependency unavailable or not configured | `ROUTING_UNAVAILABLE`, `STORAGE_UNAVAILABLE`, `PRICING_NOT_CONFIGURED`, `DATABASE_UNAVAILABLE` |
| 500 | Unexpected | `INTERNAL_ERROR` |

The full list of codes is in `backend/src/shared/errors/error-codes.ts`.

## 7. Pagination

- Cursor-based: `?limit=<1..100, default 20>&cursor=<opaque>`.
- The response is `{ "items": [...], "nextCursor": "<opaque>" | null }`. Pass `nextCursor` back to get the next page.
- Cursors are opaque (base64url-encoded keyset `(created_at, id)`), stable under concurrent inserts, and are not to be parsed by clients. Order is newest first unless an endpoint documents otherwise.

## 8. Idempotency

Two mechanisms:

1. **Idempotency keys** for operations that create something new and would otherwise duplicate on retry.
   - Header `Idempotency-Key: <8–128 chars of [A-Za-z0-9_-]>`. **Required** on `POST /v1/rides`.
   - Scope: (authenticated user, operation, key). The server stores a SHA-256 fingerprint of the canonical request body and the response, **in the same transaction as the effect**.
   - Retrying with the same key and body replays the original status and body, with the header `Idempotent-Replayed: true`.
   - The same key with a different body → `422 IDEMPOTENCY_KEY_REUSED`.
   - Concurrent requests with the same key wait for the first one to finish, then replay it.
   - Failed requests (4xx and 5xx) are not stored, so the client may retry them with the same key.
   - Retention is 24 hours. After that the key may be reused.
2. **Natural idempotency of state transitions.** Repeating a transition that has already happened, by the same actor and with the same parameters, returns `200` with the current representation and has no further effect. This applies to accepting an offer or counteroffer, arriving, starting, completing, reporting a cash collection, and cancelling. A conflicting repeat (for example, a different collected amount) → `409`.

Clients should generate one idempotency key per user intent (for example, per tap on "Request ride") and reuse it on every retry of that intent.

## 9. Concurrency conflicts

- Concurrency is resolved on the server with row locks and unique constraints, never with client-side timing.
- A losing concurrent request receives `409` with a specific code (`RIDE_NO_LONGER_AVAILABLE`, `DRIVER_BUSY`, `OFFER_NOT_OPEN`). Clients refresh the resource and show the new state. They must not blindly retry a `409`.
- `ETag` / `If-Match` optimistic concurrency is not used yet. State-machine preconditions already protect every transition. It may be introduced for editable configuration resources.

## 10. Time-sensitive state

- Responses include absolute deadlines (`expiresAt`, `searchExpiresAt`). Clients show countdowns from them, not from local timers alone.
- The server decides expiry using the database clock. An action submitted just before a deadline but processed just after it fails with `409 OFFER_EXPIRED` or `QUOTE_EXPIRED`.

## 11. Rate limits

- Quote creation: `QUOTE_RATE_LIMIT_PER_MINUTE` per user (default 10). Exceeding it returns `429 RATE_LIMITED` with `Retry-After`. The limit protects routing-provider spend.
- A global rate limiter is planned (API-3).

## 12. Documentation conventions

- Each endpoint has an `operationId` (`<module>.<verb><Noun>`), a summary, a tag per module, the request and response schemas, and the problem codes it can return in its description.
- Access rules appear as OpenAPI security requirements (`bearer`) and as an `x-taketuk-permissions` extension.
- `docs/api/openapi.json` is regenerated whenever endpoints change, and is reviewed with the code.

## 13. Endpoint overview (v1)

| Area | Endpoints |
|---|---|
| Identity | `GET /v1/me`, `POST /v1/passenger/registration`, `PATCH /v1/me/profile`, `PUT /v1/me/devices/{installationId}` |
| Driver onboarding | `POST /v1/driver/registration`, `GET`/`PATCH /v1/driver/profile`, `POST`/`GET /v1/driver/vehicles`, `POST /v1/driver/documents/upload-requests`, `POST /v1/driver/documents/{id}/confirm`, `GET /v1/driver/documents`, `POST /v1/driver/verification/submit` |
| Driver operations | `PUT /v1/driver/availability`, `PUT /v1/driver/location`, `GET /v1/driver/offers`, `POST /v1/driver/offers/{id}/accept`, `…/decline`, `…/counteroffer`, `GET /v1/driver/rides`, `GET /v1/driver/rides/current`, `GET /v1/driver/rides/{id}`, `POST /v1/driver/rides/{id}/arrive`, `…/start`, `…/complete`, `…/cancel`, `…/cash-collection`, `GET /v1/driver/earnings` |
| Passenger rides | `POST /v1/fare-quotes`, `POST /v1/rides`, `GET /v1/rides`, `GET /v1/rides/{id}`, `POST /v1/rides/{id}/cancel`, `POST /v1/rides/{id}/offers/{offerId}/accept-counteroffer`, `…/reject-counteroffer` |
| Admin | `GET /v1/admin/drivers`, `GET /v1/admin/drivers/{id}`, `POST /v1/admin/drivers/{id}/approve`, `…/reject`, `…/suspend`, `…/reinstate`, `GET /v1/admin/drivers/{id}/documents/{docId}/view-url`, `POST /v1/admin/vehicles/{id}/approve`, `…/reject`, `…/suspend`, `…/reinstate`, `GET`/`POST /v1/admin/fare-policies`, `POST /v1/admin/fare-policies/{id}/activate`, `…/retire`, `GET`/`POST /v1/admin/commission-policies`, `POST /v1/admin/commission-policies/{id}/activate`, `…/retire`, `GET /v1/admin/rides/{id}`, `POST /v1/admin/rides/{id}/cancel`, `GET /v1/admin/audit-events` |
| Operations | `GET /health/live`, `GET /health/ready` |
