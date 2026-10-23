import type { RouteEstimate, RouteRequest, RoutingProvider } from '../../src/modules/geography';
import { AppError } from '../../src/shared/errors/app-error';

/** Test routing provider with a fixed distance and switchable failure modes. */
export class ControllableRoutingProvider implements RoutingProvider {
  readonly name = 'test_routing';
  mode: 'ok' | 'unavailable' | 'no_route' = 'ok';
  distanceMeters = 2_500;
  calls: RouteRequest[] = [];

  estimateRoute(request: RouteRequest): Promise<RouteEstimate> {
    this.calls.push(request);
    if (this.mode === 'unavailable') return Promise.reject(new AppError('ROUTING_UNAVAILABLE'));
    if (this.mode === 'no_route') return Promise.reject(new AppError('NO_ROUTE_FOUND'));
    return Promise.resolve({
      distanceMeters: this.distanceMeters,
      durationSeconds: 600,
      provider: this.name,
      estimatedAt: new Date(),
    });
  }
}
