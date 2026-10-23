import { AppError } from '../../../shared/errors/app-error';
import type { MoneyInput } from '../../../shared/schemas';

/**
 * Fare negotiation rules (ADR-0011, STATE_MACHINES §2). Pure functions; the database enforces
 * the minimum-fare rules again with CHECK constraints.
 */
export interface PricingSnapshot {
  readonly minimumFareMinor: number;
  readonly currency: string;
}

export function assertProposalAcceptable(snapshot: PricingSnapshot, proposal: MoneyInput): void {
  if (proposal.currency !== snapshot.currency) {
    throw new AppError('CURRENCY_MISMATCH', `Fares for this ride are in ${snapshot.currency}.`);
  }
  if (proposal.amountMinor < snapshot.minimumFareMinor) {
    throw new AppError(
      'FARE_BELOW_MINIMUM',
      `The proposed fare ${proposal.amountMinor} is below the minimum fare ${snapshot.minimumFareMinor} ${snapshot.currency} (minor units).`,
      {
        extensions: {
          minimumFare: { amountMinor: snapshot.minimumFareMinor, currency: snapshot.currency },
        },
      },
    );
  }
}

/**
 * A counteroffer must meet the minimum and be strictly higher than the passenger's proposal
 * (PRC-3, provisional): an equal amount is an acceptance, a lower one makes no sense to offer.
 */
export function assertCounterofferAcceptable(
  snapshot: PricingSnapshot & { readonly proposedFareMinor: number },
  counter: MoneyInput,
): void {
  if (counter.currency !== snapshot.currency) {
    throw new AppError('CURRENCY_MISMATCH', `Fares for this ride are in ${snapshot.currency}.`);
  }
  if (counter.amountMinor < snapshot.minimumFareMinor) {
    throw new AppError(
      'FARE_BELOW_MINIMUM',
      `The counteroffer ${counter.amountMinor} is below the minimum fare ${snapshot.minimumFareMinor}.`,
      {
        extensions: {
          minimumFare: { amountMinor: snapshot.minimumFareMinor, currency: snapshot.currency },
        },
      },
    );
  }
  if (counter.amountMinor <= snapshot.proposedFareMinor) {
    throw new AppError(
      'COUNTEROFFER_NOT_ABOVE_PROPOSAL',
      `The counteroffer must be higher than the proposal ${snapshot.proposedFareMinor}; accept the offer instead.`,
    );
  }
}
