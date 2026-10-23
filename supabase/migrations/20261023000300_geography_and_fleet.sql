-- Geography (service areas) and fleet reference data (vehicle types, service types,
-- compatibility) plus vehicles. See docs/domain/DOMAIN_MODEL.md sections 3-4.

-- ---------------------------------------------------------------------------
-- Service areas
-- ---------------------------------------------------------------------------
create table taketuk.service_areas (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  timezone text not null,
  boundary extensions.geography(MultiPolygon, 4326) not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_areas_code_format check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint service_areas_status_valid check (status in ('active', 'inactive'))
);
create index service_areas_boundary_gix on taketuk.service_areas using gist (boundary);
create trigger service_areas_set_updated_at before update on taketuk.service_areas
  for each row execute function taketuk.set_updated_at();
-- Service areas are operator-managed configuration (seed / SQL by operators) in v1.
select taketuk.apply_table_security('taketuk.service_areas', 'select');

-- ---------------------------------------------------------------------------
-- Vehicle types and service types
-- The (code, flag) unique keys exist so the compatibility table can reference the flags and
-- enforce "passenger services need passenger-capable vehicles" declaratively.
-- ---------------------------------------------------------------------------
create table taketuk.vehicle_types (
  code text primary key,
  display_name text not null,
  passenger_capable boolean not null,
  active boolean not null default true,
  constraint vehicle_types_code_format check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint vehicle_types_code_passenger_key unique (code, passenger_capable)
);
select taketuk.apply_table_security('taketuk.vehicle_types', 'select');

create table taketuk.service_types (
  code text primary key,
  display_name text not null,
  requires_passenger_capable_vehicle boolean not null,
  active boolean not null default true,
  constraint service_types_code_format check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint service_types_code_passenger_key unique (code, requires_passenger_capable_vehicle)
);
select taketuk.apply_table_security('taketuk.service_types', 'select');

create table taketuk.service_vehicle_compatibility (
  service_type_code text not null,
  requires_passenger_capable_vehicle boolean not null,
  vehicle_type_code text not null,
  vehicle_passenger_capable boolean not null,
  primary key (service_type_code, vehicle_type_code),
  constraint compatibility_service_fk foreign key (service_type_code, requires_passenger_capable_vehicle)
    references taketuk.service_types (code, requires_passenger_capable_vehicle) on update cascade,
  constraint compatibility_vehicle_fk foreign key (vehicle_type_code, vehicle_passenger_capable)
    references taketuk.vehicle_types (code, passenger_capable) on update cascade,
  constraint compatibility_passenger_service_needs_passenger_vehicle
    check (not requires_passenger_capable_vehicle or vehicle_passenger_capable)
);
select taketuk.apply_table_security('taketuk.service_vehicle_compatibility', 'select');

create table taketuk.service_area_services (
  service_area_id uuid not null references taketuk.service_areas (id),
  service_type_code text not null references taketuk.service_types (code),
  enabled boolean not null default true,
  primary key (service_area_id, service_type_code)
);
select taketuk.apply_table_security('taketuk.service_area_services', 'select');

-- Reference data derived from the project directive (docs/product/PRD.md section 3).
-- Pairs marked [assumption] are recorded in docs/product/OPEN_DECISIONS.md.
insert into taketuk.vehicle_types (code, display_name, passenger_capable) values
  ('raksha', 'Raksha (covered three-wheeler)', true),
  ('pickup', 'Pickup (open three-wheeler for goods)', false),
  ('motorcycle', 'Motorcycle', false);

insert into taketuk.service_types (code, display_name, requires_passenger_capable_vehicle) values
  ('passenger_transport', 'Passenger transportation', true),
  ('food_delivery', 'Food delivery', false),
  ('package_delivery', 'Package delivery', false),
  ('goods_transport', 'Goods transport (logistics)', false);

insert into taketuk.service_vehicle_compatibility
  (service_type_code, requires_passenger_capable_vehicle, vehicle_type_code, vehicle_passenger_capable) values
  ('passenger_transport', true, 'raksha', true),
  ('package_delivery', false, 'raksha', true),       -- [assumption] "certain delivery jobs"
  ('goods_transport', false, 'pickup', false),
  ('package_delivery', false, 'pickup', false),      -- [assumption]
  ('food_delivery', false, 'motorcycle', false),
  ('package_delivery', false, 'motorcycle', false);
