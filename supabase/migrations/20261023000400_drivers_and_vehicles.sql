-- Drivers (verification, availability, location, documents) and vehicles.
-- Ownership: drivers/driver_locations/driver_documents -> drivers module; vehicles -> fleet module.

create table taketuk.drivers (
  user_id uuid primary key references taketuk.users (id),
  service_area_id uuid not null references taketuk.service_areas (id),
  status text not null,
  full_legal_name text not null,
  driving_license_number text not null,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references taketuk.users (id),
  review_note text,
  availability text not null default 'offline',
  active_vehicle_id uuid,
  availability_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drivers_status_valid check (status in ('applicant', 'pending_review', 'approved', 'rejected', 'suspended')),
  constraint drivers_availability_valid check (availability in ('offline', 'online')),
  constraint drivers_full_legal_name_length check (char_length(btrim(full_legal_name)) between 2 and 200),
  -- Formats of Sudanese licence numbers and plates are not specified (may contain Arabic script);
  -- the application normalises whitespace/case and the database only bounds length and content.
  constraint drivers_license_number_format check (
    char_length(driving_license_number) between 3 and 40 and driving_license_number !~ '[[:cntrl:]]'),
  constraint drivers_review_note_length check (review_note is null or char_length(review_note) <= 1000),
  -- Only approved drivers with an active vehicle can be online.
  constraint drivers_online_requires_approval_and_vehicle
    check (availability = 'offline' or (status = 'approved' and active_vehicle_id is not null))
);
create trigger drivers_set_updated_at before update on taketuk.drivers
  for each row execute function taketuk.set_updated_at();
create trigger drivers_status_transition before insert or update of status on taketuk.drivers
  for each row execute function taketuk.enforce_status_transition('driver');
create index drivers_status_idx on taketuk.drivers (status, submitted_at);
select taketuk.apply_table_security('taketuk.drivers', 'select, insert, update');

create table taketuk.vehicles (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references taketuk.drivers (user_id),
  vehicle_type_code text not null references taketuk.vehicle_types (code),
  plate_number text not null,
  description text,
  status text not null,
  reviewed_at timestamptz,
  reviewed_by uuid references taketuk.users (id),
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicles_status_valid check (status in ('pending_review', 'approved', 'rejected', 'suspended')),
  constraint vehicles_plate_format check (
    char_length(plate_number) between 2 and 20 and plate_number !~ '[[:cntrl:]]' and plate_number = btrim(plate_number)),
  constraint vehicles_description_length check (description is null or char_length(description) <= 200),
  constraint vehicles_review_note_length check (review_note is null or char_length(review_note) <= 1000),
  constraint vehicles_id_driver_key unique (id, driver_id)
);
create unique index vehicles_driver_plate_unique on taketuk.vehicles (driver_id, plate_number);
create index vehicles_plate_idx on taketuk.vehicles (plate_number);
create trigger vehicles_set_updated_at before update on taketuk.vehicles
  for each row execute function taketuk.set_updated_at();
create trigger vehicles_status_transition before insert or update of status on taketuk.vehicles
  for each row execute function taketuk.enforce_status_transition('vehicle');
select taketuk.apply_table_security('taketuk.vehicles', 'select, insert, update');

-- The active vehicle must be owned by the driver (composite FK).
alter table taketuk.drivers
  add constraint drivers_active_vehicle_owned_fk
  foreign key (active_vehicle_id, user_id) references taketuk.vehicles (id, driver_id);

create table taketuk.driver_locations (
  driver_id uuid primary key references taketuk.drivers (user_id),
  location extensions.geography(Point, 4326) not null,
  accuracy_meters real,
  device_recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  constraint driver_locations_accuracy_valid check (accuracy_meters is null or (accuracy_meters >= 0 and accuracy_meters <= 10000))
);
create index driver_locations_location_gix on taketuk.driver_locations using gist (location);
create index driver_locations_received_at_idx on taketuk.driver_locations (received_at);
select taketuk.apply_table_security('taketuk.driver_locations', 'select, insert, update');

create table taketuk.driver_documents (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references taketuk.drivers (user_id),
  vehicle_id uuid,
  document_type text not null,
  storage_bucket text not null,
  storage_path text not null unique,
  content_type text not null,
  status text not null,
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint driver_documents_type_valid check (document_type in
    ('driver_photo', 'driving_license', 'national_id', 'vehicle_registration', 'vehicle_photo')),
  constraint driver_documents_status_valid check (status in ('upload_pending', 'uploaded', 'superseded')),
  constraint driver_documents_content_type_valid check (content_type in ('image/jpeg', 'image/png', 'application/pdf')),
  constraint driver_documents_vehicle_iff_vehicle_type check (
    (document_type in ('vehicle_registration', 'vehicle_photo')) = (vehicle_id is not null)),
  constraint driver_documents_uploaded_at check ((status = 'upload_pending') = (uploaded_at is null)),
  constraint driver_documents_vehicle_owned_fk foreign key (vehicle_id, driver_id)
    references taketuk.vehicles (id, driver_id)
);
create index driver_documents_driver_idx on taketuk.driver_documents (driver_id, document_type, status);
create trigger driver_documents_set_updated_at before update on taketuk.driver_documents
  for each row execute function taketuk.set_updated_at();
create trigger driver_documents_status_transition before insert or update of status on taketuk.driver_documents
  for each row execute function taketuk.enforce_status_transition('driver_document');
select taketuk.apply_table_security('taketuk.driver_documents', 'select, insert, update');

insert into taketuk.status_transitions (entity, from_status, to_status) values
  ('driver', '(initial)', 'applicant'),
  ('driver', 'applicant', 'pending_review'),
  ('driver', 'rejected', 'pending_review'),
  ('driver', 'pending_review', 'approved'),
  ('driver', 'pending_review', 'rejected'),
  ('driver', 'approved', 'suspended'),
  ('driver', 'suspended', 'approved'),
  ('vehicle', '(initial)', 'pending_review'),
  ('vehicle', 'pending_review', 'approved'),
  ('vehicle', 'pending_review', 'rejected'),
  ('vehicle', 'approved', 'suspended'),
  ('vehicle', 'suspended', 'approved'),
  ('driver_document', '(initial)', 'upload_pending'),
  ('driver_document', 'upload_pending', 'uploaded'),
  ('driver_document', 'uploaded', 'superseded');
