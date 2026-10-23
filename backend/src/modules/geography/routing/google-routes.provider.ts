import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error';
import type { RouteEstimate, RouteRequest, RoutingProvider } from './routing-provider';

/**
 * Google Routes API adapter (ADR-0008). Implemented against the documented
 * `directions/v2:computeRoutes` request/response format; NOT yet verified against the live API
 * (no key in this environment). Only derived numbers leave this class; the raw response is
 * discarded (OPEN_DECISIONS MAP-2).
 */
export const GOOGLE_ROUTES_ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';

const ResponseSchema = z.object({
  routes: z
    .array(
      z.object({
        // proto3 JSON omits zero values, so a zero-length route has no distanceMeters.
        distanceMeters: z.number().int().nonnegative().optional(),
        duration: z
          .string()
          .regex(/^\d+(\.\d+)?s$/)
          .optional(),
      }),
    )
    .optional(),
});

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class GoogleRoutesProvider implements RoutingProvider {
  readonly name = 'google_routes';
  private readonly logger = new Logger(GoogleRoutesProvider.name);

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  async estimateRoute(request: RouteRequest): Promise<RouteEstimate> {
    let response: Response;
    try {
      response = await this.fetchImpl(GOOGLE_ROUTES_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          // Field mask keeps the response (and the billed SKU) minimal.
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
        },
        body: JSON.stringify(buildRequestBody(request)),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      this.logger.warn(
        `Routes API request failed: ${error instanceof Error ? error.name : 'error'}`,
      );
      throw new AppError('ROUTING_UNAVAILABLE', undefined, { cause: error });
    }

    if (!response.ok) {
      // 4xx other than 429 indicates a configuration or request bug; log at error level.
      const level = response.status === 429 || response.status >= 500 ? 'warn' : 'error';
      this.logger[level](`Routes API responded with HTTP ${response.status}`);
      throw new AppError('ROUTING_UNAVAILABLE');
    }

    let parsed: z.infer<typeof ResponseSchema>;
    try {
      parsed = ResponseSchema.parse(await response.json());
    } catch (error) {
      this.logger.error('Routes API returned an unexpected response shape');
      throw new AppError('ROUTING_UNAVAILABLE', undefined, { cause: error });
    }

    const route = parsed.routes?.[0];
    if (!route) {
      throw new AppError('NO_ROUTE_FOUND');
    }
    return {
      distanceMeters: route.distanceMeters ?? 0,
      durationSeconds: route.duration ? Math.round(Number.parseFloat(route.duration)) : null,
      provider: this.name,
      estimatedAt: new Date(),
    };
  }
}

export function buildRequestBody(request: RouteRequest): Record<string, unknown> {
  const waypoint = (point: { lat: number; lng: number }) => ({
    location: { latLng: { latitude: point.lat, longitude: point.lng } },
  });
  return {
    origin: waypoint(request.origin),
    destination: waypoint(request.destination),
    travelMode: request.travelMode === 'two_wheeler' ? 'TWO_WHEELER' : 'DRIVE',
    routingPreference: 'TRAFFIC_UNAWARE',
    computeAlternativeRoutes: false,
    units: 'METRIC',
  };
}
