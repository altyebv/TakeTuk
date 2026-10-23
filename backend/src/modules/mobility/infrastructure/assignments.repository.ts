import { Injectable } from '@nestjs/common';
import type { Queryable, Tx } from '../../../infrastructure/database/database';
import { isUniqueViolation } from '../../../infrastructure/database/pg-errors';
import { AppError } from '../../../shared/errors/app-error';
import type {
  AgreementBasis,
  AssignmentStatus,
  FareAgreement,
  RideAssignment,
} from '../domain/offer';
import { required } from '../../../shared/required';

interface AgreementRow {
  id: string;
  ride_id: string;
  offer_id: string;
  passenger_id: string;
  driver_id: string;
  basis: AgreementBasis;
  currency: string;
  agreed_fare_minor: number;
  minimum_fare_minor: number;
  passenger_proposed_fare_minor: number;
  driver_counter_fare_minor: number | null;
  fare_policy_id: string;
  fare_policy_version: number;
  quote_id: string;
  route_distance_meters: number;
  route_provider: string;
  agreed_at: Date;
}

const toAgreement = (r: AgreementRow): FareAgreement => ({
  id: r.id,
  rideId: r.ride_id,
  offerId: r.offer_id,
  passengerId: r.passenger_id,
  driverId: r.driver_id,
  basis: r.basis,
  currency: r.currency,
  agreedFareMinor: r.agreed_fare_minor,
  minimumFareMinor: r.minimum_fare_minor,
  passengerProposedFareMinor: r.passenger_proposed_fare_minor,
  driverCounterFareMinor: r.driver_counter_fare_minor,
  farePolicyId: r.fare_policy_id,
  farePolicyVersion: r.fare_policy_version,
  quoteId: r.quote_id,
  routeDistanceMeters: r.route_distance_meters,
  routeProvider: r.route_provider,
  agreedAt: r.agreed_at,
});

interface AssignmentRow {
  id: string;
  ride_id: string;
  driver_id: string;
  vehicle_id: string;
  fare_agreement_id: string;
  commission_policy_id: string;
  commission_policy_version: number;
  commission_rate_basis_points: number;
  status: AssignmentStatus;
  created_at: Date;
  ended_at: Date | null;
}

const toAssignment = (r: AssignmentRow): RideAssignment => ({
  id: r.id,
  rideId: r.ride_id,
  driverId: r.driver_id,
  vehicleId: r.vehicle_id,
  fareAgreementId: r.fare_agreement_id,
  commissionPolicyId: r.commission_policy_id,
  commissionPolicyVersion: r.commission_policy_version,
  commissionRateBasisPoints: r.commission_rate_basis_points,
  status: r.status,
  createdAt: r.created_at,
  endedAt: r.ended_at,
});

export type NewAgreement = Omit<FareAgreement, 'id' | 'agreedAt'>;

export interface NewAssignment {
  readonly rideId: string;
  readonly driverId: string;
  readonly vehicleId: string;
  readonly fareAgreementId: string;
  readonly commissionPolicyId: string;
  readonly commissionPolicyVersion: number;
  readonly commissionRateBasisPoints: number;
}

@Injectable()
export class AssignmentsRepository {
  async insertAgreement(tx: Tx, a: NewAgreement): Promise<FareAgreement> {
    try {
      const { rows } = await tx.query<AgreementRow>(
        `insert into taketuk.fare_agreements
           (ride_id, offer_id, passenger_id, driver_id, basis, currency, agreed_fare_minor, minimum_fare_minor,
            passenger_proposed_fare_minor, driver_counter_fare_minor, fare_policy_id, fare_policy_version, quote_id,
            route_distance_meters, route_provider)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         returning *`,
        [
          a.rideId,
          a.offerId,
          a.passengerId,
          a.driverId,
          a.basis,
          a.currency,
          a.agreedFareMinor,
          a.minimumFareMinor,
          a.passengerProposedFareMinor,
          a.driverCounterFareMinor,
          a.farePolicyId,
          a.farePolicyVersion,
          a.quoteId,
          a.routeDistanceMeters,
          a.routeProvider,
        ],
      );
      return toAgreement(required(rows[0], 'row'));
    } catch (error) {
      if (
        isUniqueViolation(error, 'fare_agreements_one_per_ride') ||
        isUniqueViolation(error, 'fare_agreements_offer_id_key')
      ) {
        throw new AppError(
          'RIDE_NO_LONGER_AVAILABLE',
          'A fare has already been agreed for this ride.',
          { cause: error },
        );
      }
      throw error;
    }
  }

  async insertAssignment(tx: Tx, a: NewAssignment): Promise<RideAssignment> {
    try {
      const { rows } = await tx.query<AssignmentRow>(
        `insert into taketuk.ride_assignments
           (ride_id, driver_id, vehicle_id, fare_agreement_id, commission_policy_id, commission_policy_version,
            commission_rate_basis_points, status)
         values ($1, $2, $3, $4, $5, $6, $7, 'active')
         returning *`,
        [
          a.rideId,
          a.driverId,
          a.vehicleId,
          a.fareAgreementId,
          a.commissionPolicyId,
          a.commissionPolicyVersion,
          a.commissionRateBasisPoints,
        ],
      );
      return toAssignment(required(rows[0], 'row'));
    } catch (error) {
      if (isUniqueViolation(error, 'ride_assignments_one_active_per_driver')) {
        throw new AppError('DRIVER_BUSY', undefined, { cause: error });
      }
      if (isUniqueViolation(error, 'ride_assignments_one_active_per_ride')) {
        throw new AppError('RIDE_NO_LONGER_AVAILABLE', undefined, { cause: error });
      }
      throw error;
    }
  }

  async findAgreementForRide(db: Queryable, rideId: string): Promise<FareAgreement | null> {
    const { rows } = await db.query<AgreementRow>(
      `select * from taketuk.fare_agreements where ride_id = $1`,
      [rideId],
    );
    return rows[0] ? toAgreement(rows[0]) : null;
  }

  async findAssignmentForRide(db: Queryable, rideId: string): Promise<RideAssignment | null> {
    const { rows } = await db.query<AssignmentRow>(
      `select * from taketuk.ride_assignments where ride_id = $1 order by created_at desc limit 1`,
      [rideId],
    );
    return rows[0] ? toAssignment(rows[0]) : null;
  }

  async driverHasActiveAssignment(db: Queryable, driverId: string): Promise<boolean> {
    const { rows } = await db.query(
      `select 1 from taketuk.ride_assignments where driver_id = $1 and status = 'active'`,
      [driverId],
    );
    return rows.length > 0;
  }

  async endActiveAssignment(
    tx: Tx,
    rideId: string,
    status: 'completed' | 'cancelled',
  ): Promise<RideAssignment | null> {
    const { rows } = await tx.query<AssignmentRow>(
      `update taketuk.ride_assignments set status = $2, ended_at = now()
        where ride_id = $1 and status = 'active'
        returning *`,
      [rideId, status],
    );
    return rows[0] ? toAssignment(rows[0]) : null;
  }
}
