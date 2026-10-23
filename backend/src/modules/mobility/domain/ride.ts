import { INITIAL, StateMachine } from '../../../shared/state-machine';

export const RIDE_STATUSES = [
  'searching',
  'driver_assigned',
  'driver_arrived',
  'in_progress',
  'completed',
  'cancelled',
  'expired',
] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

export type RideActor = 'passenger' | 'driver' | 'admin' | 'system';

/** Ride request + trip lifecycle (docs/domain/STATE_MACHINES.md §1 and §4). */
export const rideStateMachine = new StateMachine<RideStatus, RideActor>('ride', [
  { from: INITIAL, to: 'searching', actors: ['passenger'] },
  { from: 'searching', to: 'driver_assigned', actors: ['system'] },
  { from: 'searching', to: 'cancelled', actors: ['passenger', 'admin'] },
  { from: 'searching', to: 'expired', actors: ['system'] },
  { from: 'driver_assigned', to: 'driver_arrived', actors: ['driver'] },
  { from: 'driver_assigned', to: 'cancelled', actors: ['passenger', 'driver', 'admin'] },
  { from: 'driver_arrived', to: 'in_progress', actors: ['driver'] },
  { from: 'driver_arrived', to: 'cancelled', actors: ['passenger', 'driver', 'admin'] },
  { from: 'in_progress', to: 'completed', actors: ['driver'] },
  { from: 'in_progress', to: 'cancelled', actors: ['admin'] },
]);

export const OPEN_RIDE_STATUSES: readonly RideStatus[] = [
  'searching',
  'driver_assigned',
  'driver_arrived',
  'in_progress',
];

/** Statuses in which the assigned counterpart's phone number is visible (IDN-2). */
export const CONTACT_VISIBLE_STATUSES: readonly RideStatus[] = [
  'driver_assigned',
  'driver_arrived',
  'in_progress',
];

export type DriverTripAction = 'arrive' | 'start' | 'complete';

export const TRIP_ACTION_TARGET: Readonly<Record<DriverTripAction, RideStatus>> = {
  arrive: 'driver_arrived',
  start: 'in_progress',
  complete: 'completed',
};

export interface Ride {
  readonly id: string;
  readonly passengerId: string;
  readonly quoteId: string;
  readonly serviceAreaId: string;
  readonly serviceTypeCode: string;
  readonly pickup: { lat: number; lng: number };
  readonly pickupLabel: string | null;
  readonly destination: { lat: number; lng: number };
  readonly destinationLabel: string | null;
  readonly routeDistanceMeters: number;
  readonly routeDurationSeconds: number | null;
  readonly routeProvider: string;
  readonly farePolicyId: string;
  readonly farePolicyVersion: number;
  readonly currency: string;
  readonly minimumFareMinor: number;
  readonly proposedFareMinor: number;
  readonly status: RideStatus;
  readonly searchExpiresAt: Date;
  readonly dispatchRound: number;
  readonly assignedDriverId: string | null;
  readonly assignedVehicleId: string | null;
  readonly fareAgreementId: string | null;
  readonly agreedFareMinor: number | null;
  readonly assignedAt: Date | null;
  readonly driverArrivedAt: Date | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly expiredAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly cancelledByRole: RideActor | null;
  readonly cancelledByUserId: string | null;
  readonly cancellationReason: string | null;
  readonly statusBeforeCancellation: RideStatus | null;
  readonly createdAt: Date;
}
