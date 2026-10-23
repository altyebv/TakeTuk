import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { Database } from '../../../infrastructure/database/database';
import { AuditService } from '../../../platform/audit';
import { OutboxService } from '../../../platform/outbox';
import { PeriodicTask } from '../../../platform/workers/periodic-task';
import { systemActor } from '../../../shared/auth/auth-context';
import { offerStateMachine } from '../domain/offer';
import { DispatchCandidatesQuery } from '../infrastructure/dispatch-candidates.query';
import { OffersRepository } from '../infrastructure/offers.repository';
import { RidesRepository } from '../infrastructure/rides.repository';
import { RideLifecycleService } from './ride-lifecycle.service';

const SWEEP_BATCH = 50;

export interface DispatchRoundResult {
  readonly rideId: string;
  readonly offersCreated: number;
  readonly outcome:
    'offered' | 'no_candidates' | 'offers_open' | 'not_searching' | 'expired' | 'locked';
}

export interface SweepResult {
  readonly offersExpired: number;
  readonly offersWithdrawn: number;
  readonly ridesExpired: number;
  readonly rounds: readonly DispatchRoundResult[];
}

/**
 * Automatic dispatch in rounds (ADR-0012). Offers are invitations: nothing is confirmed here.
 * State lives in the database, so a crashed round is simply redone by the next sweep.
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly db: Database,
    private readonly rides: RidesRepository,
    private readonly offers: OffersRepository,
    private readonly candidates: DispatchCandidatesQuery,
    private readonly lifecycle: RideLifecycleService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** One dispatch round for one ride, in its own transaction. */
  async dispatchRide(
    rideId: string,
    options: { skipLocked?: boolean } = {},
  ): Promise<DispatchRoundResult> {
    const settings = this.config.dispatch;
    return this.db.transaction(async (tx) => {
      const locked = await this.rides.lock(tx, rideId, { skipLocked: options.skipLocked ?? false });
      if (!locked) return { rideId, offersCreated: 0, outcome: 'locked' as const };
      const { ride } = locked;
      if (ride.status !== 'searching')
        return { rideId, offersCreated: 0, outcome: 'not_searching' as const };
      if (await this.lifecycle.expireIfDue(tx, locked))
        return { rideId, offersCreated: 0, outcome: 'expired' as const };
      if ((await this.offers.countLiveOpenForRide(tx, ride.id)) > 0) {
        return { rideId, offersCreated: 0, outcome: 'offers_open' as const };
      }

      const candidates = await this.candidates.find(tx, ride.id, settings);
      if (candidates.length === 0) {
        await this.rides.postponeDispatch(tx, ride.id, settings.retryIntervalSeconds);
        return { rideId, offersCreated: 0, outcome: 'no_candidates' as const };
      }

      const round = ride.dispatchRound + 1;
      // Persist expiry of the candidates' stale offers so "one open offer per driver" admits new ones.
      await this.offers.expireStaleForDrivers(
        tx,
        candidates.map((c) => c.driverId),
      );
      offerStateMachine.assert('(initial)', 'pending', 'system');
      let created = 0;
      for (const candidate of candidates) {
        const offer = await this.offers.insertIfPossible(tx, {
          rideId: ride.id,
          driverId: candidate.driverId,
          vehicleId: candidate.vehicleId,
          dispatchRound: round,
          distanceToPickupMeters: candidate.distanceToPickupMeters,
          currency: ride.currency,
          minimumFareMinor: ride.minimumFareMinor,
          offeredFareMinor: ride.proposedFareMinor,
          responseTimeoutSeconds: settings.offerResponseTimeoutSeconds,
          searchExpiresAt: ride.searchExpiresAt,
        });
        if (!offer) continue; // another ride's dispatcher won this driver
        created += 1;
        await this.audit.record(tx, {
          actor: systemActor('dispatch'),
          action: 'ride_offer.created',
          entityType: 'ride_offer',
          entityId: offer.id,
          metadata: {
            rideId: ride.id,
            driverId: offer.driverId,
            round,
            distanceToPickupMeters: offer.distanceToPickupMeters,
          },
        });
        await this.outbox.enqueue(tx, {
          type: 'ride.offer_created',
          aggregateType: 'ride',
          aggregateId: ride.id,
          payload: {
            rideId: ride.id,
            offerId: offer.id,
            driverId: offer.driverId,
            expiresAt: offer.expiresAt.toISOString(),
          },
        });
      }
      if (created === 0) {
        await this.rides.postponeDispatch(tx, ride.id, settings.retryIntervalSeconds);
        return { rideId, offersCreated: 0, outcome: 'no_candidates' as const };
      }
      // Next round is considered once this round's offers have closed (or the window elapsed).
      await this.rides.recordDispatchRound(
        tx,
        ride.id,
        round,
        settings.offerResponseTimeoutSeconds,
      );
      return { rideId, offersCreated: created, outcome: 'offered' as const };
    });
  }

  /**
   * Periodic sweep. Each step is a separate short statement or transaction so the sweeper never
   * holds offer locks while acquiring ride locks (no deadlock with the ride → offer order).
   */
  async sweep(): Promise<SweepResult> {
    const expiredOfferRides = await this.offers.expireAllStale(this.db);
    const withdrawnOfferRides = await this.offers.withdrawForIneligibleDrivers(this.db);
    await this.rides.nudgeDispatch(this.db, [
      ...new Set([...expiredOfferRides, ...withdrawnOfferRides]),
    ]);

    let ridesExpired = 0;
    for (const rideId of await this.rides.findDueForExpiry(this.db, SWEEP_BATCH)) {
      try {
        const expired = await this.db.transaction(async (tx) => {
          const locked = await this.rides.lock(tx, rideId, { skipLocked: true });
          return locked ? this.lifecycle.expireIfDue(tx, locked) : false;
        });
        if (expired) ridesExpired += 1;
      } catch (error) {
        this.logger.error(`Expiring ride ${rideId} failed: ${String(error)}`);
      }
    }

    const rounds: DispatchRoundResult[] = [];
    for (const rideId of await this.rides.findDueForDispatch(this.db, SWEEP_BATCH)) {
      try {
        rounds.push(await this.dispatchRide(rideId, { skipLocked: true }));
      } catch (error) {
        this.logger.error(`Dispatch round for ride ${rideId} failed: ${String(error)}`);
      }
    }
    return {
      offersExpired: expiredOfferRides.length,
      offersWithdrawn: withdrawnOfferRides.length,
      ridesExpired,
      rounds,
    };
  }
}

@Injectable()
export class DispatchWorker extends PeriodicTask {
  protected readonly logger = new Logger(DispatchWorker.name);

  constructor(
    private readonly dispatch: DispatchService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    super('dispatch', config.workers.enabled, config.workers.dispatchTickMs);
  }

  protected async tick(): Promise<void> {
    await this.dispatch.sweep();
  }
}
