import { INITIAL, StateMachine } from '../../../shared/state-machine';

export const VEHICLE_STATUSES = ['pending_review', 'approved', 'rejected', 'suspended'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

/** docs/domain/STATE_MACHINES.md §6 (vehicle review). */
export const vehicleStateMachine = new StateMachine<VehicleStatus, 'driver' | 'admin'>('vehicle', [
  { from: INITIAL, to: 'pending_review', actors: ['driver'] },
  { from: 'pending_review', to: 'approved', actors: ['admin'] },
  { from: 'pending_review', to: 'rejected', actors: ['admin'] },
  { from: 'approved', to: 'suspended', actors: ['admin'] },
  { from: 'suspended', to: 'approved', actors: ['admin'] },
]);

/**
 * Plate numbers: trimmed, internal whitespace collapsed, Latin letters upper-cased. Arabic script
 * is preserved (Sudanese plate formats are not specified; OPEN_DECISIONS DRV-3).
 */
export function normalisePlate(input: string): string {
  return input.trim().replace(/\s+/g, ' ').toUpperCase();
}

export interface Vehicle {
  readonly id: string;
  readonly driverId: string;
  readonly vehicleTypeCode: string;
  readonly plateNumber: string;
  readonly description: string | null;
  readonly status: VehicleStatus;
  readonly reviewNote: string | null;
  readonly reviewedAt: Date | null;
  readonly createdAt: Date;
}

export interface VehicleTypeInfo {
  readonly code: string;
  readonly displayName: string;
  readonly passengerCapable: boolean;
  readonly compatibleServiceTypes: readonly string[];
}
