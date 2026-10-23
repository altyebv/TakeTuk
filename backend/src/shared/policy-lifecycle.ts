import { INITIAL, StateMachine } from './state-machine';

/** Shared lifecycle of versioned policies (fare and commission; STATE_MACHINES §7). */
export const POLICY_STATUSES = ['draft', 'active', 'retired'] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export function policyStateMachine(entity: 'fare_policy' | 'commission_policy') {
  return new StateMachine<PolicyStatus, 'admin'>(entity, [
    { from: INITIAL, to: 'draft', actors: ['admin'] },
    { from: 'draft', to: 'active', actors: ['admin'] },
    { from: 'draft', to: 'retired', actors: ['admin'] },
    { from: 'active', to: 'retired', actors: ['admin'] },
  ]);
}

/** Advisory-lock key text serialising version allocation and activation per policy scope. */
export function policyScopeLockKey(
  entity: string,
  serviceAreaId: string,
  serviceTypeCode: string,
): string {
  return `${entity}:${serviceAreaId}:${serviceTypeCode}`;
}
