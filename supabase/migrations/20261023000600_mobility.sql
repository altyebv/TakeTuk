-- Mobility: rides, dispatch offers (fare negotiation), fare agreements and driver assignments.
-- The concurrency guarantees of docs/domain/STATE_MACHINES.md section 3 are encoded here.

create table taketuk.rides (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references taketuk.users (id),
  quote_id uuid not null unique references taketuk.fare_quotes (id),
  service_area_id uuid not null references taketuk.service_areas (id),
  service_type_code text not null references taketuk.service_types (code),
  pickup extensions.geography(Point, 4326) not null,
  pickup_label text,
  destination extensions.geography(Point, 4326) not null,
  destination_label text,
  route_distance_meters integer not null,
  route_duration_seconds integer,
  route_provider text not null,
  fare_policy_id uuid not null references taketuk.fare_policies (id),
  fare_policy_version integer not null,
  currency text not null,
  minimum_fare_minor bigint not null,
  proposed_fare_minor bigint not null,
  status text not null,
  search_expires_at timestamptz not null,
  dispatch_round integer not null default 0,
  next_dispatch_at timestamptz not null default now(),
  assigned_driver_id uuid references taketuk.drivers (user_id),
  assigned_vehicle_id uuid references taketuk.vehicles (id),
  fare_agreement_id uuid,
  agreed_fare_minor bigint,
  assigned_at timestamptz,
  driver_arrived_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  expired_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by_role text,
  cancelled_by_user_id uuid references taketuk.users (id),
  cancellation_reason text,
  status_before_cancellation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rides_status_valid check (status in
    ('searching', 'driver_assigned', 'driver_arrived', 'in_progress', 'completed', 'cancelled', 'expired')),
  constraint rides_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint rides_minimum_positive check (minimum_fare_minor > 0),
  constraint rides_proposed_fare_at_least_minimum check (proposed_fare_minor >= minimum_fare_minor),
  constraint rides_agreed_fare_at_least_minimum check (agreed_fare_minor is null or agreed_fare_minor >= minimum_fare_minor),
  constraint rides_dispatch_round_valid check (dispatch_round >= 0),
  constraint rides_assignment_consistency check (
    case
      when status in ('searching', 'expired') then
        assigned_driver_id is null and assigned_vehicle_id is null and fare_agreement_id is null and agreed_fare_minor is null
      when status = 'cancelled' then
        (assigned_driver_id is null) = (fare_agreement_id is null)
        and (fare_agreement_id is null) = (agreed_fare_minor is null)
        and (assigned_driver_id is null) = (assigned_vehicle_id is null)
      else
        assigned_driver_id is not null and assigned_vehicle_id is not null
        and fare_agreement_id is not null and agreed_fare_minor is not null and assigned_at is not null
    end),
  constraint rides_cancellation_consistency check (
    (status = 'cancelled') = (cancelled_at is not null and cancelled_by_role is not null and status_before_cancellation is not null)),
  constraint rides_cancelled_by_role_valid check (
    cancelled_by_role is null or cancelled_by_role in ('passenger', 'driver', 'admin', 'system')),
  constraint rides_cancellation_reason_length check (cancellation_reason is null or char_length(cancellation_reason) <= 500),
  constraint rides_completed_consistency check ((status = 'completed') = (completed_at is not null)),
  constraint rides_labels_length check (
    (pickup_label is null or char_length(pickup_label) <= 200) and
    (destination_label is null or char_length(destination_label) <= 200))
);
-- A passenger has at most one open ride.
create unique index rides_one_open_per_passenger on taketuk.rides (passenger_id)
  where status in ('searching', 'driver_assigned', 'driver_arrived', 'in_progress');
create index rides_searching_dispatch_idx on taketuk.rides (next_dispatch_at) where status = 'searching';
create index rides_searching_expiry_idx on taketuk.rides (search_expires_at) where status = 'searching';
create index rides_passenger_created_idx on taketuk.rides (passenger_id, created_at desc, id desc);
create index rides_driver_created_idx on taketuk.rides (assigned_driver_id, created_at desc, id desc)
  where assigned_driver_id is not null;
create trigger rides_set_updated_at before update on taketuk.rides
  for each row execute function taketuk.set_updated_at();
create trigger rides_status_transition before insert or update of status on taketuk.rides
  for each row execute function taketuk.enforce_status_transition('ride');
select taketuk.apply_table_security('taketuk.rides', 'select, insert, update');

create table taketuk.ride_offers (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references taketuk.rides (id),
  driver_id uuid not null references taketuk.drivers (user_id),
  vehicle_id uuid not null references taketuk.vehicles (id),
  dispatch_round integer not null,
  distance_to_pickup_meters integer not null,
  status text not null,
  currency text not null,
  minimum_fare_minor bigint not null,
  offered_fare_minor bigint not null,
  counter_fare_minor bigint,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  countered_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint ride_offers_status_valid check (status in
    ('pending', 'countered', 'accepted', 'declined', 'counter_accepted', 'counter_rejected', 'expired', 'withdrawn')),
  constraint ride_offers_round_positive check (dispatch_round > 0),
  constraint ride_offers_distance_valid check (distance_to_pickup_meters >= 0),
  constraint ride_offers_offered_at_least_minimum check (offered_fare_minor >= minimum_fare_minor),
  constraint ride_offers_counter_at_least_minimum check (counter_fare_minor is null or counter_fare_minor >= minimum_fare_minor),
  constraint ride_offers_counter_present check (
    status not in ('countered', 'counter_accepted', 'counter_rejected') or (counter_fare_minor is not null and countered_at is not null)),
  constraint ride_offers_closed_consistency check ((status in ('pending', 'countered')) = (closed_at is null)),
  -- A ride is offered to a given driver at most once.
  constraint ride_offers_ride_driver_key unique (ride_id, driver_id)
);
-- A driver holds at most one open offer at a time (DSP-2).
create unique index ride_offers_one_open_per_driver on taketuk.ride_offers (driver_id)
  where status in ('pending', 'countered');
create index ride_offers_open_by_ride_idx on taketuk.ride_offers (ride_id) where status in ('pending', 'countered');
create index ride_offers_open_expiry_idx on taketuk.ride_offers (expires_at) where status in ('pending', 'countered');
create trigger ride_offers_set_updated_at before update on taketuk.ride_offers
  for each row execute function taketuk.set_updated_at();
create trigger ride_offers_status_transition before insert or update of status on taketuk.ride_offers
  for each row execute function taketuk.enforce_status_transition('ride_offer');
select taketuk.apply_table_security('taketuk.ride_offers', 'select, insert, update');

-- Immutable record of a confirmed fare (append-only for the backend role).
create table taketuk.fare_agreements (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references taketuk.rides (id),
  offer_id uuid not null unique references taketuk.ride_offers (id),
  passenger_id uuid not null references taketuk.users (id),
  driver_id uuid not null references taketuk.drivers (user_id),
  basis text not null,
  currency text not null,
  agreed_fare_minor bigint not null,
  minimum_fare_minor bigint not null,
  passenger_proposed_fare_minor bigint not null,
  driver_counter_fare_minor bigint,
  fare_policy_id uuid not null references taketuk.fare_policies (id),
  fare_policy_version integer not null,
  quote_id uuid not null references taketuk.fare_quotes (id),
  route_distance_meters integer not null,
  route_provider text not null,
  agreed_at timestamptz not null default now(),
  -- One confirmed fare per ride (v1 has no reassignment; DSP-3).
  constraint fare_agreements_one_per_ride unique (ride_id),
  constraint fare_agreements_basis_valid check (basis in
    ('driver_accepted_passenger_proposal', 'passenger_accepted_driver_counteroffer')),
  constraint fare_agreements_at_least_minimum check (agreed_fare_minor >= minimum_fare_minor),
  constraint fare_agreements_basis_consistency check (
    case basis
      when 'driver_accepted_passenger_proposal' then
        driver_counter_fare_minor is null and agreed_fare_minor = passenger_proposed_fare_minor
      else
        driver_counter_fare_minor is not null and agreed_fare_minor = driver_counter_fare_minor
    end)
);
select taketuk.apply_table_security('taketuk.fare_agreements', 'select, insert');

alter table taketuk.rides
  add constraint rides_fare_agreement_fk foreign key (fare_agreement_id) references taketuk.fare_agreements (id);

create table taketuk.ride_assignments (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references taketuk.rides (id),
  driver_id uuid not null references taketuk.drivers (user_id),
  vehicle_id uuid not null references taketuk.vehicles (id),
  fare_agreement_id uuid not null unique references taketuk.fare_agreements (id),
  commission_policy_id uuid not null references taketuk.commission_policies (id),
  commission_policy_version integer not null,
  commission_rate_basis_points integer not null,
  status text not null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint ride_assignments_status_valid check (status in ('active', 'completed', 'cancelled')),
  constraint ride_assignments_rate_valid check (commission_rate_basis_points between 0 and 10000),
  constraint ride_assignments_ended_consistency check ((status = 'active') = (ended_at is null))
);
-- The core guarantees: one confirmed driver per ride, one active job per driver.
create unique index ride_assignments_one_active_per_ride on taketuk.ride_assignments (ride_id) where status = 'active';
create unique index ride_assignments_one_active_per_driver on taketuk.ride_assignments (driver_id) where status = 'active';
create trigger ride_assignments_set_updated_at before update on taketuk.ride_assignments
  for each row execute function taketuk.set_updated_at();
create trigger ride_assignments_status_transition before insert or update of status on taketuk.ride_assignments
  for each row execute function taketuk.enforce_status_transition('ride_assignment');
select taketuk.apply_table_security('taketuk.ride_assignments', 'select, insert, update');

insert into taketuk.status_transitions (entity, from_status, to_status) values
  ('ride', '(initial)', 'searching'),
  ('ride', 'searching', 'driver_assigned'),
  ('ride', 'searching', 'cancelled'),
  ('ride', 'searching', 'expired'),
  ('ride', 'driver_assigned', 'driver_arrived'),
  ('ride', 'driver_assigned', 'cancelled'),
  ('ride', 'driver_arrived', 'in_progress'),
  ('ride', 'driver_arrived', 'cancelled'),
  ('ride', 'in_progress', 'completed'),
  ('ride', 'in_progress', 'cancelled'),
  ('ride_offer', '(initial)', 'pending'),
  ('ride_offer', 'pending', 'accepted'),
  ('ride_offer', 'pending', 'declined'),
  ('ride_offer', 'pending', 'countered'),
  ('ride_offer', 'pending', 'expired'),
  ('ride_offer', 'pending', 'withdrawn'),
  ('ride_offer', 'countered', 'counter_accepted'),
  ('ride_offer', 'countered', 'counter_rejected'),
  ('ride_offer', 'countered', 'expired'),
  ('ride_offer', 'countered', 'withdrawn'),
  ('ride_assignment', '(initial)', 'active'),
  ('ride_assignment', 'active', 'completed'),
  ('ride_assignment', 'active', 'cancelled');
