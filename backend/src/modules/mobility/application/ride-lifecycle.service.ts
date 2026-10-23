import { Injectable } from '@nestjs/common';
import type { Tx } from '../../../infrastructure/database/database';
import { AuditService } from '../../../platform/audit';
import { OutboxService } from '../../../platform/outbox';
import { actorUserId, systemActor, type Actor } from '../../../shared/auth/auth-context';
import { AppError } from '../../../shared/errors/app-error';
import { assignmentStateMachine } from '../domain/offer';
import { rideStateMachine, type Ride, type RideActor } from '../domain/ride';
import { AssignmentsRepository } from '../infrastructure/assignments.repository';
import { OffersRepository } from '../infrastructure/offers.repository';
import { RidesRepository, type LockedRide } from '../infrastructure/rides.repository';
import { required } from '../../../shared/required';

/** Cancellation and expiry transitions shared by passenger, driver, admin and system paths. */
@Injectable()
export class RideLifecycleService {
  constructor(
    private readonly rides: RidesRepository,
    private readonly offers: OffersRepository,
    private readonly assignments: AssignmentsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Cancels a locked ride. Naturally idempotent for the actor who already cancelled it. No penalty
   * is applied (FIN-4); the facts needed for a future policy are recorded.
   */
  async cancel(
    tx: Tx,
    locked: LockedRide,
    actor: Actor,
    byRole: RideActor,
    reason: string | null,
  ): Promise<Ride> {
    const { ride } = locked;
    if (ride.status === 'cancelled') {
      if (ride.cancelledByUserId === actorUserId(actor) && ride.cancelledByRole === byRole)
        return ride;
      throw new AppError('INVALID_STATE_TRANSITION', 'The ride is already cancelled.', {
        extensions: { currentStatus: ride.status },
      });
    }
    rideStateMachine.assert(
      ride.status,
      'cancelled',
      byRole,
      `A ${byRole} cannot cancel a ride that is ${ride.status}.`,
    );

    const done = await this.rides.markCancelled(tx, ride.id, {
      from: ride.status,
      byRole,
      byUserId: actorUserId(actor),
      reason,
    });
    if (!done) throw new AppError('CONCURRENT_UPDATE');

    if (ride.assignedDriverId) {
      assignmentStateMachine.assert('active', 'cancelled', 'system');
      await this.assignments.endActiveAssignment(tx, ride.id, 'cancelled');
    }
    const withdrawnDriverIds = await this.offers.withdrawOpenForRide(tx, ride.id);

    await this.audit.record(tx, {
      actor,
      action: 'ride.cancelled',
      entityType: 'ride',
      entityId: ride.id,
      metadata: { cancelledByRole: byRole, statusBeforeCancellation: ride.status, reason },
    });
    await this.outbox.enqueue(tx, {
      type: 'ride.cancelled',
      aggregateType: 'ride',
      aggregateId: ride.id,
      payload: {
        rideId: ride.id,
        passengerId: ride.passengerId,
        driverId: ride.assignedDriverId,
        cancelledByRole: byRole,
        withdrawnDriverIds,
      },
    });
    return required(await this.rides.find(tx, ride.id), 'record');
  }

  /** searching → expired when the search window has elapsed (database clock). */
  async expireIfDue(tx: Tx, locked: LockedRide): Promise<boolean> {
    const { ride } = locked;
    if (ride.status !== 'searching' || !locked.searchExpired) return false;
    rideStateMachine.assert(ride.status, 'expired', 'system');
    if (!(await this.rides.transition(tx, ride.id, 'searching', 'expired'))) return false;
    const withdrawnDriverIds = await this.offers.withdrawOpenForRide(tx, ride.id);
    await this.audit.record(tx, {
      actor: systemActor('dispatch'),
      action: 'ride.expired',
      entityType: 'ride',
      entityId: ride.id,
      metadata: { dispatchRounds: ride.dispatchRound },
    });
    await this.outbox.enqueue(tx, {
      type: 'ride.expired',
      aggregateType: 'ride',
      aggregateId: ride.id,
      payload: { rideId: ride.id, passengerId: ride.passengerId, withdrawnDriverIds },
    });
    return true;
  }
}
