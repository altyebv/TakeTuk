# ADR-0005: PostGIS for geographic queries

- Status: Accepted
- Date: 2026-10-23

## Context

Matching must find nearby, fresh, eligible drivers. Quotes must check that points lie inside a service area. Both are geographic queries over our own data.

## Decision

- Install PostGIS in the `extensions` schema (Supabase convention). Store points as `geography(Point, 4326)` and service-area boundaries as `geography(MultiPolygon, 4326)`.
- Driver discovery uses `ST_DWithin(geography, geography, radius_m)` with a GiST index on `driver_locations.location`, ordered by `ST_Distance`. Service-area checks use `ST_Covers`.
- SQL calls PostGIS through schema-qualified names (`extensions.st_dwithin`, …), so queries do not depend on `search_path`.

## Alternatives considered

- **Computing distances in application code over all online drivers.** Fine for tens of drivers. It does not scale and duplicates what the database does well.
- **Geohash or H3 bucketing in application code.** Useful later for surge zones or analytics. Not needed for radius search.
- **Routing-API calls to find nearby drivers.** Explicitly prohibited: slow, expensive, and a misuse of the provider.

## Rationale

PostGIS is mature, available on Supabase and in standard Postgres packages, and lets the candidate query apply every eligibility rule in one indexed SQL statement.

## Consequences

- Distances used for **matching** are geodesic straight-line distances. Distances used for **pricing** are road distances from the routing provider. The two are never substituted for each other.

## Risks

- Schema-qualified PostGIS calls are verbose. That is accepted for robustness.
