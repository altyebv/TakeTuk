import { policyStateMachine, type PolicyStatus } from '../../../shared/policy-lifecycle';
import type { TravelMode } from '../../geography';
import type { FarePolicyParameters } from './minimum-fare';

export const farePolicyStateMachine = policyStateMachine('fare_policy');

export interface FarePolicy extends FarePolicyParameters {
  readonly id: string;
  readonly serviceAreaId: string;
  readonly serviceAreaCode: string;
  readonly serviceTypeCode: string;
  readonly version: number;
  readonly status: PolicyStatus;
  readonly currency: string;
  readonly notes: string | null;
  readonly createdAt: Date;
  readonly activatedAt: Date | null;
  readonly retiredAt: Date | null;
}

export interface FareQuote {
  readonly id: string;
  readonly passengerId: string;
  readonly serviceAreaId: string;
  readonly serviceTypeCode: string;
  readonly pickup: { lat: number; lng: number };
  readonly pickupLabel: string | null;
  readonly destination: { lat: number; lng: number };
  readonly destinationLabel: string | null;
  readonly routeDistanceMeters: number;
  readonly routeDurationSeconds: number | null;
  readonly routeProvider: string;
  readonly routeEstimatedAt: Date;
  readonly farePolicyId: string;
  readonly farePolicyVersion: number;
  readonly currency: string;
  readonly minimumFareMinor: number;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

/**
 * Travel mode used for the route estimate of each service type. Raksha travel is approximated
 * with DRIVE (OPEN_DECISIONS MAP-3).
 */
export function travelModeFor(serviceTypeCode: string): TravelMode {
  return serviceTypeCode === 'food_delivery' ? 'two_wheeler' : 'drive';
}
