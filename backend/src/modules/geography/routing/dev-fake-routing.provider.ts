import { haversineMeters } from '../domain/geo';
import type { RouteEstimate, RouteRequest, RoutingProvider } from './routing-provider';

/**
 * DEVELOPMENT AND TEST ONLY. Deterministic stand-in for a routing provider: straight-line
 * distance x 1.3, 20 km/h. Results are labelled `dev_fake` so they can never be mistaken for real
 * road distances, and configuration refuses this provider when NODE_ENV=production.
 */
export class DevFakeRoutingProvider implements RoutingProvider {
  readonly name = 'dev_fake';

  estimateRoute(request: RouteRequest): Promise<RouteEstimate> {
    const distanceMeters = Math.round(haversineMeters(request.origin, request.destination) * 1.3);
    return Promise.resolve({
      distanceMeters,
      durationSeconds: Math.round(distanceMeters / (20_000 / 3600)),
      provider: this.name,
      estimatedAt: new Date(),
    });
  }
}
