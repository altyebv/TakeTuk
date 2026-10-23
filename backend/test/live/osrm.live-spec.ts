import { isAppError } from '../../src/shared/errors/app-error';
import { haversineMeters, OsrmRoutingProvider } from '../../src/modules/geography';

/**
 * Exercises OsrmRoutingProvider against a real osrm-routed serving the synthetic network from
 * infra/osrm/synthetic-network.mjs (see infra/osrm/README.md). Set OSRM_LIVE_URL to its base URL.
 */
const baseUrl = process.env.OSRM_LIVE_URL;
if (!baseUrl) {
  throw new Error('OSRM_LIVE_URL is not set: start osrm-routed on the synthetic network first');
}

const provider = new OsrmRoutingProvider(baseUrl, 500, 5_000);
const gridPoint = (row: number, column: number) => ({
  lat: 14.39 + row * 0.002,
  lng: 33.51 + column * 0.002,
});

describe('OsrmRoutingProvider against osrm-routed (synthetic network)', () => {
  it('routes along the street grid', async () => {
    const origin = gridPoint(1, 1);
    const destination = gridPoint(8, 9);
    const estimate = await provider.estimateRoute({ origin, destination, travelMode: 'drive' });

    // On a grid the shortest road path is the Manhattan distance: 7 rows + 8 columns of streets.
    const manhattan =
      haversineMeters(origin, { lat: destination.lat, lng: origin.lng }) +
      haversineMeters({ lat: destination.lat, lng: origin.lng }, destination);
    expect(estimate.provider).toBe('osrm');
    expect(estimate.distanceMeters).toBeGreaterThan(haversineMeters(origin, destination));
    expect(Math.abs(estimate.distanceMeters - manhattan)).toBeLessThan(25);
    expect(estimate.durationSeconds).toBeGreaterThan(0);
  });

  it('returns zero for the same point', async () => {
    const point = gridPoint(3, 3);
    await expect(
      provider.estimateRoute({ origin: point, destination: point, travelMode: 'drive' }),
    ).resolves.toMatchObject({ distanceMeters: 0, durationSeconds: 0 });
  });

  it('refuses a point farther from any road than the snap radius', async () => {
    const error: unknown = await provider
      .estimateRoute({
        origin: gridPoint(1, 1),
        destination: { lat: 14.36, lng: 33.515 }, // about 3.3 km south of the grid
        travelMode: 'drive',
      })
      .catch((e: unknown) => e);
    expect(isAppError(error, 'NO_ROUTE_FOUND')).toBe(true);
  });

  it('reports no route between disconnected roads', async () => {
    const error: unknown = await provider
      .estimateRoute({
        origin: gridPoint(1, 1),
        destination: { lat: 14.451, lng: 33.6 }, // the island street
        travelMode: 'drive',
      })
      .catch((e: unknown) => e);
    expect(isAppError(error, 'NO_ROUTE_FOUND')).toBe(true);
  });

  it('reports the server as unavailable when nothing listens', async () => {
    const unreachable = new OsrmRoutingProvider('http://127.0.0.1:9', 500, 2_000);
    const error: unknown = await unreachable
      .estimateRoute({ origin: gridPoint(1, 1), destination: gridPoint(2, 2), travelMode: 'drive' })
      .catch((e: unknown) => e);
    expect(isAppError(error, 'ROUTING_UNAVAILABLE')).toBe(true);
  });
});
