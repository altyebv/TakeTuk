# TAKE-TUK — Security model

| | |
|---|---|
| Status | Reflects the implemented backend foundation. Items marked **[P]** are planned, **[Gap]** are known weaknesses. |
| Related | ADR-0004 (Auth), ADR-0007 (backend-controlled operations), ADR-0015 (database posture) |

## 1. Principles

1. The backend is the only place where business decisions and authorization happen. Client code is untrusted.
2. Deny by default at every layer: routes, database grants, storage.
3. Identity comes from verified tokens. Authorization data comes from our database.
4. Least privilege for every credential.
5. Every important administrative and financial action is audited, in the same transaction as its effect.
6. Collect and expose the minimum sensitive data.

## 2. Authentication

- Supabase Auth issues access tokens to clients. The backend verifies them locally with `jose` (`backend/src/modules/identity/infrastructure/supabase-token-verifier.ts`):
  - signature against the project JWKS (`ES256`/`RS256`), or the legacy HS256 secret when configured, never both,
  - `iss = <SUPABASE_URL>/auth/v1` and `aud = authenticated`,
  - `exp` (and `nbf` if present) with a 60 s clock tolerance,
  - `sub` must be a UUID, `role` must be `authenticated`, and anonymous users (`is_anonymous = true`) are rejected.
- Failures return `401 INVALID_TOKEN` without revealing which check failed. The reason is neither returned nor logged, because token contents must not reach logs. When the JWKS endpoint itself cannot be reached, the API answers `503 AUTHENTICATION_UNAVAILABLE` instead of 401, so an auth-provider outage does not sign users out.
- Users sign in with a one-time code sent by SMS. Development builds can use a code sent by email instead (IDN-6); release builds refuse it. The token and its checks are the same either way, and email accounts simply have no phone number.
- After token verification, the backend loads `users` and `user_roles`. Users with `status = disabled` receive `403 ACCOUNT_DISABLED`. This is how a user is blocked immediately, without waiting for token expiry.

## 3. Authorization

- Roles: `passenger`, `driver`, `admin`. Permissions are derived in code (`identity/domain/permissions.ts`).

| Permission | passenger | driver | admin |
|---|:-:|:-:|:-:|
| `ride:request` (quote, create, read own, cancel own, respond to counteroffers) | ✓ | | |
| `driver:self` (manage own driver profile, vehicles, documents, submit) | | ✓ | |
| `driver:operate` (availability, location, offers, trips, cash reports, earnings) | | ✓ | |
| `driver:review`, `vehicle:review`, `driver:suspend` | | | ✓ |
| `driver_document:view` | | | ✓ |
| `policy:manage` (fare and commission policies) | | | ✓ |
| `ride:admin` (read any ride, force-cancel) | | | ✓ |
| `audit:read` | | | ✓ |

- Beyond permissions, use cases enforce:
  - **ownership**: a passenger acts only on their own rides and quotes, and a driver only on offers addressed to them and rides assigned to them;
  - **approval**: driver operations require `drivers.status = approved`, re-checked inside the transaction;
  - **vehicle eligibility**: an approved, owned, compatible active vehicle;
  - **state**: STATE_MACHINES transitions;
  - **separation of duties**: an admin cannot review their own driver profile or vehicles.
- Push device registration is limited to the app matching a held role, so a passenger account cannot receive driver offers.
- Admin role grants happen only through the operator CLI (`npm run cli -- grant-role`), using operator database credentials. Each grant is audited with actor `system` and operator metadata. There is no HTTP endpoint that grants `admin`.

## 4. Secret management

| Secret | Holder | Notes |
|---|---|---|
| `DATABASE_URL` (login role ∈ `taketuk_api`) | API runtime | Never the `postgres` password |
| Migration credentials (`postgres`) | Operators and CI deploy step only | Used by the Supabase CLI |
| `SUPABASE_SECRET_KEY` (service role) | API runtime | Used only for Storage signed URLs |
| `SUPABASE_JWT_SECRET` (legacy only) | API runtime | Prefer asymmetric keys (JWKS), which need no secret |
| `GOOGLE_MAPS_API_KEY` | API runtime | Restrict to Routes API and server IPs if the host allows it |
| (none for OSRM) | — | The self-hosted OSRM server needs no key. Keep it off the public internet: it has no authentication of its own |
| FCM service-account key (`FCM_SERVICE_ACCOUNT_FILE` or `FCM_SERVICE_ACCOUNT_JSON`) | API runtime | A dedicated service account that may only send messages. Never shipped in an app (the apps' `google-services.json` is a different, public file) |

- No secret is committed. `backend/.env.example` contains placeholders only, and `.env*` files are git-ignored except the example.
- Flutter and web clients receive only the Supabase project URL and the **publishable (anon) key**, which is designed to be public and has no access to `taketuk`. The Flutter apps refuse to start if the configured key is a secret (`sb_secret_…`) or `service_role` key (`ClientConfig`, ADR-0018). Map display uses `flutter_map` with OpenStreetMap-based maps (MAP-6). Any map-provider key must be a client-restricted key [P].
- The apps call the API over https in release builds. Plain HTTP is allowed only in debug builds, for a local stack: the debug Android manifest permits cleartext and the release manifest does not.
- Sessions are stored by `supabase_flutter` in app-private storage, not an encrypted keystore [Gap] (IDN-5). Signing out removes them.
- Secrets are injected as environment variables by the hosting platform. Rotation: every secret above can be rotated without a code change.

## 5. Privileged database access

- The API connects as a login role that is a member of `taketuk_api` (ADR-0015):
  - `USAGE` on schemas `taketuk` and `extensions` only, and DML grants per table.
  - **No** UPDATE or DELETE on `fare_agreements`, `ledger_transactions`, `ledger_entries` or `audit_events`.
  - No DDL, no TRUNCATE, not a table owner, and no `BYPASSRLS`. Every table has RLS enabled with a policy only for `taketuk_api`.
- Roles that **do** bypass these protections: the table owner (`postgres` on Supabase) and `service_role` or superusers. They are used for migrations and break-glass operations only. Their use should be logged by the operator [Gap: no automated detection].
- `anon` and `authenticated` (the Supabase Data API roles) have no `USAGE` on `taketuk`, and the schema is not in the exposed list in `supabase/config.toml`. On hosted projects, confirm under *API settings → Exposed schemas* that `taketuk` is absent [operator checklist].
- `taketuk_api` cannot alter the `status_transitions` table or the trigger functions, so it cannot weaken the database-level state machines.

## 6. File security (driver documents)

- Bucket `driver-documents` is **private**, with a 10 MB size limit and MIME types `image/jpeg`, `image/png` and `application/pdf`. It is created by a guarded migration.
- There are no `storage.objects` RLS policies granting `anon` or `authenticated` access to this bucket. Access is possible only through:
  - **signed upload URLs** issued by the backend to the owning driver, for a server-chosen path `drivers/<driverId>/<documentId>.<ext>` (2-hour default validity set by Supabase),
  - **signed view URLs** issued to admins with `driver_document:view`, valid for 5 minutes. Each issuance is audited (`driver_document.viewed`).
- The client never chooses the storage path. The backend checks that the object exists before accepting the document.
- [Gap] No malware scanning or content inspection of uploads. [Gap] No retention or deletion policy yet (DRV-5).

## 7. Personal data

- Phone numbers: stored only from the verified token. They are revealed to the counterpart only during an active assignment (IDN-2).
- Location: only the latest driver position is stored. Passenger locations exist only as pickup and destination on quotes and rides.
- National ID numbers are not stored as data fields (DRV-2).
- Pickup and destination coordinates leave the system once per quote, to the routing provider. With OSRM that is our own server. With Google, the request is covered by Google's terms (MAP-2).
- Logs exclude request bodies, tokens, phone numbers and coordinates.

## 8. Audit trail

- `taketuk.audit_events`: actor (user id and role, or `system`), action, entity type and id, request id, timestamp, metadata (non-sensitive).
- Written inside the same transaction as the change, so an audited action and its record commit or roll back together.
- Append-only for the backend role.
- Audited actions include ride lifecycle transitions, offer responses, driver and vehicle reviews, availability changes, document confirmations and views, policy changes, payment reports, commission postings and role grants.
- Readable by admins with `audit:read` (`GET /v1/admin/audit-events`).

## 9. Input handling and transport

- Strict Zod validation on all inputs (unknown fields rejected). JSON only, with a 64 KB body limit.
- Parameterised SQL everywhere (`pg` placeholders). No string-built SQL from user input.
- Security headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`. HSTS is expected to be set by the TLS terminator.
- CORS is disabled by default. Web origins are added explicitly when the web apps exist.
- Outbound calls to providers use TLS. The one exception is a self-hosted OSRM on a private network that is itself encrypted, which must be declared with `OSRM_ALLOW_HTTP=true`; otherwise production refuses a plain-HTTP `OSRM_BASE_URL`.

## 10. Operational risks and gaps

| Risk | Status |
|---|---|
| Live verification of Supabase JWKS, Storage and role creation on hosted Supabase | Not yet verified [Gap] |
| Global and per-IP rate limiting | Only the quote limit exists [Gap] |
| Phone-number exposure between parties | Accepted for v1. Masked calling planned (IDN-2) |
| No automated alert on `failed` outbox events | [Gap]. The error log line exists |
| Admin account protection (MFA) | Rely on Supabase Auth MFA for staff accounts. Enforcing `aal2` for admin routes is [P] |
| Document upload abuse (size, type) | Bucket limits. No scanning [Gap] |
| Dependency vulnerabilities | `npm audit` in CI [P] |
| Backups and restore drills | See OPERATIONS. Restore drills not yet performed [Gap] |
