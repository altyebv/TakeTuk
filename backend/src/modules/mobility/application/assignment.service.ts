import { Injectable } from '@nestjs/common';
import type { Tx } from '../../../infrastructure/database/database';
import { AuditService } from '../../../platform/audit';
import { OutboxService } from '../../../platform/outbox';
import type { Actor } from '../../../shared/auth/auth-context';
import { AppError } from '../../../shared/errors/app-error';
import { DriverOperationsService } from '../../drivers';
import { FinanceService } from '../../finance';
import { FleetService } from '../../fleet';
import {
  agreedFareFor,
  assignmentStateMachine,
  offerStateMachine,
  type AgreementBasis,
  type OfferStatus,
} from '../domain/offer';
import { rideStateMachine, type Ride } from '../domain/ride';
import { AssignmentsRepository } from '../infrastructure/assignments.repository';
import { OffersRepository } from '../infrastructure/offers.repository';
import { RidesRepository } from '../infrastructure/rides.repository';
import { required } from '../../../shared/required';

export interface ConfirmAssignmentInput {
  readonly rideId: string;
  readonly offerId: string;
  /** The offer state the confirming actor expects: drivers accept `pending`, passengers accept `countered`. */
  readonly expectedOfferStatus: Extract<OfferStatus, 'pending' | 'countered'>;
  readonly basis: AgreementBasis;
  readonly actor: Actor & { type: 'user' };
}

export interface ConfirmAssignmentResult {
  readonly ride: Ride;
  /** true when this call is a retry of an acceptance that already succeeded. */
  readonly replayed: boolean;
}

/**
 * THE CRITICAL SECTION (docs/domain/STATE_MACHINES.md §3). Confirms a fare agreement and a single
 * driver assignment atomically, inside the caller's READ COMMITTED transaction.
 *
 * Safeguards against double confirmation (any one suffices; all are present):
 *   1. SELECT ... FOR UPDATE on the ride, then a status check;
 *   2. the conditional update `status = 'searching'`;
 *   3. UNIQUE (ride_id) on fare_agreements;
 *   4. the partial unique index on active assignments per ride.
 * The partial unique index on active assignments per driver prevents a driver holding two jobs.
 * Lock order: ride → offer → driver.
 */
@Injectable()
export class AssignmentService {
  constructor(
    private readonly rides: RidesRepository,
    private readonly offers: OffersRepository,
    private readonly assignments: AssignmentsRepository,
    private readonly driverOps: DriverOperationsService,
    private readonly fleet: FleetService,
    private readonly finance: FinanceService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async confirm(tx: Tx, input: ConfirmAssignmentInput): Promise<ConfirmAssignmentResult> {
    // 1. Ride lock.
    const lockedRide = await this.rides.lock(tx, input.rideId);
    if (!lockedRide) throw new AppError('RIDE_NOT_FOUND');
    const { ride } = lockedRide;

    // 2. Offer lock.
    const lockedOffer = await this.offers.lock(tx, input.offerId);
    if (!lockedOffer || lockedOffer.offer.rideId !== ride.id) throw new AppError('OFFER_NOT_FOUND');
    const { offer } = lockedOffer;

    // Natural idempotency: the same acceptance already succeeded.
    const acceptedStatus: OfferStatus =
      input.expectedOfferStatus === 'pending' ? 'accepted' : 'counter_accepted';
    if (offer.status === acceptedStatus && ride.fareAgreementId !== null) {
      const agreement = await this.assignments.findAgreementForRide(tx, ride.id);
      if (agreement?.offerId === offer.id) return { ride, replayed: true };
    }

    // 3. Preconditions on ride and offer, evaluated with the database clock. The ride is checked
    //    first so that the loser of an acceptance race learns the ride was taken (its own offer
    //    was withdrawn by the winner).
    if (ride.status !== 'searching' || lockedRide.searchExpired) {
      throw new AppError('RIDE_NO_LONGER_AVAILABLE', undefined, {
        extensions: { currentStatus: ride.status },
      });
    }
    if (offer.status !== input.expectedOfferStatus) {
      throw new AppError('OFFER_NOT_OPEN', `The offer is ${offer.status}.`, {
        extensions: { currentStatus: offer.status },
      });
    }
    if (lockedOffer.expired) throw new AppError('OFFER_EXPIRED');

    // 4. Driver lock and eligibility re-check.
    const driver = await this.driverOps.lockOperationalDriver(tx, offer.driverId);
    const actingDriver = input.actor.role === 'driver';
    if (!driver) throw new AppError('DRIVER_NOT_AVAILABLE');
    if (driver.status !== 'approved') {
      throw actingDriver
        ? new AppError('DRIVER_NOT_APPROVED')
        : new AppError('DRIVER_NOT_AVAILABLE');
    }
    if (
      driver.availability !== 'online' ||
      driver.activeVehicleId !== offer.vehicleId ||
      driver.activeVehicleStatus !== 'approved' ||
      driver.activeVehicleTypeCode === null
    ) {
      throw new AppError(
        'DRIVER_NOT_AVAILABLE',
        actingDriver ? 'Go online with the offered vehicle to accept.' : undefined,
      );
    }
    if (!(await this.fleet.isCompatible(tx, driver.activeVehicleTypeCode, ride.serviceTypeCode))) {
      throw new AppError('VEHICLE_NOT_ELIGIBLE');
    }
    if (await this.assignments.driverHasActiveAssignment(tx, driver.driverId)) {
      throw new AppError('DRIVER_BUSY');
    }

    // 5. Commission terms in force when the job is accepted (FIN-2).
    const commission = await this.finance.getActiveCommissionPolicy(
      tx,
      ride.serviceAreaId,
      ride.serviceTypeCode,
    );
    if (!commission) throw new AppError('PRICING_NOT_CONFIGURED', 'No active commission policy.');

    // 6-9. Agreement, assignment, ride and offers.
    rideStateMachine.assert(ride.status, 'driver_assigned', 'system');
    offerStateMachine.assert(
      offer.status,
      acceptedStatus,
      input.actor.role === 'driver' ? 'driver' : 'passenger',
    );
    assignmentStateMachine.assert('(initial)', 'active', 'system');

    const agreedFareMinor = agreedFareFor(input.basis, offer);
    const agreement = await this.assignments.insertAgreement(tx, {
      rideId: ride.id,
      offerId: offer.id,
      passengerId: ride.passengerId,
      driverId: offer.driverId,
      basis: input.basis,
      currency: ride.currency,
      agreedFareMinor,
      minimumFareMinor: ride.minimumFareMinor,
      passengerProposedFareMinor: ride.proposedFareMinor,
      driverCounterFareMinor:
        input.basis === 'passenger_accepted_driver_counteroffer' ? offer.counterFareMinor : null,
      farePolicyId: ride.farePolicyId,
      farePolicyVersion: ride.farePolicyVersion,
      quoteId: ride.quoteId,
      routeDistanceMeters: ride.routeDistanceMeters,
      routeProvider: ride.routeProvider,
    });
    const assignment = await this.assignments.insertAssignment(tx, {
      rideId: ride.id,
      driverId: offer.driverId,
      vehicleId: offer.vehicleId,
      fareAgreementId: agreement.id,
      commissionPolicyId: commission.id,
      commissionPolicyVersion: commission.version,
      commissionRateBasisPoints: commission.rateBasisPoints,
    });
    const updated = await this.rides.markAssigned(tx, ride.id, {
      driverId: offer.driverId,
      vehicleId: offer.vehicleId,
      fareAgreementId: agreement.id,
      agreedFareMinor,
    });
    if (!updated) throw new AppError('RIDE_NO_LONGER_AVAILABLE');
    await this.offers.close(tx, offer.id, acceptedStatus);
    const withdrawnDrivers = await this.offers.withdrawOpenForRide(tx, ride.id, offer.id);

    // 10. Audit and outbox (notifications are sent only after commit, by the outbox worker).
    await this.audit.record(tx, {
      actor: input.actor,
      action: acceptedStatus === 'accepted' ? 'ride_offer.accepted' : 'ride_offer.counter_accepted',
      entityType: 'ride_offer',
      entityId: offer.id,
      metadata: { rideId: ride.id },
    });
    await this.audit.record(tx, {
      actor: input.actor,
      action: 'ride.assigned',
      entityType: 'ride',
      entityId: ride.id,
      metadata: {
        driverId: offer.driverId,
        vehicleId: offer.vehicleId,
        fareAgreementId: agreement.id,
        assignmentId: assignment.id,
        basis: input.basis,
        agreedFareMinor,
        minimumFareMinor: ride.minimumFareMinor,
        currency: ride.currency,
        farePolicyVersion: ride.farePolicyVersion,
        commissionPolicyVersion: commission.version,
      },
    });
    await this.outbox.enqueue(tx, {
      type: 'ride.assigned',
      aggregateType: 'ride',
      aggregateId: ride.id,
      payload: {
        rideId: ride.id,
        passengerId: ride.passengerId,
        driverId: offer.driverId,
        withdrawnDriverIds: withdrawnDrivers,
      },
    });

    return { ride: required(await this.rides.find(tx, ride.id), 'record'), replayed: false };
  }
}
