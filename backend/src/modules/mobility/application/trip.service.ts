import { Injectable } from '@nestjs/common';
import { Database } from '../../../infrastructure/database/database';
import { AuditService } from '../../../platform/audit';
import { OutboxService } from '../../../platform/outbox';
import { actorAs, type AuthContext } from '../../../shared/auth/auth-context';
import { AppError } from '../../../shared/errors/app-error';
import { decodeCursor, toPage, type Page } from '../../../shared/pagination';
import { FinanceService } from '../../finance';
import { assignmentStateMachine } from '../domain/offer';
import { rideStateMachine, TRIP_ACTION_TARGET, type DriverTripAction } from '../domain/ride';
import { AssignmentsRepository } from '../infrastructure/assignments.repository';
import { RidesRepository } from '../infrastructure/rides.repository';
import { RideLifecycleService } from './ride-lifecycle.service';
import { RideViews, type AdminRideView, type DriverRideView } from './ride-views';
import { required } from '../../../shared/required';

const TRIP_EVENT: Readonly<Record<DriverTripAction, string>> = {
  arrive: 'ride.driver_arrived',
  start: 'ride.started',
  complete: 'ride.completed',
};

/** Trip lifecycle for the assigned driver, plus admin ride review (STATE_MACHINES §4). */
@Injectable()
export class TripService {
  constructor(
    private readonly db: Database,
    private readonly rides: RidesRepository,
    private readonly assignments: AssignmentsRepository,
    private readonly lifecycle: RideLifecycleService,
    private readonly finance: FinanceService,
    private readonly views: RideViews,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * arrive / start / complete. Only the assigned driver may act; others get 404 so the ride's
   * existence is not revealed. Repeating a transition already made returns the current state.
   */
  async driverTransition(
    auth: AuthContext,
    rideId: string,
    action: DriverTripAction,
  ): Promise<DriverRideView> {
    const driver = actorAs(auth, 'driver');
    const target = TRIP_ACTION_TARGET[action];
    return this.db.transaction(async (tx) => {
      const locked = await this.rides.lock(tx, rideId);
      if (!locked || locked.ride.assignedDriverId !== driver.userId)
        throw new AppError('RIDE_NOT_FOUND');
      const { ride } = locked;
      if (ride.status === target) return this.views.driverRideView(tx, ride);

      rideStateMachine.assert(
        ride.status,
        target,
        'driver',
        `Cannot ${action} a ride that is ${ride.status}.`,
      );
      if (!(await this.rides.transition(tx, ride.id, ride.status, target)))
        throw new AppError('CONCURRENT_UPDATE');

      await this.audit.record(tx, {
        actor: driver,
        action: TRIP_EVENT[action],
        entityType: 'ride',
        entityId: ride.id,
        metadata: { from: ride.status, to: target },
      });

      if (action === 'complete') {
        assignmentStateMachine.assert('active', 'completed', 'system');
        const assignment = await this.assignments.endActiveAssignment(tx, ride.id, 'completed');
        if (!assignment || ride.agreedFareMinor === null) {
          throw new AppError(
            'INTERNAL_ERROR',
            'Completed ride has no active assignment or agreed fare.',
          );
        }
        await this.finance.recordRideCompletion(tx, {
          rideId: ride.id,
          driverId: driver.userId,
          passengerId: ride.passengerId,
          currency: ride.currency,
          agreedFareMinor: ride.agreedFareMinor,
          commissionRateBasisPoints: assignment.commissionRateBasisPoints,
          commissionPolicyId: assignment.commissionPolicyId,
          commissionPolicyVersion: assignment.commissionPolicyVersion,
          actor: driver,
        });
      }

      await this.outbox.enqueue(tx, {
        type: TRIP_EVENT[action],
        aggregateType: 'ride',
        aggregateId: ride.id,
        payload: { rideId: ride.id, passengerId: ride.passengerId, driverId: driver.userId },
      });
      return this.views.driverRideView(tx, required(await this.rides.find(tx, ride.id), 'record'));
    });
  }

  async cancelByDriver(auth: AuthContext, rideId: string, reason: string): Promise<DriverRideView> {
    const driver = actorAs(auth, 'driver');
    return this.db.transaction(async (tx) => {
      const locked = await this.rides.lock(tx, rideId);
      if (!locked || locked.ride.assignedDriverId !== driver.userId)
        throw new AppError('RIDE_NOT_FOUND');
      const ride = await this.lifecycle.cancel(tx, locked, driver, 'driver', reason);
      return this.views.driverRideView(tx, ride);
    });
  }

  async getForDriver(auth: AuthContext, rideId: string): Promise<DriverRideView> {
    const driverId = actorAs(auth, 'driver').userId;
    const ride = await this.rides.find(this.db, rideId);
    if (!ride || ride.assignedDriverId !== driverId) throw new AppError('RIDE_NOT_FOUND');
    return this.views.driverRideView(this.db, ride);
  }

  async currentForDriver(auth: AuthContext): Promise<DriverRideView | null> {
    const driverId = actorAs(auth, 'driver').userId;
    const ride = await this.rides.findCurrentForDriver(this.db, driverId);
    return ride ? this.views.driverRideView(this.db, ride) : null;
  }

  async listForDriver(
    auth: AuthContext,
    page: { limit: number; cursor?: string | undefined },
  ): Promise<Page<DriverRideView>> {
    const driverId = actorAs(auth, 'driver').userId;
    const rows = await this.rides.listForDriver(this.db, driverId, {
      limit: page.limit + 1,
      after: decodeCursor(page.cursor),
    });
    const result = toPage(
      rows,
      page.limit,
      (r) => r,
      (r) => ({ sortKey: r.sortKey, id: r.ride.id }),
    );
    return {
      items: await Promise.all(result.items.map((r) => this.views.driverRideView(this.db, r.ride))),
      nextCursor: result.nextCursor,
    };
  }

  async getForAdmin(rideId: string): Promise<AdminRideView> {
    const ride = await this.rides.find(this.db, rideId);
    if (!ride) throw new AppError('RIDE_NOT_FOUND');
    return this.views.adminView(this.db, ride);
  }

  /** Admin may cancel any open ride, including in_progress (exceptional; reason required). */
  async cancelByAdmin(auth: AuthContext, rideId: string, reason: string): Promise<AdminRideView> {
    const admin = actorAs(auth, 'admin');
    return this.db.transaction(async (tx) => {
      const locked = await this.rides.lock(tx, rideId);
      if (!locked) throw new AppError('RIDE_NOT_FOUND');
      const ride = await this.lifecycle.cancel(tx, locked, admin, 'admin', reason);
      return this.views.adminView(tx, ride);
    });
  }
}
