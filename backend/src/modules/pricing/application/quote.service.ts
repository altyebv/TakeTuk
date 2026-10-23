import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { Database, type Tx } from '../../../infrastructure/database/database';
import { PeriodicTask } from '../../../platform/workers/periodic-task';
import { actorAs, type AuthContext } from '../../../shared/auth/auth-context';
import { AppError } from '../../../shared/errors/app-error';
import type { Coordinates } from '../../../shared/schemas';
import { FinanceService } from '../../finance';
import {
  isSamePlace,
  ROUTING_PROVIDER,
  ServiceAreasService,
  type RoutingProvider,
} from '../../geography';
import { travelModeFor, type FareQuote } from '../domain/fare-policy';
import { calculateMinimumFare } from '../domain/minimum-fare';
import { FarePoliciesRepository } from '../infrastructure/fare-policies.repository';
import { FareQuotesRepository } from '../infrastructure/fare-quotes.repository';

export interface QuoteRequest {
  readonly serviceTypeCode: string;
  readonly pickup: Coordinates;
  readonly pickupLabel?: string | undefined;
  readonly destination: Coordinates;
  readonly destinationLabel?: string | undefined;
}

const RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * Fare quotes (ADR-0011). A quote fixes the server-computed inputs — route distance with
 * provenance, fare-policy version, minimum fare — for a short period. Rides are created only
 * from quotes, so clients never supply distances or minimum fares.
 */
@Injectable()
export class QuoteService {
  constructor(
    private readonly db: Database,
    private readonly quotes: FareQuotesRepository,
    private readonly policies: FarePoliciesRepository,
    private readonly serviceAreas: ServiceAreasService,
    private readonly finance: FinanceService,
    @Inject(ROUTING_PROVIDER) private readonly routing: RoutingProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async createQuote(auth: AuthContext, request: QuoteRequest): Promise<FareQuote> {
    const passengerId = actorAs(auth, 'passenger').userId;
    if (isSamePlace(request.pickup, request.destination)) {
      throw new AppError('PICKUP_EQUALS_DESTINATION');
    }

    // Approximate per-user limit protecting routing-provider spend (API_CONVENTIONS §11).
    const recent = await this.quotes.countRecent(this.db, passengerId, RATE_LIMIT_WINDOW_SECONDS);
    if (recent >= this.config.pricing.quoteRateLimitPerMinute) {
      throw new AppError('RATE_LIMITED', 'Too many quotes; try again shortly.', {
        retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS,
      });
    }

    const area = await this.serviceAreas.resolveTripArea(
      this.db,
      request.pickup,
      request.destination,
      request.serviceTypeCode,
    );
    const policy = await this.policies.findActive(this.db, area.id, request.serviceTypeCode);
    const commission = await this.finance.getActiveCommissionPolicy(
      this.db,
      area.id,
      request.serviceTypeCode,
    );
    if (!policy || !commission) {
      throw new AppError(
        'PRICING_NOT_CONFIGURED',
        `No active ${!policy ? 'fare' : 'commission'} policy for ${request.serviceTypeCode} in ${area.code}.`,
      );
    }

    // External call: outside any transaction. Failure means no quote — never a fallback fare.
    const route = await this.routing.estimateRoute({
      origin: request.pickup,
      destination: request.destination,
      travelMode: travelModeFor(request.serviceTypeCode),
    });
    const minimumFareMinor = calculateMinimumFare(policy, route.distanceMeters);

    return this.quotes.insert(this.db, {
      passengerId,
      serviceAreaId: area.id,
      serviceTypeCode: request.serviceTypeCode,
      pickup: request.pickup,
      pickupLabel: request.pickupLabel ?? null,
      destination: request.destination,
      destinationLabel: request.destinationLabel ?? null,
      routeDistanceMeters: route.distanceMeters,
      routeDurationSeconds: route.durationSeconds,
      routeProvider: route.provider,
      routeEstimatedAt: route.estimatedAt,
      farePolicyId: policy.id,
      farePolicyVersion: policy.version,
      currency: policy.currency,
      minimumFareMinor,
      ttlSeconds: this.config.pricing.quoteTtlSeconds,
    });
  }

  /**
   * Consumes a quote inside the ride-creation transaction. Ownership, single use and expiry
   * (database clock) are checked under a row lock.
   */
  async consumeQuote(tx: Tx, quoteId: string, passengerId: string): Promise<FareQuote> {
    const locked = await this.quotes.lockWithExpiry(tx, quoteId);
    if (!locked || locked.quote.passengerId !== passengerId) {
      throw new AppError('QUOTE_NOT_FOUND');
    }
    if (locked.quote.consumedAt) {
      throw new AppError('QUOTE_ALREADY_USED', 'This quote has already been used for a ride.');
    }
    if (locked.expired) {
      throw new AppError('QUOTE_EXPIRED', 'The quote has expired; request a new quote.');
    }
    await this.quotes.markConsumed(tx, quoteId);
    return locked.quote;
  }
}

/** Deletes unused quotes a day after expiry. */
@Injectable()
export class QuoteCleanupWorker extends PeriodicTask {
  protected readonly logger = new Logger(QuoteCleanupWorker.name);

  constructor(
    private readonly db: Database,
    private readonly quotes: FareQuotesRepository,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    super('quote-cleanup', config.workers.enabled, config.workers.maintenanceTickMs);
  }

  protected async tick(): Promise<void> {
    await this.quotes.deleteStaleUnconsumed(this.db, 24);
  }
}
