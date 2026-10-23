# TAKE-TUK

Transportation, food-marketplace and logistics platform, launching in Wad Madani, Sudan.

**Status:** first increment. The backend foundation and the ride-booking vertical slice are implemented and tested. Client apps are planned. See [`docs/IMPLEMENTATION_REPORT.md`](docs/IMPLEMENTATION_REPORT.md).

| Start here | |
|---|---|
| [MANIFESTO.md](MANIFESTO.md) | Engineering principles and why the system is built this way |
| [docs/product/PRD.md](docs/product/PRD.md) | What we are building, and for whom |
| [docs/architecture/SYSTEM_ARCHITECTURE.md](docs/architecture/SYSTEM_ARCHITECTURE.md) | Components, modules, integrations, deployment |
| [docs/domain/STATE_MACHINES.md](docs/domain/STATE_MACHINES.md) | Ride, negotiation, assignment, trip and payment lifecycles |
| [docs/api/API_CONVENTIONS.md](docs/api/API_CONVENTIONS.md) · [openapi.json](docs/api/openapi.json) | API contract |
| [docs/operations/OPERATIONS.md](docs/operations/OPERATIONS.md) | Local setup, configuration, migrations, testing, deployment |
| [docs/architecture/decisions/](docs/architecture/decisions/README.md) | Architecture decision records |
| [docs/product/OPEN_DECISIONS.md](docs/product/OPEN_DECISIONS.md) | Assumptions awaiting product decisions |

## Repository

```
backend/     NestJS API (modular monolith): the only component implemented so far
supabase/    migrations (authoritative schema), CLI config, development seed
docs/        product, architecture, domain, API, security, operations
apps/        planned Flutter (passenger, driver) and React (merchant, admin) clients
```

## Quick start (backend)

Requires Node 24 and PostgreSQL ≥ 16 with PostGIS:

```bash
cd backend
npm ci
npm run check    # format, lint, typecheck, and all tests (TEST_DATABASE_ADMIN_URL defaults to local postgres)
```

The full local setup is in [OPERATIONS §2](docs/operations/OPERATIONS.md).
