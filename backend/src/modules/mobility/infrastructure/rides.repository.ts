import { Injectable } from '@nestjs/common';
import type { Queryable, Tx } from '../../../infrastructure/database/database';
import { isUniqueViolation } from '../../../infrastructure/database/pg-errors';
import { AppError } from '../../../shared/errors/app-error';
import { sqlLatLng, sqlPoint } from '../../geography';
import type { FareQuote } from '../../pricing';
import type { Ride, RideActor, RideStatus } from '../domain/ride';
import { required } from '../../../shared/required';

interface RideRow {
  id: string;
  passenger_id: string;
  quote_id: string;
  service_area_id: string;
  service_type_code: string;
  pickup_lat: number;
  pickup_lng: number;
  pickup_label: string | null;
  destination_lat: number;
  destination_lng: number;
  destination_label: string | null;
  route_distance_meters: number;
  route_duration_seconds: number | null;
  route_provider: string;
  fare_policy_id: string;
  fare_policy_version: number;
  currency: string;
  minimum_fare_minor: number;
  proposed_fare_minor: number;
  status: RideStatus;
  search_expires_at: Date;
  dispatch_round: number;
  assigned_driver_id: string | null;
  assigned_vehicle_id: string | null;
  fare_agreement_id: string | null;
  agreed_fare_minor: number | null;
  assigned_at: Date | null;
  driver_arrived_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  expired_at: Date | null;
  cancelled_at: Date | null;
  cancelled_by_role: RideActor | null;
  cancelled_by_user_id: string | null;
  cancellation_reason: string | null;
  status_before_cancellation: RideStatus | null;
  created_at: Date;
}

const COLUMNS = `
  r.id, r.passenger_id, r.quote_id, r.service_area_id, r.service_type_code,
  ${sqlLatLng('r.pickup', 'pickup')}, r.pickup_label,
  ${sqlLatLng('r.destination', 'destination')}, r.destination_label,
  r.route_distance_meters, r.route_duration_seconds, r.route_provider, r.fare_policy_id, r.fare_policy_version,
  r.currency, r.minimum_fare_minor, r.proposed_fare_minor, r.status, r.search_expires_at, r.dispatch_round,
  r.assigned_driver_id, r.assigned_vehicle_id, r.fare_agreement_id, r.agreed_fare_minor, r.assigned_at,
  r.driver_arrived_at, r.started_at, r.completed_at, r.expired_at, r.cancelled_at, r.cancelled_by_role,
  r.cancelled_by_user_id, r.cancellation_reason, r.status_before_cancellation, r.created_at`;

export const toRide = (r: RideRow): Ride => ({
  id: r.id,
  passengerId: r.passenger_id,
  quoteId: r.quote_id,
  serviceAreaId: r.service_area_id,
  serviceTypeCode: r.service_type_code,
  pickup: { lat: r.pickup_lat, lng: r.pickup_lng },
  pickupLabel: r.pickup_label,
  destination: { lat: r.destination_lat, lng: r.destination_lng },
  destinationLabel: r.destination_label,
  routeDistanceMeters: r.route_distance_meters,
  routeDurationSeconds: r.route_duration_seconds,
  routeProvider: r.route_provider,
  farePolicyId: r.fare_policy_id,
  farePolicyVersion: r.fare_policy_version,
  currency: r.currency,
  minimumFareMinor: r.minimum_fare_minor,
  proposedFareMinor: r.proposed_fare_minor,
  status: r.status,
  searchExpiresAt: r.search_expires_at,
  dispatchRound: r.dispatch_round,
  assignedDriverId: r.assigned_driver_id,
  assignedVehicleId: r.assigned_vehicle_id,
  fareAgreementId: r.fare_agreement_id,
  agreedFareMinor: r.agreed_fare_minor,
  assignedAt: r.assigned_at,
  driverArrivedAt: r.driver_arrived_at,
  startedAt: r.started_at,
  completedAt: r.completed_at,
  expiredAt: r.expired_at,
  cancelledAt: r.cancelled_at,
  cancelledByRole: r.cancelled_by_role,
  cancelledByUserId: r.cancelled_by_user_id,
  cancellationReason: r.cancellation_reason,
  statusBeforeCancellation: r.status_before_cancellation,
  createdAt: r.created_at,
});

export interface LockedRide {
  readonly ride: Ride;
  /** search_expires_at <= now() by the database clock. */
  readonly searchExpired: boolean;
}

export interface RideListRow {
  readonly ride: Ride;
  readonly sortKey: string;
}

/** Timestamp column set by each lifecycle transition. */
const TRANSITION_TIMESTAMP: Partial<Record<RideStatus, string>> = {
  driver_arrived: 'driver_arrived_at',
  in_progress: 'started_at',
  completed: 'completed_at',
  expired: 'expired_at',
};

@Injectable()
export class RidesRepository {
  async insertFromQuote(
    tx: Tx,
    quote: FareQuote,
    input: { proposedFareMinor: number; searchTimeoutSeconds: number },
  ): Promise<Ride> {
    try {
      const { rows } = await tx.query<{ id: string }>(
        `insert into taketuk.rides
           (passenger_id, quote_id, service_area_id, service_type_code, pickup, pickup_label, destination,
            destination_label, route_distance_meters, route_duration_seconds, route_provider, fare_policy_id,
            fare_policy_version, currency, minimum_fare_minor, proposed_fare_minor, status, search_expires_at,
            next_dispatch_at)
         values ($1, $2, $3, $4, ${sqlPoint('$6', '$5')}, $7, ${sqlPoint('$9', '$8')}, $10, $11, $12, $13, $14,
                 $15, $16, $17, $18, 'searching', now() + make_interval(secs => $19), now())
         returning id`,
        [
          quote.passengerId,
          quote.id,
          quote.serviceAreaId,
          quote.serviceTypeCode,
          quote.pickup.lat,
          quote.pickup.lng,
          quote.pickupLabel,
          quote.destination.lat,
          quote.destination.lng,
          quote.destinationLabel,
          quote.routeDistanceMeters,
          quote.routeDurationSeconds,
          quote.routeProvider,
          quote.farePolicyId,
          quote.farePolicyVersion,
          quote.currency,
          quote.minimumFareMinor,
          input.proposedFareMinor,
          input.searchTimeoutSeconds,
        ],
      );
      return required(await this.find(tx, required(rows[0], 'row').id), 'record');
    } catch (error) {
      if (isUniqueViolation(error, 'rides_one_open_per_passenger')) {
        throw new AppError(
          'RIDE_ALREADY_OPEN',
          'Finish or cancel your current ride before requesting another.',
        );
      }
      throw error;
    }
  }

  async find(db: Queryable, rideId: string): Promise<Ride | null> {
    const { rows } = await db.query<RideRow>(
      `select ${COLUMNS} from taketuk.rides r where r.id = $1`,
      [rideId],
    );
    return rows[0] ? toRide(rows[0]) : null;
  }

  /** Row lock on the ride: the first lock of every multi-entity use case (ride → offer → driver). */
  async lock(
    tx: Tx,
    rideId: string,
    options: { skipLocked?: boolean } = {},
  ): Promise<LockedRide | null> {
    const { rows } = await tx.query<RideRow & { search_expired: boolean }>(
      `select ${COLUMNS}, r.search_expires_at <= now() as search_expired
         from taketuk.rides r where r.id = $1
        for update ${options.skipLocked ? 'skip locked' : ''}`,
      [rideId],
    );
    const row = rows[0];
    return row ? { ride: toRide(row), searchExpired: row.search_expired } : null;
  }

  async listForPassenger(
    db: Queryable,
    passengerId: string,
    page: { limit: number; after?: { sortKey: string; id: string } | undefined },
  ): Promise<RideListRow[]> {
    return this.listBy(db, 'r.passenger_id = $1', passengerId, page);
  }

  async listForDriver(
    db: Queryable,
    driverId: string,
    page: { limit: number; after?: { sortKey: string; id: string } | undefined },
  ): Promise<RideListRow[]> {
    return this.listBy(db, 'r.assigned_driver_id = $1', driverId, page);
  }

  async findCurrentForDriver(db: Queryable, driverId: string): Promise<Ride | null> {
    const { rows } = await db.query<RideRow>(
      `select ${COLUMNS} from taketuk.rides r
         join taketuk.ride_assignments a on a.ride_id = r.id and a.status = 'active'
        where a.driver_id = $1`,
      [driverId],
    );
    return rows[0] ? toRide(rows[0]) : null;
  }

  private async listBy(
    db: Queryable,
    predicate: string,
    value: string,
    page: { limit: number; after?: { sortKey: string; id: string } | undefined },
  ): Promise<RideListRow[]> {
    const { rows } = await db.query<RideRow & { created_at_key: string }>(
      `select ${COLUMNS}, r.created_at::text as created_at_key
         from taketuk.rides r
        where ${predicate}
          and ($2::timestamptz is null or (r.created_at, r.id) < ($2::timestamptz, $3::uuid))
        order by r.created_at desc, r.id desc
        limit $4`,
      [value, page.after?.sortKey ?? null, page.after?.id ?? null, page.limit],
    );
    return rows.map((r) => ({ ride: toRide(r), sortKey: r.created_at_key }));
  }

  /** searching → driver_assigned; conditional on the current status (concurrency backstop). */
  async markAssigned(
    tx: Tx,
    rideId: string,
    input: {
      driverId: string;
      vehicleId: string;
      fareAgreementId: string;
      agreedFareMinor: number;
    },
  ): Promise<boolean> {
    const { rowCount } = await tx.query(
      `update taketuk.rides
          set status = 'driver_assigned', assigned_driver_id = $2, assigned_vehicle_id = $3,
              fare_agreement_id = $4, agreed_fare_minor = $5, assigned_at = now()
        where id = $1 and status = 'searching'`,
      [rideId, input.driverId, input.vehicleId, input.fareAgreementId, input.agreedFareMinor],
    );
    return rowCount === 1;
  }

  /** Lifecycle transition with its timestamp; conditional on the expected current status. */
  async transition(tx: Tx, rideId: string, from: RideStatus, to: RideStatus): Promise<boolean> {
    const timestampColumn = TRANSITION_TIMESTAMP[to];
    const { rowCount } = await tx.query(
      `update taketuk.rides
          set status = $3${timestampColumn ? `, ${timestampColumn} = now()` : ''}
        where id = $1 and status = $2`,
      [rideId, from, to],
    );
    return rowCount === 1;
  }

  async markCancelled(
    tx: Tx,
    rideId: string,
    input: { from: RideStatus; byRole: RideActor; byUserId: string | null; reason: string | null },
  ): Promise<boolean> {
    const { rowCount } = await tx.query(
      `update taketuk.rides
          set status = 'cancelled', cancelled_at = now(), cancelled_by_role = $3, cancelled_by_user_id = $4,
              cancellation_reason = $5, status_before_cancellation = $2
        where id = $1 and status = $2`,
      [rideId, input.from, input.byRole, input.byUserId, input.reason],
    );
    return rowCount === 1;
  }

  async recordDispatchRound(
    tx: Tx,
    rideId: string,
    round: number,
    nextDispatchInSeconds: number,
  ): Promise<void> {
    await tx.query(
      `update taketuk.rides
          set dispatch_round = $2, next_dispatch_at = now() + make_interval(secs => $3)
        where id = $1`,
      [rideId, round, nextDispatchInSeconds],
    );
  }

  async postponeDispatch(tx: Tx, rideId: string, seconds: number): Promise<void> {
    await tx.query(
      `update taketuk.rides set next_dispatch_at = now() + make_interval(secs => $2) where id = $1`,
      [rideId, seconds],
    );
  }

  /** Makes searching rides eligible for an immediate dispatch round (e.g. after offers closed). */
  async nudgeDispatch(db: Queryable, rideIds: readonly string[]): Promise<void> {
    if (rideIds.length === 0) return;
    await db.query(
      `update taketuk.rides set next_dispatch_at = now()
        where id = any($1::uuid[]) and status = 'searching' and next_dispatch_at > now()`,
      [rideIds],
    );
  }

  async findDueForExpiry(db: Queryable, limit: number): Promise<string[]> {
    const { rows } = await db.query<{ id: string }>(
      `select id from taketuk.rides
        where status = 'searching' and search_expires_at <= now()
        order by search_expires_at limit $1`,
      [limit],
    );
    return rows.map((r) => r.id);
  }

  async findDueForDispatch(db: Queryable, limit: number): Promise<string[]> {
    const { rows } = await db.query<{ id: string }>(
      `select id from taketuk.rides
        where status = 'searching' and next_dispatch_at <= now() and search_expires_at > now()
        order by next_dispatch_at limit $1`,
      [limit],
    );
    return rows.map((r) => r.id);
  }
}
