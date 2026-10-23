import { isAppError } from '../../../shared/errors/app-error';
import { haversineMeters } from '../domain/geo';
import { DevFakeRoutingProvider } from './dev-fake-routing.provider';
import {
  buildRequestBody,
  GOOGLE_ROUTES_ENDPOINT,
  GoogleRoutesProvider,
  type FetchLike,
} from './google-routes.provider';

const request = {
  origin: { lat: 14.4, lng: 33.52 },
  destination: { lat: 14.42, lng: 33.53 },
  travelMode: 'drive' as const,
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('GoogleRoutesProvider (documented API format; not verified live)', () => {
  it('sends a minimal computeRoutes request with a field mask and the server key', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(json(200, { routes: [{ distanceMeters: 2_731, duration: '512s' }] }));
    };
    const provider = new GoogleRoutesProvider('server-key', 1_000, fetchImpl);
    const estimate = await provider.estimateRoute(request);

    expect(estimate).toMatchObject({
      distanceMeters: 2_731,
      durationSeconds: 512,
      provider: 'google_routes',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(GOOGLE_ROUTES_ENDPOINT);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('server-key');
    expect(headers['X-Goog-FieldMask']).toBe('routes.distanceMeters,routes.duration');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      origin: { location: { latLng: { latitude: 14.4, longitude: 33.52 } } },
      destination: { location: { latLng: { latitude: 14.42, longitude: 33.53 } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      computeAlternativeRoutes: false,
      units: 'METRIC',
    });
  });

  it('maps two-wheeler travel mode', () => {
    expect(buildRequestBody({ ...request, travelMode: 'two_wheeler' }).travelMode).toBe(
      'TWO_WHEELER',
    );
  });

  it('treats an omitted distance on a returned route as zero (proto3 JSON)', async () => {
    const provider = new GoogleRoutesProvider('k', 1_000, () =>
      Promise.resolve(json(200, { routes: [{}] })),
    );
    await expect(provider.estimateRoute(request)).resolves.toMatchObject({
      distanceMeters: 0,
      durationSeconds: null,
    });
  });

  it.each([
    ['no routes', () => Promise.resolve(json(200, {})), 'NO_ROUTE_FOUND'],
    ['HTTP 500', () => Promise.resolve(json(500, { error: {} })), 'ROUTING_UNAVAILABLE'],
    ['HTTP 429', () => Promise.resolve(json(429, { error: {} })), 'ROUTING_UNAVAILABLE'],
    ['HTTP 403 (bad key)', () => Promise.resolve(json(403, { error: {} })), 'ROUTING_UNAVAILABLE'],
    ['network error', () => Promise.reject(new TypeError('fetch failed')), 'ROUTING_UNAVAILABLE'],
    [
      'malformed body',
      () => Promise.resolve(json(200, { routes: [{ distanceMeters: 'far' }] })),
      'ROUTING_UNAVAILABLE',
    ],
  ])('%s → %s (never a fallback distance)', async (_label, fetchImpl, code) => {
    const provider = new GoogleRoutesProvider('k', 1_000, fetchImpl);
    const error: unknown = await provider.estimateRoute(request).catch((e: unknown) => e);
    expect(isAppError(error, code as 'NO_ROUTE_FOUND' | 'ROUTING_UNAVAILABLE')).toBe(true);
  });

  it('times out slow responses', async () => {
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'TimeoutError'));
        });
      });
    const provider = new GoogleRoutesProvider('k', 50, hanging);
    const error: unknown = await provider.estimateRoute(request).catch((e: unknown) => e);
    expect(isAppError(error, 'ROUTING_UNAVAILABLE')).toBe(true);
  });
});

describe('DevFakeRoutingProvider (development only)', () => {
  it('is deterministic and labelled so it can never pass for a real road distance', async () => {
    const fake = new DevFakeRoutingProvider();
    const a = await fake.estimateRoute(request);
    const b = await fake.estimateRoute(request);
    expect(a.distanceMeters).toBe(b.distanceMeters);
    expect(a.distanceMeters).toBe(
      Math.round(haversineMeters(request.origin, request.destination) * 1.3),
    );
    expect(a.provider).toBe('dev_fake');
  });
});

describe('haversineMeters', () => {
  it('computes approximate great-circle distances', () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111_195, -2);
    expect(haversineMeters(request.origin, request.origin)).toBe(0);
  });
});
