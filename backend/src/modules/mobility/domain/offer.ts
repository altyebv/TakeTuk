import { INITIAL, StateMachine } from '../../../shared/state-machine';

export const OFFER_STATUSES = [
  'pending',
  'countered',
  'accepted',
  'declined',
  'counter_accepted',
  'counter_rejected',
  'expired',
  'withdrawn',
] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const OPEN_OFFER_STATUSES: readonly OfferStatus[] = ['pending', 'countered'];

/** Dispatch offer and fare negotiation (docs/domain/STATE_MACHINES.md §2). */
export const offerStateMachine = new StateMachine<OfferStatus, 'driver' | 'passenger' | 'system'>(
  'ride_offer',
  [
    { from: INITIAL, to: 'pending', actors: ['system'] },
    { from: 'pending', to: 'accepted', actors: ['driver'] },
    { from: 'pending', to: 'declined', actors: ['driver'] },
    { from: 'pending', to: 'countered', actors: ['driver'] },
    { from: 'pending', to: 'expired', actors: ['system'] },
    { from: 'pending', to: 'withdrawn', actors: ['system'] },
    { from: 'countered', to: 'counter_accepted', actors: ['passenger'] },
    { from: 'countered', to: 'counter_rejected', actors: ['passenger'] },
    { from: 'countered', to: 'expired', actors: ['system'] },
    { from: 'countered', to: 'withdrawn', actors: ['system'] },
  ],
);

export type AssignmentStatus = 'active' | 'completed' | 'cancelled';

/** Driver assignment (docs/domain/STATE_MACHINES.md §3). */
export const assignmentStateMachine = new StateMachine<AssignmentStatus, 'system'>(
  'ride_assignment',
  [
    { from: INITIAL, to: 'active', actors: ['system'] },
    { from: 'active', to: 'completed', actors: ['system'] },
    { from: 'active', to: 'cancelled', actors: ['system'] },
  ],
);

export type AgreementBasis =
  'driver_accepted_passenger_proposal' | 'passenger_accepted_driver_counteroffer';

export interface RideOffer {
  readonly id: string;
  readonly rideId: string;
  readonly driverId: string;
  readonly vehicleId: string;
  readonly dispatchRound: number;
  readonly distanceToPickupMeters: number;
  readonly status: OfferStatus;
  readonly currency: string;
  readonly minimumFareMinor: number;
  readonly offeredFareMinor: number;
  readonly counterFareMinor: number | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly counteredAt: Date | null;
  readonly closedAt: Date | null;
}

export interface FareAgreement {
  readonly id: string;
  readonly rideId: string;
  readonly offerId: string;
  readonly passengerId: string;
  readonly driverId: string;
  readonly basis: AgreementBasis;
  readonly currency: string;
  readonly agreedFareMinor: number;
  readonly minimumFareMinor: number;
  readonly passengerProposedFareMinor: number;
  readonly driverCounterFareMinor: number | null;
  readonly farePolicyId: string;
  readonly farePolicyVersion: number;
  readonly quoteId: string;
  readonly routeDistanceMeters: number;
  readonly routeProvider: string;
  readonly agreedAt: Date;
}

export interface RideAssignment {
  readonly id: string;
  readonly rideId: string;
  readonly driverId: string;
  readonly vehicleId: string;
  readonly fareAgreementId: string;
  readonly commissionPolicyId: string;
  readonly commissionPolicyVersion: number;
  readonly commissionRateBasisPoints: number;
  readonly status: AssignmentStatus;
  readonly createdAt: Date;
  readonly endedAt: Date | null;
}

/** The fare a confirmed agreement settles on, by basis. */
export function agreedFareFor(
  basis: AgreementBasis,
  offer: Pick<RideOffer, 'offeredFareMinor' | 'counterFareMinor'>,
): number {
  if (basis === 'driver_accepted_passenger_proposal') return offer.offeredFareMinor;
  if (offer.counterFareMinor === null) {
    throw new Error('A counteroffer agreement requires a counteroffer amount');
  }
  return offer.counterFareMinor;
}
