import { Injectable } from '@nestjs/common';
import { Database, type Queryable, type Tx } from '../../../infrastructure/database/database';
import { AuditService } from '../../../platform/audit';
import { actorAs, type Actor, type AuthContext } from '../../../shared/auth/auth-context';
import { AppError } from '../../../shared/errors/app-error';
import { decodeCursor, toPage, type Page } from '../../../shared/pagination';
import type { MoneyInput } from '../../../shared/schemas';
import {
  calculateCommission,
  paymentStateMachine,
  rideCommissionEntries,
  type CommissionPolicy,
  type RidePayment,
} from '../domain/finance';
import { FinanceRepository, type EarningsRow } from '../infrastructure/finance.repository';

export interface RideCompletionFacts {
  readonly rideId: string;
  readonly driverId: string;
  readonly passengerId: string;
  readonly currency: string;
  readonly agreedFareMinor: number;
  readonly commissionRateBasisPoints: number;
  readonly commissionPolicyId: string;
  readonly commissionPolicyVersion: number;
  readonly actor: Actor;
}

export type CashReport =
  | { readonly outcome: 'collected'; readonly amount: MoneyInput }
  | { readonly outcome: 'not_collected' };

export interface DriverEarnings {
  readonly commissionOwed: Array<{ currency: string; amountMinor: number }>;
  readonly page: Page<EarningsRow>;
}

/** Finance module public API (ADR-0016). */
@Injectable()
export class FinanceService {
  constructor(
    private readonly db: Database,
    private readonly finance: FinanceRepository,
    private readonly audit: AuditService,
  ) {}

  getActiveCommissionPolicy(
    db: Queryable,
    serviceAreaId: string,
    serviceTypeCode: string,
  ): Promise<CommissionPolicy | null> {
    return this.finance.findActivePolicy(db, serviceAreaId, serviceTypeCode);
  }

  /**
   * Called by mobility inside the trip-completion transaction: records the cash obligation and
   * posts the commission. Idempotent through UNIQUE (ride_id) and UNIQUE (kind, ride_id).
   */
  async recordRideCompletion(tx: Tx, facts: RideCompletionFacts): Promise<RidePayment> {
    paymentStateMachine.assert('(initial)', 'awaiting_collection', 'system');
    const created = await this.finance.insertPayment(tx, {
      rideId: facts.rideId,
      driverId: facts.driverId,
      passengerId: facts.passengerId,
      currency: facts.currency,
      amountDueMinor: facts.agreedFareMinor,
    });
    if (!created) {
      return (await this.finance.findPaymentByRide(tx, facts.rideId))!;
    }

    const commissionMinor = calculateCommission(
      facts.agreedFareMinor,
      facts.commissionRateBasisPoints,
    );
    let transactionId: string | null = null;
    if (commissionMinor > 0) {
      transactionId = await this.finance.postTransaction(tx, {
        kind: 'ride_commission',
        rideId: facts.rideId,
        description: `Commission ${facts.commissionRateBasisPoints} bp on agreed fare (policy v${facts.commissionPolicyVersion})`,
        createdBy: facts.actor.type === 'user' ? facts.actor.userId : null,
        entries: rideCommissionEntries(facts.driverId, facts.currency, commissionMinor),
      });
    }
    await this.audit.record(tx, {
      actor: facts.actor,
      action: 'finance.ride_commission_charged',
      entityType: 'ride',
      entityId: facts.rideId,
      metadata: {
        paymentId: created.id,
        ledgerTransactionId: transactionId,
        agreedFareMinor: facts.agreedFareMinor,
        commissionMinor,
        currency: facts.currency,
        commissionPolicyId: facts.commissionPolicyId,
        commissionPolicyVersion: facts.commissionPolicyVersion,
        rateBasisPoints: facts.commissionRateBasisPoints,
      },
    });
    return created;
  }

  /** Driver reports cash collection for a completed ride (STATE_MACHINES §5). */
  async reportCash(auth: AuthContext, rideId: string, report: CashReport): Promise<RidePayment> {
    const actor = actorAs(auth, 'driver');
    return this.db.transaction(async (tx) => {
      const payment = await this.finance.lockPaymentByRide(tx, rideId);
      if (!payment || payment.driverId !== actor.userId) {
        throw new AppError(
          'PAYMENT_NOT_FOUND',
          'No payment record for this ride (is the ride completed?).',
        );
      }
      const target = report.outcome === 'collected' ? 'collected' : 'reported_unpaid';
      const amount = report.outcome === 'collected' ? report.amount : null;
      if (amount && amount.currency !== payment.currency) {
        throw new AppError('CURRENCY_MISMATCH', `The ride was paid in ${payment.currency}.`);
      }

      if (payment.status !== 'awaiting_collection') {
        const same =
          payment.status === target &&
          payment.amountCollectedMinor === (amount?.amountMinor ?? null);
        if (same) return payment;
        throw new AppError(
          'PAYMENT_ALREADY_REPORTED',
          `The payment was already reported as ${payment.status}.`,
          {
            extensions: { currentStatus: payment.status },
          },
        );
      }

      paymentStateMachine.assert(payment.status, target, 'driver');
      const updated = await this.finance.reportPayment(
        tx,
        payment.id,
        target,
        amount?.amountMinor ?? null,
      );
      await this.audit.record(tx, {
        actor,
        action:
          target === 'collected'
            ? 'finance.cash_collection_reported'
            : 'finance.cash_non_payment_reported',
        entityType: 'ride',
        entityId: rideId,
        metadata: {
          paymentId: payment.id,
          amountDueMinor: payment.amountDueMinor,
          amountCollectedMinor: amount?.amountMinor ?? null,
          currency: payment.currency,
        },
      });
      return updated;
    });
  }

  async driverEarnings(
    auth: AuthContext,
    page: { limit: number; cursor?: string | undefined },
  ): Promise<DriverEarnings> {
    const driverId = actorAs(auth, 'driver').userId;
    const after = decodeCursor(page.cursor);
    const [balances, rows] = await Promise.all([
      this.finance.driverReceivableBalances(this.db, driverId),
      this.finance.listDriverEarnings(this.db, driverId, { limit: page.limit + 1, after }),
    ]);
    return {
      commissionOwed: balances,
      page: toPage(
        rows,
        page.limit,
        (r) => r,
        (r) => ({ sortKey: r.sortKey, id: r.payment.id }),
      ),
    };
  }

  findPaymentForRide(db: Queryable, rideId: string): Promise<RidePayment | null> {
    return this.finance.findPaymentByRide(db, rideId);
  }
}
