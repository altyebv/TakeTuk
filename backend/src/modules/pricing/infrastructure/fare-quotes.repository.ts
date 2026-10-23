import { Injectable } from '@nestjs/common';
import type { Queryable, Tx } from '../../../infrastructure/database/database';
import { sqlLatLng, sqlPoint } from '../../geography';
import type { FareQuote } from '../domain/fare-policy';
import { required } from '../../../shared/required';

interface QuoteRow {
  id: string;
  passenger_id: string;
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
  route_estimated_at: Date;
  fare_policy_id: string;
  fare_policy_version: number;
  currency: string;
  minimum_fare_minor: number;
  created_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
}

const SELECT = `
  select id, passenger_id, service_area_id, service_type_code,
         ${sqlLatLng('pickup', 'pickup')}, pickup_label,
         ${sqlLatLng('destination', 'destination')}, destination_label,
         route_distance_meters, route_duration_seconds, route_provider, route_estimated_at,
         fare_policy_id, fare_policy_version, currency, minimum_fare_minor, created_at, expires_at, consumed_at
    from taketuk.fare_quotes`;

const toQuote = (r: QuoteRow): FareQuote => ({
  id: r.id,
  passengerId: r.passenger_id,
  serviceAreaId: r.service_area_id,
  serviceTypeCode: r.service_type_code,
  pickup: { lat: r.pickup_lat, lng: r.pickup_lng },
  pickupLabel: r.pickup_label,
  destination: { lat: r.destination_lat, lng: r.destination_lng },
  destinationLabel: r.destination_label,
  routeDistanceMeters: r.route_distance_meters,
  routeDurationSeconds: r.route_duration_seconds,
  routeProvider: r.route_provider,
  routeEstimatedAt: r.route_estimated_at,
  farePolicyId: r.fare_policy_id,
  farePolicyVersion: r.fare_policy_version,
  currency: r.currency,
  minimumFareMinor: r.minimum_fare_minor,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  consumedAt: r.consumed_at,
});

export interface NewQuote {
  readonly passengerId: string;
  readonly serviceAreaId: string;
  readonly serviceTypeCode: string;
  readonly pickup: { lat: number; lng: number };
  readonly pickupLabel: string | null;
  readonly destination: { lat: number; lng: number };
  readonly destinationLabel: string | null;
  readonly routeDistanceMeters: number;
  readonly routeDurationSeconds: number | null;
  readonly routeProvider: string;
  readonly routeEstimatedAt: Date;
  readonly farePolicyId: string;
  readonly farePolicyVersion: number;
  readonly currency: string;
  readonly minimumFareMinor: number;
  readonly ttlSeconds: number;
}

@Injectable()
export class FareQuotesRepository {
  async countRecent(db: Queryable, passengerId: string, windowSeconds: number): Promise<number> {
    const { rows } = await db.query<{ count: number }>(
      `select count(*) as count from taketuk.fare_quotes
        where passenger_id = $1 and created_at > now() - make_interval(secs => $2)`,
      [passengerId, windowSeconds],
    );
    return rows[0]?.count ?? 0;
  }

  async insert(db: Queryable, q: NewQuote): Promise<FareQuote> {
    const { rows } = await db.query<{ id: string }>(
      `insert into taketuk.fare_quotes
         (passenger_id, service_area_id, service_type_code, pickup, pickup_label, destination, destination_label,
          route_distance_meters, route_duration_seconds, route_provider, route_estimated_at,
          fare_policy_id, fare_policy_version, currency, minimum_fare_minor, expires_at)
       values ($1, $2, $3, ${sqlPoint('$5', '$4')}, $6, ${sqlPoint('$8', '$7')}, $9,
               $10, $11, $12, $13, $14, $15, $16, $17, now() + make_interval(secs => $18))
       returning id`,
      [
        q.passengerId,
        q.serviceAreaId,
        q.serviceTypeCode,
        q.pickup.lat,
        q.pickup.lng,
        q.pickupLabel,
        q.destination.lat,
        q.destination.lng,
        q.destinationLabel,
        q.routeDistanceMeters,
        q.routeDurationSeconds,
        q.routeProvider,
        q.routeEstimatedAt,
        q.farePolicyId,
        q.farePolicyVersion,
        q.currency,
        q.minimumFareMinor,
        q.ttlSeconds,
      ],
    );
    return required(await this.find(db, required(rows[0], 'row').id), 'record');
  }

  async find(db: Queryable, id: string): Promise<FareQuote | null> {
    const { rows } = await db.query<QuoteRow>(`${SELECT} where id = $1`, [id]);
    return rows[0] ? toQuote(rows[0]) : null;
  }

  /** Locks the quote and reports expiry against the database clock. */
  async lockWithExpiry(tx: Tx, id: string): Promise<{ quote: FareQuote; expired: boolean } | null> {
    const { rows } = await tx.query<QuoteRow & { expired: boolean }>(
      `${SELECT.replace('from taketuk.fare_quotes', ', expires_at <= now() as expired from taketuk.fare_quotes')}
        where id = $1 for update`,
      [id],
    );
    const row = rows[0];
    return row ? { quote: toQuote(row), expired: row.expired } : null;
  }

  async markConsumed(tx: Tx, id: string): Promise<void> {
    await tx.query(`update taketuk.fare_quotes set consumed_at = now() where id = $1`, [id]);
  }

  /** Unused quotes are disposable once well past expiry; consumed ones are kept (rides reference them). */
  async deleteStaleUnconsumed(db: Queryable, olderThanHours: number): Promise<number> {
    const { rowCount } = await db.query(
      `delete from taketuk.fare_quotes
        where consumed_at is null and expires_at < now() - make_interval(hours => $1)`,
      [olderThanHours],
    );
    return rowCount;
  }
}
