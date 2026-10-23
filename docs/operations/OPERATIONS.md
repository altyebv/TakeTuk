# TAKE-TUK — Operations

| | |
|---|---|
| Status | Local development and testing procedures are **verified** in the build environment (PostgreSQL 16.15 + PostGIS 3.4, Node 24.22). Supabase CLI, container image and hosted deployment procedures are **documented but not yet executed**, because Docker images could not be pulled in that environment. |

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24 LTS (≥ 24.9) | `.nvmrc`. Required by the test toolchain (ADR-0002). |
| PostgreSQL + PostGIS | ≥ 16 with PostGIS 3 | For tests and plain-Postgres local runs. Example: `apt install postgresql-16-postgis-3`, or the `postgis/postgis:16-3.4` image. |
| Supabase CLI | ≥ 2.x | Optional for local Supabase (needs Docker); required for hosted migrations. |
| Docker | any recent | For the Supabase local stack and the API image. |

## 2. Local development

### 2a. Plain PostgreSQL (fastest; what the tests use)

```bash
cd backend
npm ci
createdb taketuk_dev
export DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/taketuk_dev
npm run db:migrate          # builds, then applies supabase/migrations (refuses Supabase databases)
npm run db:seed:dev         # DEVELOPMENT values: Wad Madani box, dev fare and commission policies

# Least-privilege login role for the API (see §4). Local-only password:
psql "$DATABASE_ADMIN_URL" -c "create role taketuk_api_local login password 'local-dev-only'; grant taketuk_api to taketuk_api_local;"

cp .env.example .env        # then edit. See §3.
npm run start:dev           # builds and starts on PORT (default 3000); Swagger UI at /docs when API_DOCS_ENABLED=true
```

Without a Supabase project, set `AUTH_JWT_MODE=legacy_hs256` and a local `AUTH_JWT_SECRET`, then mint HS256 tokens with issuer `<SUPABASE_URL>/auth/v1` and audience `authenticated` for manual testing. This is how the local smoke test in the implementation report was run.

### 2b. Supabase CLI local stack (not yet verified)

```bash
supabase start              # Postgres, Auth, Storage, API gateway (Docker)
supabase db reset           # applies supabase/migrations, then supabase/seed.sql
```

- Create the API login role as in §4, with the local DB URL `postgres://postgres:postgres@127.0.0.1:54322/postgres`.
- `SUPABASE_URL=http://127.0.0.1:54321`. Use `AUTH_JWT_MODE=jwks` if the local stack issues asymmetric tokens, otherwise `legacy_hs256` with the local JWT secret printed by `supabase status`.
- `supabase/config.toml` enables phone sign-up with **test OTPs** for three fictitious numbers (`249900000001`–`003`, code `123456`). Never configure test OTPs in hosted projects.
- Email sign-in (`SIGN_IN_METHOD=email` in the app build, IDN-6): codes appear in the local mail viewer at `http://127.0.0.1:54324`. The email template is `supabase/templates/sign_in_code.html`.
- The `driver-documents` bucket is created by migration `…0900_storage_buckets.sql`.

### 2c. The API on a development machine against a Supabase project

For a device test before a hosted backend exists. The phone and the machine must be on the same network. This assumes the schema is applied (`supabase db push`) and the API login role exists (§4).

1. **Reference data.** Development projects only: paste `supabase/seed.sql` into the SQL editor. It adds the development service area and the fare and commission policies. Vehicle types come from the migrations. Quotes fail with no active service area.
2. **The CA certificate.** Download it from *Project Settings → Database → SSL Configuration*. node-postgres verifies the server certificate even for `sslmode=require`, and Supabase's is signed by Supabase's own CA.
3. **`backend/.env`** (never committed):
   ```bash
   NODE_ENV=development
   API_DOCS_ENABLED=true
   # Connect → Session pooler for the host. The direct host is IPv6-only on most plans.
   DATABASE_URL=postgresql://taketuk_api_login.<project-ref>:<password>@<session-pooler-host>:5432/postgres?sslmode=verify-full&sslrootcert=<absolute path to the certificate>
   SUPABASE_URL=https://<project-ref>.supabase.co
   AUTH_JWT_MODE=jwks
   STORAGE_PROVIDER=supabase
   SUPABASE_SECRET_KEY=<secret key>
   ROUTING_PROVIDER=dev_fake
   NOTIFICATION_PROVIDER=log
   ```
   The password must not need URL escaping: letters and digits only. On Windows, write the certificate path with forward slashes (`C:/Users/…/prod-ca-2021.crt`).
4. **Start:** `npm ci`, then `npm run start:dev`. `http://localhost:3000/health/ready` should answer 200.
5. **The apps:** in `config/local.json`, set:
   - `API_BASE_URL=http://<machine's LAN address>:3000`;
   - the project's `SUPABASE_URL` and publishable key;
   - `SIGN_IN_METHOD=email`.

   Debug builds allow plain http; only their debug manifest permits it.
6. **An admin.** Sign in to the passenger app and register. Then, from `backend/`:
   ```bash
   npm run cli -- grant-role --user <user id from Authentication → Users> --role admin --operator "<your name>" --reason "development setup"
   ```
7. **Approving a driver**, until the admin dashboard exists (phase 11):
   - Use Swagger UI at `http://localhost:3000/docs`, authorized with the admin's access token.
   - To get a token without the app, request a code with `POST <SUPABASE_URL>/auth/v1/otp` (`{"email": …}`). Then exchange it with `POST <SUPABASE_URL>/auth/v1/verify` (`{"type": "email", "email": …, "token": …}`). Both need the `apikey: <publishable key>` header, and the response's `access_token` is the token.
   - List applicants with `GET /v1/admin/drivers?status=pending_review`. Then approve with `POST /v1/admin/vehicles/{id}/approve` and `POST /v1/admin/drivers/{id}/approve`.

A ride needs two accounts, because drivers never receive their own requests (IDN-3). **Test accounts** avoid email delivery altogether:
```bash
npm run cli -- sign-in-code --email passenger@example.com   # or driver@example.com
```
This prints a sign-in code and creates the account on first use. No email is sent; the code comes from the Auth admin API with `SUPABASE_SECRET_KEY`. In the app, enter the address, tap **I already have a code**, then enter the code. That button only appears in development builds.
- The command only accepts `@example.com` addresses, so it can never sign in as a real person.
- It refuses `NODE_ENV=production`.
- `passenger@example.com` and `driver@example.com` already exist in the current project.

With real addresses and Supabase's built-in email service, both addresses must belong to members of the project's organization.

## 3. Environment variables

Validated at startup by `backend/src/config/app-config.ts`. Invalid configuration means the process exits with a list of issues. Placeholders are in `backend/.env.example`.

`npm run start`, `start:dev`, `cli`, `db:migrate` and `db:seed:dev` read `backend/.env` when it exists (`node --env-file-if-exists`). Variables already set in the environment take precedence. The container image does not read it: it starts `node` directly and gets its configuration from the platform's secrets.

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | development | `production` enables the strict checks below |
| `PORT` | 3000 | |
| `LOG_LEVEL` / `LOG_FORMAT` | info / json | JSON lines in production |
| `TRUST_PROXY` | false | set true behind a load balancer |
| `API_DOCS_ENABLED` | false | Swagger UI at `/docs`. **Refused in production.** |
| `DATABASE_URL` | — (required) | login role ∈ `taketuk_api`. **Production requires `sslmode=verify-full` or `verify-ca`** (with `sslrootcert`). |
| `DATABASE_POOL_MAX` | 10 | per instance |
| `DATABASE_STATEMENT_TIMEOUT_MS` | 10000 | session-level; needs a direct connection or session-mode pooler |
| `SUPABASE_URL` | — (required) | https in production. Issuer and JWKS URL derive from it. |
| `AUTH_JWT_MODE` | jwks | or `legacy_hs256` (then `AUTH_JWT_SECRET` is required). Never both. |
| `AUTH_JWT_AUDIENCE` | authenticated | |
| `AUTH_JWKS_URL` | derived | override only for unusual setups |
| `STORAGE_PROVIDER` | in_memory | `supabase` in real environments (`in_memory` refused in production) |
| `SUPABASE_SECRET_KEY` | — | required for `supabase` storage. Server-side only. |
| `STORAGE_DRIVER_DOCUMENTS_BUCKET` | driver-documents | |
| `STORAGE_VIEW_URL_TTL_SECONDS` | 300 | admin document view links |
| `ROUTING_PROVIDER` | dev_fake | `osrm` or `google` in real environments (`dev_fake` refused in production) |
| `GOOGLE_MAPS_API_KEY` | — | required for `google`. Server key restricted to the Routes API. |
| `OSRM_BASE_URL` | — | required for `osrm`: base URL of the self-hosted `osrm-routed` (`infra/osrm/README.md`). https in production unless `OSRM_ALLOW_HTTP=true` |
| `OSRM_SNAP_RADIUS_METERS` | 500 | farthest a trip point may be moved to reach a mapped road; beyond it the quote fails with `NO_ROUTE_FOUND` (MAP-1) |
| `OSRM_ALLOW_HTTP` | false | set only when OSRM is reachable solely over an encrypted private network |
| `ROUTING_TIMEOUT_MS` | 5000 | |
| `NOTIFICATION_PROVIDER` | log | `fcm` in real environments (`log` refused in production) |
| `FCM_PROJECT_ID` | — | required for `fcm` |
| `FCM_SERVICE_ACCOUNT_FILE` or `FCM_SERVICE_ACCOUNT_JSON` | — | exactly one, for `fcm`. Either a path to the service-account key file (mounted as a secret), or the key itself: the JSON, or the JSON base64-encoded (`base64 -w0 key.json`) for platforms whose secret editors cannot hold JSON. Validated at startup without echoing it |
| `WORKERS_ENABLED` | true | dispatch, outbox, retention and cleanup workers in-process |
| `DISPATCH_TICK_MS` / `OUTBOX_TICK_MS` / `MAINTENANCE_TICK_MS` | 2000 / 1000 / 300000 | |
| `QUOTE_TTL_SECONDS` | 600 | development default (PRC-6) |
| `QUOTE_RATE_LIMIT_PER_MINUTE` | 10 | per passenger |
| `RIDE_SEARCH_TIMEOUT_SECONDS` | 300 | DSP-1 |
| `OFFER_RESPONSE_TIMEOUT_SECONDS` | 45 | DSP-1 |
| `COUNTEROFFER_RESPONSE_TIMEOUT_SECONDS` | 60 | DSP-1 |
| `DISPATCH_RADIUS_METERS` | 3000 | DSP-1 |
| `DISPATCH_BATCH_SIZE` | 5 | DSP-1 |
| `DRIVER_LOCATION_MAX_AGE_SECONDS` | 120 | DSP-1 |
| `DISPATCH_RETRY_INTERVAL_SECONDS` | 10 | DSP-1 |
| `OUTBOX_MAX_ATTEMPTS` / `OUTBOX_BATCH_SIZE` | 8 / 20 | |
| `IDEMPOTENCY_TTL_HOURS` | 24 | API-2 |

All dispatch and pricing thresholds are **development defaults** awaiting operational tuning.

## 4. Database operations

**Migrations**
- Supabase environments: `supabase link --project-ref <ref>`, then `supabase db push`. Never edit the schema in the dashboard.
- Plain PostgreSQL (CI, local): `npm run db:migrate`. The runner refuses databases that contain the `auth`, `storage` or `supabase_migrations` schemas.
- Applied migrations are immutable. Add a new file instead.

**API login role** (once per environment, run as `postgres`. The password comes from the secret manager and is never committed):

```sql
create role taketuk_api_login login password '<from secret manager>';
grant taketuk_api to taketuk_api_login;
```

On Supabase, connect through the **session** pooler (port 5432 on the pooler host; user `taketuk_api_login.<project-ref>`) or directly. The transaction pooler (6543) is not supported, because the API sets session-level `statement_timeout`. This role-creation path has not yet been verified on hosted Supabase (ADR-0015 risk).

**Operator checklist after provisioning a Supabase project**
1. *API settings → Exposed schemas*: only `public`, `graphql_public`. `taketuk` must not appear.
2. Asymmetric JWT signing keys are enabled (then `AUTH_JWT_MODE=jwks`).
3. Phone provider (SMS) configured; delivery to Sudanese numbers tested (IDN-1). Until then, for development builds signing in by email (IDN-6):
   - *Authentication → Emails*: in both **Confirm signup** and **Magic Link**, the body must contain `{{ .Token }}`; paste `supabase/templates/sign_in_code.html`. The apps ask for the code and do not open links.
   - Supabase's built-in email service only delivers to members of the project's organization, with a low hourly limit. Anyone else needs custom SMTP (*Authentication → SMTP Settings*).
4. Bucket `driver-documents` exists and is private (migration). `npm run test:live -- supabase-storage` checks it.
5. Point-in-time recovery enabled (plan-dependent).

## 5. Operator CLI

From `backend/` after `npm run build`:

| Command | Connection | Purpose |
|---|---|---|
| `npm run cli -- migrate` | `DATABASE_ADMIN_URL` | plain PostgreSQL migrations |
| `npm run cli -- seed-dev` | `DATABASE_ADMIN_URL` | development seed. Refused in production. |
| `npm run cli -- grant-role --user <uuid> --role admin --operator "<name>" --reason "<ticket>"` | `DATABASE_URL` | grant a role to a **registered** user. Writes an audit event (`user.role_granted`, actor `system`, `via: cli`). |
| `npm run cli -- sign-in-code --email <name>@example.com` | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | **Development only.** Prints a sign-in code for a test account, creating it on first use; no email is sent (§2c). Accepts only `@example.com` addresses and refuses production. |

Admin bootstrap: the staff member signs in with the app or the admin dashboard and registers. An operator then runs `grant-role`.

## 6. Testing

```bash
cd backend
npm run check            # format check + lint + typecheck + all tests
npm run test:unit        # domain rules, adapters (mocked transports), architecture rules, OpenAPI drift
npm run test:integration # PostgreSQL: schema security, HTTP end-to-end, concurrency, failures, authorization sweep
npm run openapi          # regenerate docs/api/openapi.json after changing endpoints
```

Integration tests need `TEST_DATABASE_ADMIN_URL` (default `postgres://postgres:postgres@localhost:5432/postgres`), a role that can create databases and roles. Global setup migrates a template database from empty. Each suite clones it, and the API under test connects as a login role whose only rights come from `taketuk_api`.

CI: `.github/workflows/backend.yml` runs the same checks against a `postgis/postgis:16-3.4` service container, on every pull request that touches the backend or the migrations.

Live checks, on demand only (`npm run test:live -- <name>`):
- `osrm`: the OSRM adapter against a real `osrm-routed` serving the synthetic network. Needs `OSRM_LIVE_URL` (`infra/osrm/README.md`).
- `supabase`: two specs against the Supabase project in `SUPABASE_URL`. Both need `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`.
  - `supabase-auth`: token verification. A throwaway user signs in with an email code as the apps do; the admin API issues the code, so no email is sent. The backend verifier checks the token through the project's JWKS, and the user is deleted.
  - `supabase-storage`: needs the migrations applied. It checks that:
    - the `driver-documents` bucket is private and limited to document types;
    - the `taketuk` schema is not reachable through the Data API;
    - a document uploads through a signed URL exactly as the driver app sends it, and is readable only through a signed view URL;
    - other file types are refused, and a signed upload URL cannot overwrite.

    Its objects go under `live-check/` and are removed.

Behind an HTTPS proxy, Node's `fetch` needs `NODE_USE_ENV_PROXY=1`. The Flutter apps and packages have their own checks: see [apps/README.md](../../apps/README.md).

## 7. Deployment (planned; not performed)

- Build: `docker build -f backend/Dockerfile -t taketuk-api .` (from the repository root). Not yet built.
- Run on a managed container platform with: ≥ 1 always-on instance, health check `GET /health/ready`, `SIGTERM` graceful shutdown (enabled), secrets injected as env vars or mounted files, and HTTPS terminated by the platform.
- Release order: (1) `supabase db push` (migrations are additive and backward compatible within a release), (2) deploy the API, (3) verify `/health/ready` and a smoke test.
- Workers run in every instance with `WORKERS_ENABLED=true`. They are multi-instance safe (`SKIP LOCKED` and claims). To isolate them, run one instance with workers on and the rest off.

## 8. Monitoring (minimum viable)

| Signal | Source | Alert when |
|---|---|---|
| Readiness | `/health/ready` | non-200 for > 1 min |
| 5xx rate | request log lines (`status ≥ 500`, logged at error level) | sustained > 1% |
| `ROUTING_UNAVAILABLE` rate | problem responses / logs | any sustained burst (no quotes means no rides) |
| Failed outbox events | `select count(*) from taketuk.outbox_events where status = 'failed'` | > 0 |
| Stuck dispatch | rides `searching` with `next_dispatch_at < now() - interval '1 minute'` | > 0 |
| Expired-without-offers ratio | rides `expired` with no offers | trend: driver supply |

There is no metrics exporter yet. Log-based alerting is planned (roadmap phase 12).

## 9. Backups and recovery

- **Backups:** Supabase daily backups, plus point-in-time recovery when the plan includes it (assumption, to be confirmed with the chosen plan). No restore drill has been performed.
- **Crash recovery:** automatic. State lives in PostgreSQL, the sweepers redo dispatch and expiry, and outbox claims lapse and are retried.
- **Failed outbox events** (after max attempts): fix the cause (for example FCM credentials), then requeue:
  ```sql
  update taketuk.outbox_events set status = 'pending', attempts = 0, available_at = now(), last_error = null
   where status = 'failed' and created_at > now() - interval '1 day';
  ```
  Notifications are hints. Stale ones can be left failed.
- **Stuck ride** (operator decision): `POST /v1/admin/rides/{id}/cancel` with a reason. Never update statuses by SQL. The transition trigger would reject illegal changes, and the audit trail would be bypassed.
- **Key rotation:** Supabase signing keys rotate without downtime (JWKS cache). Rotate `SUPABASE_SECRET_KEY`, `GOOGLE_MAPS_API_KEY`, FCM credentials and the DB login password by updating secrets and restarting.
