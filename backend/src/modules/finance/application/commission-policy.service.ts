import { Injectable } from '@nestjs/common';
import { Database } from '../../../infrastructure/database/database';
import { AuditService } from '../../../platform/audit';
import { actorAs, type AuthContext } from '../../../shared/auth/auth-context';
import { AppError } from '../../../shared/errors/app-error';
import type { PolicyStatus } from '../../../shared/policy-lifecycle';
import { ServiceAreasService } from '../../geography';
import { commissionPolicyStateMachine, type CommissionPolicy } from '../domain/finance';
import { FinanceRepository } from '../infrastructure/finance.repository';
import { required } from '../../../shared/required';

/** Admin management of versioned commission policies (STATE_MACHINES §7). */
@Injectable()
export class CommissionPolicyService {
  constructor(
    private readonly db: Database,
    private readonly finance: FinanceRepository,
    private readonly serviceAreas: ServiceAreasService,
    private readonly audit: AuditService,
  ) {}

  async createDraft(
    auth: AuthContext,
    input: {
      serviceAreaCode: string;
      serviceTypeCode: string;
      rateBasisPoints: number;
      notes?: string | undefined;
    },
  ): Promise<CommissionPolicy> {
    const admin = actorAs(auth, 'admin');
    return this.db.transaction(async (tx) => {
      const area = await this.serviceAreas.findActiveByCode(tx, input.serviceAreaCode);
      if (!area) throw new AppError('SERVICE_AREA_NOT_FOUND');
      commissionPolicyStateMachine.assert('(initial)', 'draft', 'admin');
      await this.finance.lockPolicyScope(tx, area.id, input.serviceTypeCode);
      const policy = await this.finance.insertDraftPolicy(tx, {
        serviceAreaId: area.id,
        serviceTypeCode: input.serviceTypeCode,
        rateBasisPoints: input.rateBasisPoints,
        notes: input.notes ?? null,
        createdBy: admin.userId,
      });
      await this.audit.record(tx, {
        actor: admin,
        action: 'commission_policy.created',
        entityType: 'commission_policy',
        entityId: policy.id,
        metadata: {
          version: policy.version,
          rateBasisPoints: policy.rateBasisPoints,
          serviceAreaCode: area.code,
        },
      });
      return policy;
    });
  }

  async activate(auth: AuthContext, policyId: string): Promise<CommissionPolicy> {
    const admin = actorAs(auth, 'admin');
    return this.db.transaction(async (tx) => {
      const found = await this.finance.findPolicy(tx, policyId);
      if (!found) throw new AppError('POLICY_NOT_FOUND');
      await this.finance.lockPolicyScope(tx, found.serviceAreaId, found.serviceTypeCode);
      const policy = required(await this.finance.lockPolicy(tx, policyId), 'record');
      if (policy.status === 'active') return policy;
      commissionPolicyStateMachine.assert(policy.status, 'active', 'admin');
      const retiredId = await this.finance.retireActivePolicy(
        tx,
        policy.serviceAreaId,
        policy.serviceTypeCode,
        admin.userId,
      );
      await this.finance.setPolicyStatus(tx, policy.id, 'active', admin.userId);
      await this.audit.record(tx, {
        actor: admin,
        action: 'commission_policy.activated',
        entityType: 'commission_policy',
        entityId: policy.id,
        metadata: { version: policy.version, supersededPolicyId: retiredId },
      });
      return required(await this.finance.findPolicy(tx, policy.id), 'record');
    });
  }

  async retire(auth: AuthContext, policyId: string): Promise<CommissionPolicy> {
    const admin = actorAs(auth, 'admin');
    return this.db.transaction(async (tx) => {
      const policy = await this.finance.lockPolicy(tx, policyId);
      if (!policy) throw new AppError('POLICY_NOT_FOUND');
      if (policy.status === 'retired') return policy;
      commissionPolicyStateMachine.assert(policy.status, 'retired', 'admin');
      await this.finance.setPolicyStatus(tx, policy.id, 'retired', admin.userId);
      await this.audit.record(tx, {
        actor: admin,
        action: 'commission_policy.retired',
        entityType: 'commission_policy',
        entityId: policy.id,
        metadata: { version: policy.version },
      });
      return required(await this.finance.findPolicy(tx, policy.id), 'record');
    });
  }

  async list(filter: {
    serviceAreaCode?: string | undefined;
    serviceTypeCode?: string | undefined;
    status?: PolicyStatus | undefined;
  }): Promise<CommissionPolicy[]> {
    let serviceAreaId: string | undefined;
    if (filter.serviceAreaCode) {
      const area = await this.serviceAreas.findActiveByCode(this.db, filter.serviceAreaCode);
      if (!area) return [];
      serviceAreaId = area.id;
    }
    return this.finance.listPolicies(this.db, {
      serviceAreaId,
      serviceTypeCode: filter.serviceTypeCode,
      status: filter.status,
    });
  }
}
