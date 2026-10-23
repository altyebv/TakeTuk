import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error';
import type { FetchLike, RouteEstimate, RouteRequest, RoutingProvider } from './routing-provider';

/**
 * OSRM adapter (ADR-0017): a self-hosted Open Source Routing Machine instance serving
 * OpenStreetMap data through the HTTP `route` service (API v1). Verified against osrm-routed
 * v26.4.0 on a synthetic road network; NOT yet verified with real Wad Madani data (MAP-1).
 *
 * One osrm-routed instance serves one dataset (one routing profile), whatever the profile segment
 * of the URL says. The configured instance is the car dataset used for `drive`; there is no
 * two-wheeler dataset, so `two_wheeler` requests fail closed instead of silently using car data.
 */
const ResponseSchema = z.object({
  code: z.string(),
  routes: z
    .array(z.object({ distance: z.number().nonnegative(), duration: z.number().nonnegative() }))
    .optional(),
});

/** OSRM codes meaning "these points cannot be routed", as opposed to a request or server fault. */
const NO_ROUTE_CODES: ReadonlySet<string> = new Set(['NoRoute', 'NoSegment']);

export class OsrmRoutingProvider implements RoutingProvider {
  readonly name = 'osrm';
  private readonly logger = new Logger(OsrmRoutingProvider.name);

  constructor(
    private readonly baseUrl: string,
    private readonly snapRadiusMeters: number,
    private readonly timeoutMs: number,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  async estimateRoute(request: RouteRequest): Promise<RouteEstimate> {
    if (request.travelMode !== 'drive') {
      this.logger.error(`No OSRM dataset is configured for travel mode ${request.travelMode}`);
      throw new AppError('ROUTING_UNAVAILABLE');
    }

    let response: Response;
    try {
      response = await this.fetchImpl(
        buildOsrmRouteUrl(this.baseUrl, request, this.snapRadiusMeters),
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch (error) {
      this.logger.warn(`OSRM request failed: ${error instanceof Error ? error.name : 'error'}`);
      throw new AppError('ROUTING_UNAVAILABLE', undefined, { cause: error });
    }

    // OSRM reports routing outcomes in the body: 200 with code Ok, or 400 with an error code.
    if (response.status !== 200 && response.status !== 400) {
      this.logger.warn(`OSRM responded with HTTP ${response.status}`);
      throw new AppError('ROUTING_UNAVAILABLE');
    }

    let parsed: z.infer<typeof ResponseSchema>;
    try {
      parsed = ResponseSchema.parse(await response.json());
    } catch (error) {
      this.logger.error(`OSRM returned an unexpected response (HTTP ${response.status})`);
      throw new AppError('ROUTING_UNAVAILABLE', undefined, { cause: error });
    }

    if (NO_ROUTE_CODES.has(parsed.code)) {
      throw new AppError('NO_ROUTE_FOUND');
    }
    if (parsed.code !== 'Ok') {
      // InvalidQuery, InvalidValue, InvalidOptions, TooBig, ...: a request or configuration bug.
      this.logger.error(`OSRM rejected the request with code ${parsed.code}`);
      throw new AppError('ROUTING_UNAVAILABLE');
    }

    const route = parsed.routes?.[0];
    if (!route) {
      throw new AppError('NO_ROUTE_FOUND');
    }
    return {
      distanceMeters: Math.round(route.distance),
      durationSeconds: Math.round(route.duration),
      provider: this.name,
      estimatedAt: new Date(),
    };
  }
}

/**
 * `GET {base}/route/v1/driving/{lng},{lat};{lng},{lat}`. `radiuses` bounds how far OSRM may snap
 * each point to a road: without it, a point kilometres from any mapped road is silently moved and
 * priced from there. Snapping farther than the radius yields NoSegment, mapped to NO_ROUTE_FOUND.
 */
export function buildOsrmRouteUrl(
  baseUrl: string,
  request: RouteRequest,
  snapRadiusMeters: number,
): string {
  const point = (p: { lat: number; lng: number }) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;
  const query = new URLSearchParams({
    overview: 'false',
    alternatives: 'false',
    steps: 'false',
    radiuses: `${snapRadiusMeters};${snapRadiusMeters}`,
  });
  return `${baseUrl.replace(/\/+$/, '')}/route/v1/driving/${point(request.origin)};${point(request.destination)}?${query.toString()}`;
}
