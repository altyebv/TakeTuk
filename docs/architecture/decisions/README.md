# Architecture Decision Records

Each significant architectural decision is recorded here in a consistent format. A record is never silently contradicted. When implementation experience changes a decision, the record is updated: either its status changes to `Superseded by ADR-XXXX` and a new record is written, or an "Amendments" section is appended with the date and reason.

## Format

```
# ADR-NNNN: Title
- Status: Proposed | Accepted | Superseded by ADR-XXXX | Deprecated
- Date: YYYY-MM-DD
## Context
## Decision
## Alternatives considered
## Rationale
## Consequences
## Risks
```

No record claims a measurement or benchmark that was not performed.

## Index

| ID | Title | Status |
|---|---|---|
| [0001](0001-modular-monolith.md) | Modular monolith backend | Accepted |
| [0002](0002-nestjs-typescript.md) | NestJS and TypeScript on Node.js 24 LTS | Accepted |
| [0003](0003-supabase-postgresql.md) | Supabase PostgreSQL as the primary database | Accepted |
| [0004](0004-supabase-auth.md) | Supabase Auth for identity | Accepted |
| [0005](0005-postgis.md) | PostGIS for geographic queries | Accepted |
| [0006](0006-flutter-mobile.md) | Flutter for passenger and driver apps | Accepted |
| [0007](0007-backend-controlled-operations.md) | Backend-controlled business operations | Accepted |
| [0008](0008-google-maps-initial-provider.md) | Google Maps Platform as the initial mapping provider | Accepted (pending terms review) |
| [0009](0009-routing-provider-abstraction.md) | Narrow provider abstraction for routing and geocoding | Accepted |
| [0010](0010-postgresql-backed-processing.md) | PostgreSQL-backed background processing and transactional outbox | Accepted |
| [0011](0011-fare-negotiation-minimum-fare.md) | Fare negotiation with a policy-driven minimum fare | Accepted |
| [0012](0012-initial-driver-assignment.md) | Initial driver matching and assignment strategy | Accepted |
| [0013](0013-data-access-node-postgres.md) | Data access with node-postgres and explicit SQL | Accepted |
| [0014](0014-validation-zod-openapi.md) | Runtime validation with Zod; OpenAPI from the same schemas | Accepted |
| [0015](0015-database-security-posture.md) | Private schema, least-privilege backend role, RLS as defence in depth | Accepted |
| [0016](0016-financial-records-ledger.md) | Cash-first payments and an append-only double-entry ledger | Accepted |
