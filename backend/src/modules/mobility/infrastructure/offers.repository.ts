import { Injectable } from '@nestjs/common';
import type { Queryable, Tx } from '../../../infrastructure/database/database';
import type { OfferStatus, RideOffer } from '../domain/offer';
import { required } from '../../../shared/required';

interface OfferRow {
  id: string;
  ride_id: string;
  driver_id: string;
  vehicle_id: string;
  dispatch_round: number;
  distance_to_pickup_meters: number;
  status: OfferStatus;
  currency: string;
  minimum_fare_minor: number;
  offered_fare_minor: number;
  counter_fare_minor: number | null;
  expires_at: Date;
  created_at: Date;
  countered_at: Date | null;
  closed_at: Date | null;
}

const COLUMNS = `o.id, o.ride_id, o.driver_id, o.vehicle_id, o.dispatch_round, o.distance_to_pickup_meters,
  o.status, o.currency, o.minimum_fare_minor, o.offered_fare_minor, o.counter_fare_minor, o.expires_at,
  o.created_at, o.countered_at, o.closed_at`;

const toOffer = (r: OfferRow): RideOffer => ({
  id: r.id,
  rideId: r.ride_id,
  driverId: r.driver_id,
  vehicleId: r.vehicle_id,
  dispatchRound: r.dispatch_round,
  distanceToPickupMeters: r.distance_to_pickup_meters,
  status: r.status,
  currency: r.currency,
  minimumFareMinor: r.minimum_fare_minor,
  offeredFareMinor: r.offered_fare_minor,
  counterFareMinor: r.counter_fare_minor,
  expiresAt: r.expires_at,
  createdAt: r.created_at,
  counteredAt: r.countered_at,
  closedAt: r.closed_at,
});

export interface LockedOffer {
  readonly offer: RideOffer;
  /** expires_at <= now() by the database clock. */
  readonly expired: boolean;
}

export interface NewOffer {
  readonly rideId: string;
  readonly driverId: string;
  readonly vehicleId: string;
  readonly dispatchRound: number;
  readonly distanceToPickupMeters: number;
  readonly currency: string;
  readonly minimumFareMinor: number;
  readonly offeredFareMinor: number;
  readonly responseTimeoutSeconds: number;
  readonly searchExpiresAt: Date;
}

@Injectable()
export class OffersRepository {
  async find(db: Queryable, offerId: string): Promise<RideOffer | null> {
    const { rows } = await db.query<OfferRow>(
      `select ${COLUMNS} from taketuk.ride_offers o where o.id = $1`,
      [offerId],
    );
    return rows[0] ? toOffer(rows[0]) : null;
  }

  async lock(tx: Tx, offerId: string): Promise<LockedOffer | null> {
    const { rows } = await tx.query<OfferRow & { expired: boolean }>(
      `select ${COLUMNS}, o.expires_at <= now() as expired
         from taketuk.ride_offers o where o.id = $1 for update`,
      [offerId],
    );
    const row = rows[0];
    return row ? { offer: toOffer(row), expired: row.expired } : null;
  }

  async listForRide(db: Queryable, rideId: string): Promise<RideOffer[]> {
    const { rows } = await db.query<OfferRow>(
      `select ${COLUMNS} from taketuk.ride_offers o where o.ride_id = $1 order by o.created_at, o.id`,
      [rideId],
    );
    return rows.map(toOffer);
  }

  async listOpenForDriver(db: Queryable, driverId: string): Promise<RideOffer[]> {
    const { rows } = await db.query<OfferRow>(
      `select ${COLUMNS} from taketuk.ride_offers o
        where o.driver_id = $1 and o.status in ('pending', 'countered') and o.expires_at > now()
        order by o.created_at`,
      [driverId],
    );
    return rows.map(toOffer);
  }

  async countLiveOpenForRide(db: Queryable, rideId: string): Promise<number> {
    const { rows } = await db.query<{ count: number }>(
      `select count(*) as count from taketuk.ride_offers
        where ride_id = $1 and status in ('pending', 'countered') and expires_at > now()`,
      [rideId],
    );
    return rows[0]?.count ?? 0;
  }

  /**
   * Inserts an offer unless it would violate "one offer per (ride, driver)" or "one open offer per
   * driver" — another dispatcher won the driver. Returns null in that case.
   */
  async insertIfPossible(tx: Tx, offer: NewOffer): Promise<RideOffer | null> {
    const { rows } = await tx.query<OfferRow>(
      `insert into taketuk.ride_offers as o
         (ride_id, driver_id, vehicle_id, dispatch_round, distance_to_pickup_meters, status, currency,
          minimum_fare_minor, offered_fare_minor, expires_at)
       values ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, least(now() + make_interval(secs => $9), $10::timestamptz))
       on conflict do nothing
       returning ${COLUMNS}`,
      [
        offer.rideId,
        offer.driverId,
        offer.vehicleId,
        offer.dispatchRound,
        offer.distanceToPickupMeters,
        offer.currency,
        offer.minimumFareMinor,
        offer.offeredFareMinor,
        offer.responseTimeoutSeconds,
        offer.searchExpiresAt,
      ],
    );
    return rows[0] ? toOffer(rows[0]) : null;
  }

  async markCountered(
    tx: Tx,
    offerId: string,
    input: { counterFareMinor: number; responseTimeoutSeconds: number; searchExpiresAt: Date },
  ): Promise<RideOffer> {
    const { rows } = await tx.query<OfferRow>(
      `update taketuk.ride_offers o
          set status = 'countered', counter_fare_minor = $2, countered_at = now(),
              expires_at = least(now() + make_interval(secs => $3), $4::timestamptz)
        where o.id = $1
        returning ${COLUMNS}`,
      [offerId, input.counterFareMinor, input.responseTimeoutSeconds, input.searchExpiresAt],
    );
    return toOffer(required(rows[0], 'row'));
  }

  async close(
    tx: Tx,
    offerId: string,
    status: Exclude<OfferStatus, 'pending' | 'countered'>,
  ): Promise<void> {
    await tx.query(`update taketuk.ride_offers set status = $2, closed_at = now() where id = $1`, [
      offerId,
      status,
    ]);
  }

  /** Withdraws every open offer of a ride (except one, when given). */
  async withdrawOpenForRide(tx: Tx, rideId: string, exceptOfferId?: string): Promise<string[]> {
    const { rows } = await tx.query<{ driver_id: string }>(
      `update taketuk.ride_offers set status = 'withdrawn', closed_at = now()
        where ride_id = $1 and status in ('pending', 'countered') and ($2::uuid is null or id <> $2)
        returning driver_id`,
      [rideId, exceptOfferId ?? null],
    );
    return rows.map((r) => r.driver_id);
  }

  /** Persists expiry of open offers past their window for the given drivers (frees them for new offers). */
  async expireStaleForDrivers(tx: Tx, driverIds: readonly string[]): Promise<void> {
    if (driverIds.length === 0) return;
    await tx.query(
      `update taketuk.ride_offers set status = 'expired', closed_at = now()
        where driver_id = any($1::uuid[]) and status in ('pending', 'countered') and expires_at <= now()`,
      [driverIds],
    );
  }

  /** Sweeper: expire all open offers past their window. Returns the affected ride ids. */
  async expireAllStale(db: Queryable): Promise<string[]> {
    const { rows } = await db.query<{ ride_id: string }>(
      `update taketuk.ride_offers set status = 'expired', closed_at = now()
        where status in ('pending', 'countered') and expires_at <= now()
        returning ride_id`,
    );
    return [...new Set(rows.map((r) => r.ride_id))];
  }

  /**
   * Sweeper: withdraw open offers whose driver is no longer eligible (offline, not approved,
   * changed or lost their approved vehicle). Read-only use of drivers/vehicles tables.
   */
  async withdrawForIneligibleDrivers(db: Queryable): Promise<string[]> {
    const { rows } = await db.query<{ ride_id: string }>(
      `update taketuk.ride_offers o set status = 'withdrawn', closed_at = now()
        where o.status in ('pending', 'countered')
          and exists (
            select 1 from taketuk.drivers d
              left join taketuk.vehicles v on v.id = d.active_vehicle_id
             where d.user_id = o.driver_id
               and (d.status <> 'approved' or d.availability <> 'online'
                    or d.active_vehicle_id is distinct from o.vehicle_id or v.status <> 'approved'))
        returning o.ride_id`,
    );
    return [...new Set(rows.map((r) => r.ride_id))];
  }
}
