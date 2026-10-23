import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { Database } from '../../../infrastructure/database/database';
import { AuditService } from '../../../platform/audit';
import { IdempotencyService, type IdempotentResponse } from '../../../platform/idempotency';
import { OutboxService } from '../../../platform/outbox';
import { actorAs, type AuthContext } from '../../../shared/auth/auth-context';
import { AppError } from '../../../shared/errors/app-error';
import { decodeCursor, toPage, type Page } from '../../../shared/pagination';
import type { MoneyInput } from '../../../shared/schemas';
import { assertProposalAcceptable, QuoteService } from '../../pricing';
import { offerStateMachine } from '../domain/offer';
import { rideStateMachine } from '../domain/ride';
import { OffersRepository } from '../infrastructure/offers.repository';
import { RidesRepository } from '../infrastructure/rides.repository';
import { AssignmentService } from './assignment.service';
import { DispatchService } from './dispatch.service';
import { RideLifecycleService } from './ride-lifecycle.service';
import { RideViews, type PassengerRideView } from './ride-views';

export interface CreateRideInput {
  readonly quoteId: string;
  readonly proposedFare: MoneyInput;
}

/** Passenger use cases (STATE_MACHINES §1, §2). */
@Injectable()
export class RideRequestService {
  private readonly logger = new Logger(RideRequestService.name);

  constructor(
    private readonly db: Database,
    private readonly rides: RidesRepository,
    private readonly offers: OffersRepository,
    private readonly quotes: QuoteService,
    private readonly assignment: AssignmentService,
    private readonly lifecycle: RideLifecycleService,
    private readonly dispatch: DispatchService,
    private readonly views: RideViews,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Creates a ride from a quote. Idempotent per Idempotency-Key: the key, the ride and the
   * consumed quote commit together. The first dispatch round runs after commit and its failure
   * cannot undo the ride (the dispatch worker retries).
   */
  async createRide(
    auth: AuthContext,
    input: CreateRideInput,
    idempotencyKey: string,
  ): Promise<IdempotentResponse<PassengerRideView>> {
    const passenger = actorAs(auth, 'passenger');
    let createdRideId: string | undefined;
    const response = await this.db.transaction((tx) =>
      this.idempotency.execute<PassengerRideView>(
        tx,
        {
          userId: passenger.userId,
          operation: 'rides.create',
          key: idempotencyKey,
          request: input,
        },
        async () => {
          const quote = await this.quotes.consumeQuote(tx, input.quoteId, passenger.userId);
          assertProposalAcceptable(
            { minimumFareMinor: quote.minimumFareMinor, currency: quote.currency },
            input.proposedFare,
          );
          rideStateMachine.assert('(initial)', 'searching', 'passenger');
          const ride = await this.rides.insertFromQuote(tx, quote, {
            proposedFareMinor: input.proposedFare.amountMinor,
            searchTimeoutSeconds: this.config.dispatch.rideSearchTimeoutSeconds,
          });
          await this.audit.record(tx, {
            actor: passenger,
            action: 'ride.requested',
            entityType: 'ride',
            entityId: ride.id,
            metadata: {
              quoteId: quote.id,
              proposedFareMinor: ride.proposedFareMinor,
              minimumFareMinor: ride.minimumFareMinor,
              currency: ride.currency,
              farePolicyVersion: ride.farePolicyVersion,
              routeDistanceMeters: ride.routeDistanceMeters,
              routeProvider: ride.routeProvider,
            },
          });
          await this.outbox.enqueue(tx, {
            type: 'ride.requested',
            aggregateType: 'ride',
            aggregateId: ride.id,
            payload: { rideId: ride.id, passengerId: passenger.userId },
          });
          createdRideId = ride.id;
          return { status: 201, body: await this.views.passengerView(tx, ride) };
        },
      ),
    );

    if (!response.replayed && createdRideId) {
      try {
        await this.dispatch.dispatchRide(createdRideId);
      } catch (error) {
        this.logger.warn(
          `Immediate dispatch failed for ride ${createdRideId}; the worker will retry: ${String(error)}`,
        );
      }
    }
    return response;
  }

  async getRide(auth: AuthContext, rideId: string): Promise<PassengerRideView> {
    const passengerId = actorAs(auth, 'passenger').userId;
    const ride = await this.rides.find(this.db, rideId);
    if (!ride || ride.passengerId !== passengerId) throw new AppError('RIDE_NOT_FOUND');
    return this.views.passengerView(this.db, ride);
  }

  async listRides(
    auth: AuthContext,
    page: { limit: number; cursor?: string | undefined },
  ): Promise<Page<PassengerRideView>> {
    const passengerId = actorAs(auth, 'passenger').userId;
    const rows = await this.rides.listForPassenger(this.db, passengerId, {
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
      items: await Promise.all(result.items.map((r) => this.views.passengerView(this.db, r.ride))),
      nextCursor: result.nextCursor,
    };
  }

  async cancel(
    auth: AuthContext,
    rideId: string,
    reason: string | null,
  ): Promise<PassengerRideView> {
    const passenger = actorAs(auth, 'passenger');
    return this.db.transaction(async (tx) => {
      const locked = await this.rides.lock(tx, rideId);
      if (!locked || locked.ride.passengerId !== passenger.userId)
        throw new AppError('RIDE_NOT_FOUND');
      const ride = await this.lifecycle.cancel(tx, locked, passenger, 'passenger', reason);
      return this.views.passengerView(tx, ride);
    });
  }

  async acceptCounteroffer(
    auth: AuthContext,
    rideId: string,
    offerId: string,
  ): Promise<PassengerRideView> {
    const passenger = actorAs(auth, 'passenger');
    return this.db.transaction(async (tx) => {
      const ride = await this.rides.find(tx, rideId);
      if (!ride || ride.passengerId !== passenger.userId) throw new AppError('RIDE_NOT_FOUND');
      const result = await this.assignment.confirm(tx, {
        rideId,
        offerId,
        expectedOfferStatus: 'countered',
        basis: 'passenger_accepted_driver_counteroffer',
        actor: passenger,
      });
      return this.views.passengerView(tx, result.ride);
    });
  }

  async rejectCounteroffer(
    auth: AuthContext,
    rideId: string,
    offerId: string,
  ): Promise<PassengerRideView> {
    const passenger = actorAs(auth, 'passenger');
    return this.db.transaction(async (tx) => {
      const locked = await this.rides.lock(tx, rideId);
      if (!locked || locked.ride.passengerId !== passenger.userId)
        throw new AppError('RIDE_NOT_FOUND');
      const lockedOffer = await this.offers.lock(tx, offerId);
      if (!lockedOffer || lockedOffer.offer.rideId !== rideId)
        throw new AppError('OFFER_NOT_FOUND');
      const { offer } = lockedOffer;
      if (offer.status === 'counter_rejected') return this.views.passengerView(tx, locked.ride);
      if (offer.status !== 'countered') {
        throw new AppError('OFFER_NOT_OPEN', `The offer is ${offer.status}.`, {
          extensions: { currentStatus: offer.status },
        });
      }
      offerStateMachine.assert(offer.status, 'counter_rejected', 'passenger');
      await this.offers.close(tx, offer.id, 'counter_rejected');
      await this.rides.nudgeDispatch(tx, [rideId]);
      await this.audit.record(tx, {
        actor: passenger,
        action: 'ride_offer.counter_rejected',
        entityType: 'ride_offer',
        entityId: offer.id,
        metadata: { rideId },
      });
      await this.outbox.enqueue(tx, {
        type: 'ride.counteroffer_rejected',
        aggregateType: 'ride',
        aggregateId: rideId,
        payload: { rideId, offerId: offer.id, driverId: offer.driverId },
      });
      return this.views.passengerView(tx, locked.ride);
    });
  }
}
