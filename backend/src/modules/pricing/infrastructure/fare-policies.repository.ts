import { Injectable } from '@nestjs/common';
import type { Queryable, Tx } from '../../../infrastructure/database/database';
import type { PolicyStatus } from '../../../shared/policy-lifecycle';
import { policyScopeLockKey } from '../../../shared/policy-lifecycle';
import type { FarePolicy } from '../domain/fare-policy';

interface FarePolicyRow {
  id: string;
  service_area_id: string;
  service_area_code: string;
  service_type_code: string;
  version: number;
  status: PolicyStatus;
  currency: string;
  base_fare_minor: number;
  per_km_fare_minor: number;
  minimum_fare_minor: number;
  rounding_increment_minor: number;
  notes: string | null;
  created_at: Date;
  activated_at: Date | null;
  retired_at: Date | null;
}

const SELECT = `
  select p.id, p.service_area_id, a.code as service_area_code, p.service_type_code, p.version, p.status,
         p.currency, p.base_fare_minor, p.per_km_fare_minor, p.minimum_fare_minor, p.rounding_increment_minor,
         p.notes, p.created_at, p.activated_at, p.retired_at
    from taketuk.fare_policies p
    join taketuk.service_areas a on a.id = p.service_area_id`;

const toPolicy = (r: FarePolicyRow): FarePolicy => ({
  id: r.id,
  serviceAreaId: r.service_area_id,
  serviceAreaCode: r.service_area_code,
  serviceTypeCode: r.service_type_code,
  version: r.version,
  status: r.status,
  currency: r.currency,
  baseFareMinor: r.base_fare_minor,
  perKmFareMinor: r.per_km_fare_minor,
  minimumFareMinor: r.minimum_fare_minor,
  roundingIncrementMinor: r.rounding_increment_minor,
  notes: r.notes,
  createdAt: r.created_at,
  activatedAt: r.activated_at,
  retiredAt: r.retired_at,
});

export interface NewFarePolicy {
  readonly serviceAreaId: string;
  readonly serviceTypeCode: string;
  readonly currency: string;
  readonly baseFareMinor: number;
  readonly perKmFareMinor: number;
  readonly minimumFareMinor: number;
  readonly roundingIncrementMinor: number;
  readonly notes: string | null;
  readonly createdBy: string;
}

@Injectable()
export class FarePoliciesRepository {
  /** Serialises version allocation and activation per (area, service) scope. */
  async lockScope(tx: Tx, serviceAreaId: string, serviceTypeCode: string): Promise<void> {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [
      policyScopeLockKey('fare_policy', serviceAreaId, serviceTypeCode),
    ]);
  }

  async insertDraft(tx: Tx, input: NewFarePolicy): Promise<FarePolicy> {
    const { rows } = await tx.query<{ id: string }>(
      `insert into taketuk.fare_policies
         (service_area_id, service_type_code, version, status, currency, base_fare_minor, per_km_fare_minor,
          minimum_fare_minor, rounding_increment_minor, notes, created_by)
       values ($1, $2,
               (select coalesce(max(version), 0) + 1 from taketuk.fare_policies
                 where service_area_id = $1 and service_type_code = $2),
               'draft', $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [
        input.serviceAreaId,
        input.serviceTypeCode,
        input.currency,
        input.baseFareMinor,
        input.perKmFareMinor,
        input.minimumFareMinor,
        input.roundingIncrementMinor,
        input.notes,
        input.createdBy,
      ],
    );
    return (await this.find(tx, rows[0]!.id))!;
  }

  async find(db: Queryable, id: string): Promise<FarePolicy | null> {
    const { rows } = await db.query<FarePolicyRow>(`${SELECT} where p.id = $1`, [id]);
    return rows[0] ? toPolicy(rows[0]) : null;
  }

  async lock(tx: Tx, id: string): Promise<FarePolicy | null> {
    const { rows } = await tx.query<FarePolicyRow>(`${SELECT} where p.id = $1 for update of p`, [
      id,
    ]);
    return rows[0] ? toPolicy(rows[0]) : null;
  }

  async findActive(
    db: Queryable,
    serviceAreaId: string,
    serviceTypeCode: string,
  ): Promise<FarePolicy | null> {
    const { rows } = await db.query<FarePolicyRow>(
      `${SELECT} where p.service_area_id = $1 and p.service_type_code = $2 and p.status = 'active'`,
      [serviceAreaId, serviceTypeCode],
    );
    return rows[0] ? toPolicy(rows[0]) : null;
  }

  async retireActive(
    tx: Tx,
    serviceAreaId: string,
    serviceTypeCode: string,
    actorId: string,
  ): Promise<string | null> {
    const { rows } = await tx.query<{ id: string }>(
      `update taketuk.fare_policies set status = 'retired', retired_at = now(), retired_by = $3
        where service_area_id = $1 and service_type_code = $2 and status = 'active'
        returning id`,
      [serviceAreaId, serviceTypeCode, actorId],
    );
    return rows[0]?.id ?? null;
  }

  async activate(tx: Tx, id: string, actorId: string): Promise<void> {
    await tx.query(
      `update taketuk.fare_policies set status = 'active', activated_at = now(), activated_by = $2 where id = $1`,
      [id, actorId],
    );
  }

  async retire(tx: Tx, id: string, actorId: string): Promise<void> {
    await tx.query(
      `update taketuk.fare_policies set status = 'retired', retired_at = now(), retired_by = $2 where id = $1`,
      [id, actorId],
    );
  }

  async list(
    db: Queryable,
    filter: {
      serviceAreaId?: string | undefined;
      serviceTypeCode?: string | undefined;
      status?: PolicyStatus | undefined;
    },
  ): Promise<FarePolicy[]> {
    const { rows } = await db.query<FarePolicyRow>(
      `${SELECT}
        where ($1::uuid is null or p.service_area_id = $1)
          and ($2::text is null or p.service_type_code = $2)
          and ($3::text is null or p.status = $3)
        order by a.code, p.service_type_code, p.version desc
        limit 200`,
      [filter.serviceAreaId ?? null, filter.serviceTypeCode ?? null, filter.status ?? null],
    );
    return rows.map(toPolicy);
  }
}
