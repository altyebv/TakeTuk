import type { Coordinates } from '../../../shared/schemas';

/**
 * Routing port (ADR-0009). The only provider capability that affects business decisions.
 *
 * Contract:
 *  - resolves with a road-distance estimate, or
 *  - rejects with AppError('ROUTING_UNAVAILABLE') (timeout, network, quota, provider error), or
 *  - rejects with AppError('NO_ROUTE_FOUND').
 * Implementations must never fall back to straight-line distance.
 */
export type TravelMode = 'drive' | 'two_wheeler';

export interface RouteRequest {
  readonly origin: Coordinates;
  readonly destination: Coordinates;
  readonly travelMode: TravelMode;
}

export interface RouteEstimate {
  readonly distanceMeters: number;
  readonly durationSeconds: number | null;
  /** Provenance recorded with every fare calculation, e.g. `google_routes`. */
  readonly provider: string;
  readonly estimatedAt: Date;
}

export interface RoutingProvider {
  readonly name: string;
  estimateRoute(request: RouteRequest): Promise<RouteEstimate>;
}

/** Injectable transport so adapters can be tested without the network. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export const ROUTING_PROVIDER = Symbol('ROUTING_PROVIDER');
