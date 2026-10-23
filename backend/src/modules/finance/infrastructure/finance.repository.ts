import { Injectable } from '@nestjs/common';
import type { Queryable, Tx } from '../../../infrastructure/database/database';
import { policyScopeLockKey, type PolicyStatus } from '../../../shared/policy-lifecycle';
import type {
  CommissionPolicy,
  LedgerEntryInput,
  PaymentStatus,
  RidePayment,
} from '../domain/finance';

interface CommissionPolicyRow {
  id: string;
  service_area_id: string;
  service_area_code: string;
  service_type_code: string;
  version: number;
  status: PolicyStatus;
  rate_basis_points: number;
  notes: string | null;
  created_at: Date;
  activated_at: Date | null;
  retired_at: Date | null;
}

const POLICY_SELECT = `
  select p.id, p.service_area_id, a.code as service_area_code, p.service_type_code, p.version, p.status,
         p.rate_basis_points, p.notes, p.created_at, p.activated_at, p.retired_at
    from taketuk.commission_policies p
    join taketuk.service_areas a on a.id = p.service_area_id`;

const toPolicy = (r: CommissionPolicyRow): CommissionPolicy => ({
  id: r.id,
  serviceAreaId: r.service_area_id,
  serviceAreaCode: r.service_area_code,
  serviceTypeCode: r.service_type_code,
  version: r.version,
  status: r.status,
  rateBasisPoints: r.rate_basis_points,
  notes: r.notes,
  createdAt: r.created_at,
  activatedAt: r.activated_at,
  retiredAt: r.retired_at,
});

interface PaymentRow {
  id: string;
  ride_id: string;
  driver_id: string;
  passenger_id: string;
  method: 'cash';
  status: PaymentStatus;
  currency: string;
  amount_due_minor: number;
  amount_collected_minor: number | null;
  reported_at: Date | null;
  created_at: Date;
}

const PAYMENT_COLUMNS = `id, ride_id, driver_id, passenger_id, method, status, currency, amount_due_minor,
  amount_collected_minor, reported_at, created_at`;

const toPayment = (r: PaymentRow): RidePayment => ({
  id: r.id,
  rideId: r.ride_id,
  driverId: r.driver_id,
  passengerId: r.passenger_id,
  method: r.method,
  status: r.status,
  currency: r.currency,
  amountDueMinor: r.amount_due_minor,
  amountCollectedMinor: r.amount_collected_minor,
  reportedAt: r.reported_at,
  createdAt: r.created_at,
});

export interface EarningsRow {
  readonly payment: RidePayment;
  readonly commissionMinor: number;
  readonly sortKey: string;
}

@Injectable()
export class FinanceRepository {
  // ------------------------------------------------------------- commission policies

  async lockPolicyScope(tx: Tx, serviceAreaId: string, serviceTypeCode: string): Promise<void> {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [
      policyScopeLockKey('commission_policy', serviceAreaId, serviceTypeCode),
    ]);
  }

  async insertDraftPolicy(
    tx: Tx,
    input: {
      serviceAreaId: string;
      serviceTypeCode: string;
      rateBasisPoints: number;
      notes: string | null;
      createdBy: string;
    },
  ): Promise<CommissionPolicy> {
    const { rows } = await tx.query<{ id: string }>(
      `insert into taketuk.commission_policies
         (service_area_id, service_type_code, version, status, rate_basis_points, notes, created_by)
       values ($1, $2,
               (select coalesce(max(version), 0) + 1 from taketuk.commission_policies
                 where service_area_id = $1 and service_type_code = $2),
               'draft', $3, $4, $5)
       returning id`,
      [
        input.serviceAreaId,
        input.serviceTypeCode,
        input.rateBasisPoints,
        input.notes,
        input.createdBy,
      ],
    );
    return (await this.findPolicy(tx, rows[0]!.id))!;
  }

  async findPolicy(db: Queryable, id: string): Promise<CommissionPolicy | null> {
    const { rows } = await db.query<CommissionPolicyRow>(`${POLICY_SELECT} where p.id = $1`, [id]);
    return rows[0] ? toPolicy(rows[0]) : null;
  }

  async lockPolicy(tx: Tx, id: string): Promise<CommissionPolicy | null> {
    const { rows } = await tx.query<CommissionPolicyRow>(
      `${POLICY_SELECT} where p.id = $1 for update of p`,
      [id],
    );
    return rows[0] ? toPolicy(rows[0]) : null;
  }

  async findActivePolicy(
    db: Queryable,
    serviceAreaId: string,
    serviceTypeCode: string,
  ): Promise<CommissionPolicy | null> {
    const { rows } = await db.query<CommissionPolicyRow>(
      `${POLICY_SELECT} where p.service_area_id = $1 and p.service_type_code = $2 and p.status = 'active'`,
      [serviceAreaId, serviceTypeCode],
    );
    return rows[0] ? toPolicy(rows[0]) : null;
  }

  async retireActivePolicy(
    tx: Tx,
    serviceAreaId: string,
    serviceTypeCode: string,
    actorId: string,
  ): Promise<string | null> {
    const { rows } = await tx.query<{ id: string }>(
      `update taketuk.commission_policies set status = 'retired', retired_at = now(), retired_by = $3
        where service_area_id = $1 and service_type_code = $2 and status = 'active'
        returning id`,
      [serviceAreaId, serviceTypeCode, actorId],
    );
    return rows[0]?.id ?? null;
  }

  async setPolicyStatus(
    tx: Tx,
    id: string,
    status: 'active' | 'retired',
    actorId: string,
  ): Promise<void> {
    await tx.query(
      status === 'active'
        ? `update taketuk.commission_policies set status = 'active', activated_at = now(), activated_by = $2 where id = $1`
        : `update taketuk.commission_policies set status = 'retired', retired_at = now(), retired_by = $2 where id = $1`,
      [id, actorId],
    );
  }

  async listPolicies(
    db: Queryable,
    filter: {
      serviceAreaId?: string | undefined;
      serviceTypeCode?: string | undefined;
      status?: PolicyStatus | undefined;
    },
  ): Promise<CommissionPolicy[]> {
    const { rows } = await db.query<CommissionPolicyRow>(
      `${POLICY_SELECT}
        where ($1::uuid is null or p.service_area_id = $1)
          and ($2::text is null or p.service_type_code = $2)
          and ($3::text is null or p.status = $3)
        order by a.code, p.service_type_code, p.version desc
        limit 200`,
      [filter.serviceAreaId ?? null, filter.serviceTypeCode ?? null, filter.status ?? null],
    );
    return rows.map(toPolicy);
  }

  // --------------------------------------------------------------------- payments

  /** Returns the created payment, or null when one already exists for the ride. */
  async insertPayment(
    tx: Tx,
    input: {
      rideId: string;
      driverId: string;
      passengerId: string;
      currency: string;
      amountDueMinor: number;
    },
  ): Promise<RidePayment | null> {
    const { rows } = await tx.query<PaymentRow>(
      `insert into taketuk.ride_payments (ride_id, driver_id, passenger_id, method, status, currency, amount_due_minor)
       values ($1, $2, $3, 'cash', 'awaiting_collection', $4, $5)
       on conflict (ride_id) do nothing
       returning ${PAYMENT_COLUMNS}`,
      [input.rideId, input.driverId, input.passengerId, input.currency, input.amountDueMinor],
    );
    return rows[0] ? toPayment(rows[0]) : null;
  }

  async findPaymentByRide(db: Queryable, rideId: string): Promise<RidePayment | null> {
    const { rows } = await db.query<PaymentRow>(
      `select ${PAYMENT_COLUMNS} from taketuk.ride_payments where ride_id = $1`,
      [rideId],
    );
    return rows[0] ? toPayment(rows[0]) : null;
  }

  async lockPaymentByRide(tx: Tx, rideId: string): Promise<RidePayment | null> {
    const { rows } = await tx.query<PaymentRow>(
      `select ${PAYMENT_COLUMNS} from taketuk.ride_payments where ride_id = $1 for update`,
      [rideId],
    );
    return rows[0] ? toPayment(rows[0]) : null;
  }

  async reportPayment(
    tx: Tx,
    paymentId: string,
    status: 'collected' | 'reported_unpaid',
    amountCollectedMinor: number | null,
  ): Promise<RidePayment> {
    const { rows } = await tx.query<PaymentRow>(
      `update taketuk.ride_payments
          set status = $2, amount_collected_minor = $3, reported_at = now()
        where id = $1
        returning ${PAYMENT_COLUMNS}`,
      [paymentId, status, amountCollectedMinor],
    );
    return toPayment(rows[0]!);
  }

  // ----------------------------------------------------------------------- ledger

  /**
   * Posts a balanced ledger transaction. Returns false (and posts nothing) when a transaction of
   * this kind already exists for the ride — the UNIQUE (kind, ride_id) constraint makes postings
   * idempotent.
   */
  async postTransaction(
    tx: Tx,
    input: {
      kind: 'ride_commission';
      rideId: string;
      description: string;
      createdBy: string | null;
      entries: readonly LedgerEntryInput[];
    },
  ): Promise<string | null> {
    const { rows } = await tx.query<{ id: string }>(
      `insert into taketuk.ledger_transactions (kind, ride_id, description, created_by_user_id)
       values ($1, $2, $3, $4)
       on conflict (kind, ride_id) do nothing
       returning id`,
      [input.kind, input.rideId, input.description, input.createdBy],
    );
    const transactionId = rows[0]?.id;
    if (!transactionId) return null;
    for (const entry of input.entries) {
      await tx.query(
        `insert into taketuk.ledger_entries (transaction_id, account_type, driver_id, currency, amount_minor)
         values ($1, $2, $3, $4, $5)`,
        [transactionId, entry.accountType, entry.driverId, entry.currency, entry.amountMinor],
      );
    }
    return transactionId;
  }

  async driverReceivableBalances(
    db: Queryable,
    driverId: string,
  ): Promise<Array<{ currency: string; amountMinor: number }>> {
    const { rows } = await db.query<{ currency: string; amount_minor: number }>(
      `select currency, sum(amount_minor)::bigint as amount_minor
         from taketuk.ledger_entries
        where driver_id = $1 and account_type = 'driver_commission_receivable'
        group by currency
        order by currency`,
      [driverId],
    );
    return rows.map((r) => ({ currency: r.currency, amountMinor: r.amount_minor }));
  }

  async listDriverEarnings(
    db: Queryable,
    driverId: string,
    page: { limit: number; after?: { sortKey: string; id: string } | undefined },
  ): Promise<EarningsRow[]> {
    const { rows } = await db.query<
      PaymentRow & { commission_minor: number | null; created_at_key: string }
    >(
      `select p.id, p.ride_id, p.driver_id, p.passenger_id, p.method, p.status, p.currency, p.amount_due_minor,
              p.amount_collected_minor, p.reported_at, p.created_at, p.created_at::text as created_at_key,
              (select sum(e.amount_minor)::bigint
                 from taketuk.ledger_transactions t
                 join taketuk.ledger_entries e on e.transaction_id = t.id
                where t.kind = 'ride_commission' and t.ride_id = p.ride_id
                  and e.account_type = 'driver_commission_receivable') as commission_minor
         from taketuk.ride_payments p
        where p.driver_id = $1
          and ($2::timestamptz is null or (p.created_at, p.id) < ($2::timestamptz, $3::uuid))
        order by p.created_at desc, p.id desc
        limit $4`,
      [driverId, page.after?.sortKey ?? null, page.after?.id ?? null, page.limit],
    );
    return rows.map((r) => ({
      payment: toPayment(r),
      commissionMinor: r.commission_minor ?? 0,
      sortKey: r.created_at_key,
    }));
  }
}
