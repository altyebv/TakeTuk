import { isAppError } from '../../../shared/errors/app-error';
import { haversineMeters } from '../domain/geo';
import { DevFakeRoutingProvider } from './dev-fake-routing.provider';
import {
  buildRequestBody,
  GOOGLE_ROUTES_ENDPOINT,
  GoogleRoutesProvider,
} from './google-routes.provider';
import { buildOsrmRouteUrl, OsrmRoutingProvider } from './osrm-routing.provider';
import type { FetchLike } from './routing-provider';

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

/**
 * Bodies recorded from a real osrm-routed v26.4.0 (car profile, MLD) serving a synthetic road
 * network laid out over Wad Madani coordinates; waypoint hints shortened.
 */
const osrmRecorded = {
  ok: {
    code: 'Ok',
    routes: [
      {
        legs: [{ steps: [], weight: 325.9, summary: '', duration: 325.9, distance: 3274.7 }],
        weight_name: 'routability',
        weight: 325.9,
        duration: 325.9,
        distance: 3274.7,
      },
    ],
    waypoints: [
      { hint: 'IAAAgCMAAIA…', location: [33.512, 14.392], name: '', distance: 0 },
      { hint: 'ZgEAgGkBAIA…', location: [33.528, 14.406], name: '', distance: 0 },
    ],
  },
  samePoint: {
    code: 'Ok',
    routes: [
      {
        legs: [{ steps: [], weight: 0, summary: '', duration: 0, distance: 0 }],
        weight_name: 'routability',
        weight: 0,
        duration: 0,
        distance: 0,
      },
    ],
    waypoints: [
      { hint: 'IAAAgCMAAIA…', location: [33.512, 14.392], name: '', distance: 0 },
      { hint: 'IAAAgCMAAIA…', location: [33.512, 14.392], name: '', distance: 0 },
    ],
  },
  noRoute: { message: 'Impossible route between points', code: 'NoRoute' },
  noSegment: { message: 'Could not find a matching segment for coordinate 1', code: 'NoSegment' },
  invalidValue: { message: 'Invalid coordinate value.', code: 'InvalidValue' },
  invalidOptions: {
    message: 'Number of elements in radiuses size 1 does not match coordinate size 2',
    code: 'InvalidOptions',
  },
};

describe('OsrmRoutingProvider (verified against osrm-routed v26.4.0, synthetic network)', () => {
  const osrmRequest = {
    origin: { lat: 14.392, lng: 33.512 },
    destination: { lat: 14.406, lng: 33.528 },
    travelMode: 'drive' as const,
  };

  it('requests a route with snapping bounded by the configured radius', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(json(200, osrmRecorded.ok));
    };
    const provider = new OsrmRoutingProvider('http://osrm.internal:5000/', 500, 1_000, fetchImpl);
    const estimate = await provider.estimateRoute(osrmRequest);

    expect(estimate).toMatchObject({
      distanceMeters: 3_275,
      durationSeconds: 326,
      provider: 'osrm',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.method).toBe('GET');
    const url = new URL(calls[0]!.url);
    expect(`${url.origin}${url.pathname}`).toBe(
      'http://osrm.internal:5000/route/v1/driving/33.512000,14.392000;33.528000,14.406000',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      overview: 'false',
      alternatives: 'false',
      steps: 'false',
      radiuses: '500;500',
    });
  });

  it('keeps a base path and never emits exponent notation for coordinates', () => {
    const url = buildOsrmRouteUrl(
      'https://routing.example/osrm',
      { ...osrmRequest, origin: { lat: 0.0000001, lng: -0.0000001 } },
      250,
    );
    expect(url).toMatch(
      /^https:\/\/routing\.example\/osrm\/route\/v1\/driving\/-0\.000000,0\.000000;33\.528000,14\.406000\?/,
    );
  });

  it('returns a zero-length route for the same point', async () => {
    const provider = new OsrmRoutingProvider('http://osrm', 500, 1_000, () =>
      Promise.resolve(json(200, osrmRecorded.samePoint)),
    );
    await expect(provider.estimateRoute(osrmRequest)).resolves.toMatchObject({
      distanceMeters: 0,
      durationSeconds: 0,
    });
  });

  it.each([
    [
      'NoRoute (disconnected roads)',
      () => Promise.resolve(json(400, osrmRecorded.noRoute)),
      'NO_ROUTE_FOUND',
    ],
    [
      'NoSegment (beyond the snap radius)',
      () => Promise.resolve(json(400, osrmRecorded.noSegment)),
      'NO_ROUTE_FOUND',
    ],
    [
      'Ok without routes',
      () => Promise.resolve(json(200, { code: 'Ok', routes: [] })),
      'NO_ROUTE_FOUND',
    ],
    [
      'InvalidValue',
      () => Promise.resolve(json(400, osrmRecorded.invalidValue)),
      'ROUTING_UNAVAILABLE',
    ],
    [
      'InvalidOptions',
      () => Promise.resolve(json(400, osrmRecorded.invalidOptions)),
      'ROUTING_UNAVAILABLE',
    ],
    [
      'HTTP 502 from a proxy',
      () => Promise.resolve(new Response('Bad Gateway', { status: 502 })),
      'ROUTING_UNAVAILABLE',
    ],
    ['HTTP 404 (wrong base path)', () => Promise.resolve(json(404, {})), 'ROUTING_UNAVAILABLE'],
    [
      'non-JSON 400',
      () => Promise.resolve(new Response('<html/>', { status: 400 })),
      'ROUTING_UNAVAILABLE',
    ],
    [
      'malformed route',
      () => Promise.resolve(json(200, { code: 'Ok', routes: [{ distance: 'far' }] })),
      'ROUTING_UNAVAILABLE',
    ],
    ['network error', () => Promise.reject(new TypeError('fetch failed')), 'ROUTING_UNAVAILABLE'],
  ])('%s → %s (never a fallback distance)', async (_label, fetchImpl, code) => {
    const provider = new OsrmRoutingProvider('http://osrm', 500, 1_000, fetchImpl);
    const error: unknown = await provider.estimateRoute(osrmRequest).catch((e: unknown) => e);
    expect(isAppError(error, code as 'NO_ROUTE_FOUND' | 'ROUTING_UNAVAILABLE')).toBe(true);
  });

  it('fails closed for two-wheeler routes, which have no OSRM dataset', async () => {
    let called = false;
    const provider = new OsrmRoutingProvider('http://osrm', 500, 1_000, () => {
      called = true;
      return Promise.resolve(json(200, osrmRecorded.ok));
    });
    const error: unknown = await provider
      .estimateRoute({ ...osrmRequest, travelMode: 'two_wheeler' })
      .catch((e: unknown) => e);
    expect(isAppError(error, 'ROUTING_UNAVAILABLE')).toBe(true);
    expect(called).toBe(false);
  });

  it('times out slow responses', async () => {
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'TimeoutError'));
        });
      });
    const provider = new OsrmRoutingProvider('http://osrm', 500, 50, hanging);
    const error: unknown = await provider.estimateRoute(osrmRequest).catch((e: unknown) => e);
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
