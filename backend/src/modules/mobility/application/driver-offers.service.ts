import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { Database, type Tx } from '../../../infrastructure/database/database';
import { AuditService } from '../../../platform/audit';
import { OutboxService } from '../../../platform/outbox';
import { actorAs, type AuthContext } from '../../../shared/auth/auth-context';
import { AppError } from '../../../shared/errors/app-error';
import type { MoneyInput } from '../../../shared/schemas';
import { DriverOperationsService } from '../../drivers';
import { assertCounterofferAcceptable } from '../../pricing';
import { offerStateMachine, type RideOffer } from '../domain/offer';
import { OffersRepository, type LockedOffer } from '../infrastructure/offers.repository';
import { RidesRepository, type LockedRide } from '../infrastructure/rides.repository';
import { AssignmentService } from './assignment.service';
import { RideViews, type DriverOfferView, type DriverRideView } from './ride-views';
import { required } from '../../../shared/required';

/** Driver responses to dispatch offers: accept, decline, counteroffer (STATE_MACHINES §2). */
@Injectable()
export class DriverOffersService {
  constructor(
    private readonly db: Database,
    private readonly rides: RidesRepository,
    private readonly offers: OffersRepository,
    private readonly assignment: AssignmentService,
    private readonly driverOps: DriverOperationsService,
    private readonly views: RideViews,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async listOpen(auth: AuthContext): Promise<DriverOfferView[]> {
    const driverId = actorAs(auth, 'driver').userId;
    const offers = await this.offers.listOpenForDriver(this.db, driverId);
    return Promise.all(offers.map((offer) => this.offerView(offer)));
  }

  /** Accepting the passenger's own proposal confirms the ride immediately (PRC-2). */
  async accept(auth: AuthContext, offerId: string): Promise<DriverRideView> {
    const driver = actorAs(auth, 'driver');
    const offer = await this.ownOffer(driver.userId, offerId);
    return this.db.transaction(async (tx) => {
      const result = await this.assignment.confirm(tx, {
        rideId: offer.rideId,
        offerId,
        expectedOfferStatus: 'pending',
        basis: 'driver_accepted_passenger_proposal',
        actor: driver,
      });
      return this.views.driverRideView(tx, result.ride);
    });
  }

  async decline(auth: AuthContext, offerId: string): Promise<DriverOfferView> {
    const driver = actorAs(auth, 'driver');
    const unlocked = await this.ownOffer(driver.userId, offerId);
    return this.db.transaction(async (tx) => {
      const { ride, offer } = await this.lockRideAndOffer(tx, unlocked.rideId, offerId);
      if (offer.offer.status === 'declined')
        return this.views.driverOfferView(tx, offer.offer, ride.ride);
      if (offer.offer.status !== 'pending') {
        throw new AppError('OFFER_NOT_OPEN', `The offer is ${offer.offer.status}.`, {
          extensions: { currentStatus: offer.offer.status },
        });
      }
      offerStateMachine.assert('pending', 'declined', 'driver');
      await this.offers.close(tx, offerId, 'declined');
      await this.rides.nudgeDispatch(tx, [ride.ride.id]);
      await this.audit.record(tx, {
        actor: driver,
        action: 'ride_offer.declined',
        entityType: 'ride_offer',
        entityId: offerId,
        metadata: { rideId: ride.ride.id },
      });
      const closed = required(await this.offers.find(tx, offerId), 'record');
      return this.views.driverOfferView(tx, closed, ride.ride);
    });
  }

  async counteroffer(
    auth: AuthContext,
    offerId: string,
    amount: MoneyInput,
  ): Promise<DriverOfferView> {
    const driver = actorAs(auth, 'driver');
    const unlocked = await this.ownOffer(driver.userId, offerId);
    return this.db.transaction(async (tx) => {
      const { ride, offer } = await this.lockRideAndOffer(tx, unlocked.rideId, offerId);
      const current = offer.offer;
      if (current.status === 'countered' && current.counterFareMinor === amount.amountMinor) {
        return this.views.driverOfferView(tx, current, ride.ride); // natural idempotency
      }
      if (current.status !== 'pending') {
        throw new AppError('OFFER_NOT_OPEN', `The offer is ${current.status}.`, {
          extensions: { currentStatus: current.status },
        });
      }
      if (offer.expired) throw new AppError('OFFER_EXPIRED');
      if (ride.ride.status !== 'searching' || ride.searchExpired)
        throw new AppError('RIDE_NO_LONGER_AVAILABLE');

      const operational = await this.driverOps.lockOperationalDriver(tx, driver.userId);
      if (!operational || operational.status !== 'approved')
        throw new AppError('DRIVER_NOT_APPROVED');
      if (
        operational.availability !== 'online' ||
        operational.activeVehicleId !== current.vehicleId
      ) {
        throw new AppError(
          'DRIVER_NOT_AVAILABLE',
          'Go online with the offered vehicle to respond.',
        );
      }

      assertCounterofferAcceptable(
        {
          minimumFareMinor: current.minimumFareMinor,
          currency: current.currency,
          proposedFareMinor: current.offeredFareMinor,
        },
        amount,
      );
      offerStateMachine.assert('pending', 'countered', 'driver');
      const countered = await this.offers.markCountered(tx, offerId, {
        counterFareMinor: amount.amountMinor,
        responseTimeoutSeconds: this.config.dispatch.counterofferResponseTimeoutSeconds,
        searchExpiresAt: ride.ride.searchExpiresAt,
      });
      await this.audit.record(tx, {
        actor: driver,
        action: 'ride_offer.countered',
        entityType: 'ride_offer',
        entityId: offerId,
        metadata: {
          rideId: ride.ride.id,
          counterFareMinor: amount.amountMinor,
          proposedFareMinor: current.offeredFareMinor,
          minimumFareMinor: current.minimumFareMinor,
          currency: current.currency,
        },
      });
      await this.outbox.enqueue(tx, {
        type: 'ride.counteroffer_received',
        aggregateType: 'ride',
        aggregateId: ride.ride.id,
        payload: {
          rideId: ride.ride.id,
          offerId,
          passengerId: ride.ride.passengerId,
          amountMinor: amount.amountMinor,
          currency: amount.currency,
        },
      });
      return this.views.driverOfferView(tx, countered, ride.ride);
    });
  }

  /** Offers addressed to someone else are reported as not found. */
  private async ownOffer(driverId: string, offerId: string): Promise<RideOffer> {
    const offer = await this.offers.find(this.db, offerId);
    if (!offer || offer.driverId !== driverId) throw new AppError('OFFER_NOT_FOUND');
    return offer;
  }

  /** Lock order: ride → offer. */
  private async lockRideAndOffer(
    tx: Tx,
    rideId: string,
    offerId: string,
  ): Promise<{ ride: LockedRide; offer: LockedOffer }> {
    const ride = await this.rides.lock(tx, rideId);
    const offer = await this.offers.lock(tx, offerId);
    if (!ride || !offer) throw new AppError('OFFER_NOT_FOUND');
    return { ride, offer };
  }

  private async offerView(offer: RideOffer): Promise<DriverOfferView> {
    const ride = required(await this.rides.find(this.db, offer.rideId), 'record');
    return this.views.driverOfferView(this.db, offer, ride);
  }
}
