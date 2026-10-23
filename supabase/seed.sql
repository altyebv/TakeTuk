-- =====================================================================================
-- TAKE-TUK DEVELOPMENT SEED — NOT FOR STAGING OR PRODUCTION
--
-- Applied automatically by `supabase db reset` (local Supabase CLI) and by
-- `npm run db:seed:dev` against plain PostgreSQL. Everything below is illustrative:
--
--   * The Wad Madani boundary is an APPROXIMATE BOUNDING BOX for local testing only.
--     It is not an operational service-area boundary (OPEN_DECISIONS MAP-4).
--   * Fare and commission values are ARBITRARY DEVELOPMENT VALUES. They are not a fare
--     schedule and must not be copied to any real environment (PRC-1, FIN-1).
-- =====================================================================================

insert into taketuk.service_areas (id, code, display_name, timezone, boundary, status)
values (
  '00000000-0000-4000-8000-000000000001',
  'wad_madani',
  'Wad Madani (development boundary)',
  'Africa/Khartoum',
  extensions.st_geogfromtext(
    'MULTIPOLYGON(((33.45 14.33, 33.60 14.33, 33.60 14.47, 33.45 14.47, 33.45 14.33)))'),
  'active'
)
on conflict (id) do nothing;

insert into taketuk.service_area_services (service_area_id, service_type_code, enabled)
values ('00000000-0000-4000-8000-000000000001', 'passenger_transport', true)
on conflict do nothing;

-- Policies must be created as drafts and then activated (database-enforced lifecycle).
insert into taketuk.fare_policies
  (id, service_area_id, service_type_code, version, status, currency,
   base_fare_minor, per_km_fare_minor, minimum_fare_minor, rounding_increment_minor, notes)
values (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001', 'passenger_transport', 1, 'draft', 'SDG',
  10000, 5000, 20000, 500,
  'DEVELOPMENT VALUES ONLY - not a real fare schedule'
)
on conflict (id) do nothing;
update taketuk.fare_policies set status = 'active', activated_at = now()
where id = '00000000-0000-4000-8000-000000000101' and status = 'draft';

insert into taketuk.commission_policies
  (id, service_area_id, service_type_code, version, status, rate_basis_points, notes)
values (
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000001', 'passenger_transport', 1, 'draft', 1000,
  'DEVELOPMENT VALUE ONLY - not a real commission rate'
)
on conflict (id) do nothing;
update taketuk.commission_policies set status = 'active', activated_at = now()
where id = '00000000-0000-4000-8000-000000000201' and status = 'draft';
