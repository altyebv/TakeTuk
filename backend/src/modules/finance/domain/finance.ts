import { INITIAL, StateMachine } from '../../../shared/state-machine';
import { policyStateMachine, type PolicyStatus } from '../../../shared/policy-lifecycle';

/**
 * Commission = round_half_up(amount × rate_bp / 10 000), integer arithmetic (FIN-7).
 */
export function calculateCommission(amountMinor: number, rateBasisPoints: number): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new RangeError('amountMinor must be a non-negative safe integer');
  }
  if (!Number.isInteger(rateBasisPoints) || rateBasisPoints < 0 || rateBasisPoints > 10_000) {
    throw new RangeError('rateBasisPoints must be an integer in [0, 10000]');
  }
  const commission = (BigInt(amountMinor) * BigInt(rateBasisPoints) + 5_000n) / 10_000n;
  return Number(commission);
}

export const commissionPolicyStateMachine = policyStateMachine('commission_policy');

export interface CommissionPolicy {
  readonly id: string;
  readonly serviceAreaId: string;
  readonly serviceAreaCode: string;
  readonly serviceTypeCode: string;
  readonly version: number;
  readonly status: PolicyStatus;
  readonly rateBasisPoints: number;
  readonly notes: string | null;
  readonly createdAt: Date;
  readonly activatedAt: Date | null;
  readonly retiredAt: Date | null;
}

export const PAYMENT_STATUSES = ['awaiting_collection', 'collected', 'reported_unpaid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** docs/domain/STATE_MACHINES.md §5 (cash ride payment). */
export const paymentStateMachine = new StateMachine<PaymentStatus, 'system' | 'driver'>(
  'ride_payment',
  [
    { from: INITIAL, to: 'awaiting_collection', actors: ['system'] },
    { from: 'awaiting_collection', to: 'collected', actors: ['driver'] },
    { from: 'awaiting_collection', to: 'reported_unpaid', actors: ['driver'] },
  ],
);

export interface RidePayment {
  readonly id: string;
  readonly rideId: string;
  readonly driverId: string;
  readonly passengerId: string;
  readonly method: 'cash';
  readonly status: PaymentStatus;
  readonly currency: string;
  readonly amountDueMinor: number;
  readonly amountCollectedMinor: number | null;
  readonly reportedAt: Date | null;
  readonly createdAt: Date;
}

export type LedgerAccountType = 'driver_commission_receivable' | 'platform_commission_revenue';

export interface LedgerEntryInput {
  readonly accountType: LedgerAccountType;
  readonly driverId: string | null;
  readonly currency: string;
  /** Debit positive, credit negative. A transaction's entries must sum to zero. */
  readonly amountMinor: number;
}

/** Balanced double entry for a ride's commission (ADR-0016). */
export function rideCommissionEntries(
  driverId: string,
  currency: string,
  commissionMinor: number,
): LedgerEntryInput[] {
  return [
    {
      accountType: 'driver_commission_receivable',
      driverId,
      currency,
      amountMinor: commissionMinor,
    },
    {
      accountType: 'platform_commission_revenue',
      driverId: null,
      currency,
      amountMinor: -commissionMinor,
    },
  ];
}
