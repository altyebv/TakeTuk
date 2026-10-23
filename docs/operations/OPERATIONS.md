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
- The `driver-documents` bucket is created by migration `…0900_storage_buckets.sql`.

## 3. Environment variables

Validated at startup by `backend/src/config/app-config.ts`. Invalid configuration means the process exits with a list of issues. Placeholders are in `backend/.env.example`.

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
3. Phone provider (SMS) configured; delivery to Sudanese numbers tested (IDN-1).
4. Bucket `driver-documents` exists and is private (migration).
5. Point-in-time recovery enabled (plan-dependent).

## 5. Operator CLI

From `backend/` after `npm run build`:

| Command | Connection | Purpose |
|---|---|---|
| `npm run cli -- migrate` | `DATABASE_ADMIN_URL` | plain PostgreSQL migrations |
| `npm run cli -- seed-dev` | `DATABASE_ADMIN_URL` | development seed. Refused in production. |
| `npm run cli -- grant-role --user <uuid> --role admin --operator "<name>" --reason "<ticket>"` | `DATABASE_URL` | grant a role to a **registered** user. Writes an audit event (`user.role_granted`, actor `system`, `via: cli`). |

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

CI: `.github/workflows/backend.yml` runs the same checks against a `postgis/postgis:16-3.4` service container. **It has not run yet**, because the branch could not be pushed (see the implementation report).

On demand, `OSRM_LIVE_URL=… npm run test:live` runs the OSRM adapter against a real `osrm-routed` serving the synthetic network (`infra/osrm/README.md`). The Flutter apps and packages have their own checks: see [apps/README.md](../../apps/README.md).

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
