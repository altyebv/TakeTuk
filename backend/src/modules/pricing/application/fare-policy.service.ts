import { Injectable } from '@nestjs/common';
import { Database, type Queryable } from '../../../infrastructure/database/database';
import { AuditService } from '../../../platform/audit';
import { actorAs, type AuthContext } from '../../../shared/auth/auth-context';
import { AppError } from '../../../shared/errors/app-error';
import type { PolicyStatus } from '../../../shared/policy-lifecycle';
import { ServiceAreasService } from '../../geography';
import { farePolicyStateMachine, type FarePolicy } from '../domain/fare-policy';
import { FarePoliciesRepository } from '../infrastructure/fare-policies.repository';

export interface CreateFarePolicyInput {
  readonly serviceAreaCode: string;
  readonly serviceTypeCode: string;
  readonly currency: string;
  readonly baseFareMinor: number;
  readonly perKmFareMinor: number;
  readonly minimumFareMinor: number;
  readonly roundingIncrementMinor: number;
  readonly notes?: string | undefined;
}

/** Admin management of versioned fare policies (STATE_MACHINES §7). */
@Injectable()
export class FarePolicyService {
  constructor(
    private readonly db: Database,
    private readonly policies: FarePoliciesRepository,
    private readonly serviceAreas: ServiceAreasService,
    private readonly audit: AuditService,
  ) {}

  findActive(
    db: Queryable,
    serviceAreaId: string,
    serviceTypeCode: string,
  ): Promise<FarePolicy | null> {
    return this.policies.findActive(db, serviceAreaId, serviceTypeCode);
  }

  async createDraft(auth: AuthContext, input: CreateFarePolicyInput): Promise<FarePolicy> {
    const admin = actorAs(auth, 'admin');
    return this.db.transaction(async (tx) => {
      const area = await this.serviceAreas.findActiveByCode(tx, input.serviceAreaCode);
      if (!area) throw new AppError('SERVICE_AREA_NOT_FOUND');
      farePolicyStateMachine.assert('(initial)', 'draft', 'admin');
      await this.policies.lockScope(tx, area.id, input.serviceTypeCode);
      const policy = await this.policies.insertDraft(tx, {
        serviceAreaId: area.id,
        serviceTypeCode: input.serviceTypeCode,
        currency: input.currency,
        baseFareMinor: input.baseFareMinor,
        perKmFareMinor: input.perKmFareMinor,
        minimumFareMinor: input.minimumFareMinor,
        roundingIncrementMinor: input.roundingIncrementMinor,
        notes: input.notes ?? null,
        createdBy: admin.userId,
      });
      await this.audit.record(tx, {
        actor: admin,
        action: 'fare_policy.created',
        entityType: 'fare_policy',
        entityId: policy.id,
        metadata: {
          version: policy.version,
          serviceAreaCode: area.code,
          serviceTypeCode: policy.serviceTypeCode,
          currency: policy.currency,
          baseFareMinor: policy.baseFareMinor,
          perKmFareMinor: policy.perKmFareMinor,
          minimumFareMinor: policy.minimumFareMinor,
          roundingIncrementMinor: policy.roundingIncrementMinor,
        },
      });
      return policy;
    });
  }

  /** Activates a draft and retires the previous active version atomically. */
  async activate(auth: AuthContext, policyId: string): Promise<FarePolicy> {
    const admin = actorAs(auth, 'admin');
    return this.db.transaction(async (tx) => {
      const found = await this.policies.find(tx, policyId);
      if (!found) throw new AppError('POLICY_NOT_FOUND');
      await this.policies.lockScope(tx, found.serviceAreaId, found.serviceTypeCode);
      const policy = (await this.policies.lock(tx, policyId))!;
      if (policy.status === 'active') return policy;
      farePolicyStateMachine.assert(policy.status, 'active', 'admin');
      const retiredId = await this.policies.retireActive(
        tx,
        policy.serviceAreaId,
        policy.serviceTypeCode,
        admin.userId,
      );
      await this.policies.activate(tx, policy.id, admin.userId);
      await this.audit.record(tx, {
        actor: admin,
        action: 'fare_policy.activated',
        entityType: 'fare_policy',
        entityId: policy.id,
        metadata: { version: policy.version, supersededPolicyId: retiredId },
      });
      return (await this.policies.find(tx, policy.id))!;
    });
  }

  async retire(auth: AuthContext, policyId: string): Promise<FarePolicy> {
    const admin = actorAs(auth, 'admin');
    return this.db.transaction(async (tx) => {
      const policy = await this.policies.lock(tx, policyId);
      if (!policy) throw new AppError('POLICY_NOT_FOUND');
      if (policy.status === 'retired') return policy;
      farePolicyStateMachine.assert(policy.status, 'retired', 'admin');
      await this.policies.retire(tx, policy.id, admin.userId);
      await this.audit.record(tx, {
        actor: admin,
        action: 'fare_policy.retired',
        entityType: 'fare_policy',
        entityId: policy.id,
        metadata: { version: policy.version },
      });
      return (await this.policies.find(tx, policy.id))!;
    });
  }

  async list(filter: {
    serviceAreaCode?: string | undefined;
    serviceTypeCode?: string | undefined;
    status?: PolicyStatus | undefined;
  }): Promise<FarePolicy[]> {
    let serviceAreaId: string | undefined;
    if (filter.serviceAreaCode) {
      const area = await this.serviceAreas.findActiveByCode(this.db, filter.serviceAreaCode);
      if (!area) return [];
      serviceAreaId = area.id;
    }
    return this.policies.list(this.db, {
      serviceAreaId,
      serviceTypeCode: filter.serviceTypeCode,
      status: filter.status,
    });
  }
}
