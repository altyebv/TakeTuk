import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expectStatus, PLACES, Scenario, TEST_PRICING, type Person } from '../support/scenario';

/**
 * Real API responses for the Dart client's contract tests (packages/taketuk_api/test/fixtures).
 *
 * The Dart tests decode these bodies with the generated client. This test keeps them honest: it
 * replays a passenger and driver flow and fails when a response's shape (keys and JSON types)
 * no longer matches the committed fixture. Re-record with RECORD_CLIENT_FIXTURES=1.
 */
const FIXTURES = resolve(__dirname, '../../../packages/taketuk_api/test/fixtures');
const RECORD = process.env.RECORD_CLIENT_FIXTURES === '1';

type Shape = string | Shape[] | { [key: string]: Shape };

/** Keys and JSON types, ignoring values (ids and timestamps differ on every run). */
function shapeOf(value: unknown): Shape {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length === 0 ? [] : [shapeOf(value[0])];
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, shapeOf((value as Record<string, unknown>)[key])]),
    );
  }
  return typeof value;
}

function fixture(name: string, body: unknown): void {
  const file = resolve(FIXTURES, `${name}.json`);
  if (RECORD) {
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
    return;
  }
  const committed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  expect({ name, shape: shapeOf(committed) }).toEqual({ name, shape: shapeOf(body) });
}

describe('client contract fixtures', () => {
  let s: Scenario;
  let admin: Person;

  beforeAll(async () => {
    s = await Scenario.create();
    await s.createServiceArea();
    admin = await s.createAdmin();
    await s.configurePricing(admin);
  });

  afterAll(async () => {
    await s.close();
  });

  it('match the shapes of live responses for the passenger and driver flow', async () => {
    const passenger = await s.registerPassenger('Hiba', '249911111111');
    const me = await s.http().get('/v1/me').set('Authorization', passenger.auth);
    expectStatus(me, 200);
    fixture('identity.getMe', me.body);

    const quote = await s.quote(passenger);
    expectStatus(quote, 201);
    fixture('pricing.createQuote', quote.body);

    const below = await s.requestRide(passenger, TEST_PRICING.expectedMinimumFareMinor - 500, {
      quoteId: quote.body.id as string,
    });
    expect(below.status).toBe(422);
    fixture('problem.FARE_BELOW_MINIMUM', below.body);

    const driver = await s.onlineDriver(admin, { name: 'Musa', at: PLACES.nearPickup });
    const profile = await s.http().get('/v1/driver/profile').set('Authorization', driver.auth);
    expectStatus(profile, 200);
    fixture('drivers.getProfile', profile.body);

    const ride = await s.requestRide(passenger, 25_000, { quoteId: quote.body.id as string });
    expectStatus(ride, 201);
    fixture('rides.create', ride.body);
    const rideId = ride.body.id as string;

    const offers = await s.http().get('/v1/driver/offers').set('Authorization', driver.auth);
    expectStatus(offers, 200);
    fixture('driverOffers.list', offers.body);

    const accepted = await s
      .http()
      .post(`/v1/driver/offers/${offers.body.items[0].offerId as string}/accept`)
      .set('Authorization', driver.auth);
    expectStatus(accepted, 200);
    fixture('driverOffers.accept', accepted.body);

    const assigned = await s.http().get(`/v1/rides/${rideId}`).set('Authorization', passenger.auth);
    expectStatus(assigned, 200);
    fixture('rides.get.assigned', assigned.body);

    for (const step of ['arrive', 'start']) {
      expectStatus(
        await s.http().post(`/v1/driver/rides/${rideId}/${step}`).set('Authorization', driver.auth),
        200,
      );
    }
    const completed = await s
      .http()
      .post(`/v1/driver/rides/${rideId}/complete`)
      .set('Authorization', driver.auth);
    expectStatus(completed, 200);
    fixture('driverRides.complete', completed.body);

    const cash = await s
      .http()
      .post(`/v1/driver/rides/${rideId}/cash-collection`)
      .set('Authorization', driver.auth)
      .send({ outcome: 'collected', amountCollected: { amountMinor: 25_000, currency: 'SDG' } });
    expectStatus(cash, 200);
    fixture('finance.reportCashCollection', cash.body);

    const history = await s.http().get('/v1/rides').set('Authorization', passenger.auth);
    expectStatus(history, 200);
    fixture('rides.list', history.body);
  });
});
