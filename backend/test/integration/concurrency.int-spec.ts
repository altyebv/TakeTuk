import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import {
  expectStatus,
  PLACES,
  Scenario,
  type DriverPerson,
  type Person,
} from '../support/scenario';

/**
 * Concurrency guarantees (docs/domain/STATE_MACHINES.md §3). Requests run truly concurrently:
 * separate HTTP requests, separate pooled connections, separate PostgreSQL transactions.
 */
describe('concurrency', () => {
  let s: Scenario;
  let admin: Person;
  let drivers: DriverPerson[];

  const ITERATIONS = 10;

  beforeAll(async () => {
    s = await Scenario.create({ env: { DATABASE_POOL_MAX: '20' } });
    await s.createServiceArea();
    admin = await s.createAdmin();
    await s.configurePricing(admin);
    drivers = [];
    for (let i = 0; i < 5; i += 1) {
      drivers.push(await s.onlineDriver(admin, { name: `Racer ${i}`, at: PLACES.nearPickup }));
    }
  });

  afterAll(async () => {
    await s.close();
  });

  async function rideWithOffersToAllDrivers(
    passenger: Person,
  ): Promise<{ rideId: string; offers: Map<string, string> }> {
    const ride = await s.requestRide(passenger, 25_000);
    expectStatus(ride, 201);
    const rideId = ride.body.id as string;
    const offers = new Map<string, string>();
    for (const driver of drivers) {
      const offer = (await s.openOffers(driver)).find((o) => o.rideId === rideId);
      if (offer) offers.set(driver.userId, offer.offerId);
    }
    return { rideId, offers };
  }

  async function assertSingleAssignment(rideId: string, winnerId: string): Promise<void> {
    const { rows: agreements } = await s.db.admin.query(
      `select driver_id from taketuk.fare_agreements where ride_id = $1`,
      [rideId],
    );
    expect(agreements).toEqual([{ driver_id: winnerId }]);
    const { rows: assignments } = await s.db.admin.query(
      `select driver_id, status from taketuk.ride_assignments where ride_id = $1`,
      [rideId],
    );
    expect(assignments).toEqual([{ driver_id: winnerId, status: 'active' }]);
    const { rows: ride } = await s.db.admin.query(
      `select status, assigned_driver_id from taketuk.rides where id = $1`,
      [rideId],
    );
    expect(ride).toEqual([{ status: 'driver_assigned', assigned_driver_id: winnerId }]);
    const { rows: open } = await s.db.admin.query(
      `select count(*)::int as n from taketuk.ride_offers where ride_id = $1 and status in ('pending', 'countered')`,
      [rideId],
    );
    expect(open[0].n).toBe(0);
  }

  it(`never assigns a ride to more than one driver when 5 drivers accept simultaneously (${ITERATIONS} rounds)`, async () => {
    for (let round = 0; round < ITERATIONS; round += 1) {
      const passenger = await s.registerPassenger(`Race ${round}`);
      const { rideId, offers } = await rideWithOffersToAllDrivers(passenger);
      expect(offers.size).toBe(drivers.length);

      const responses = await Promise.all(
        drivers.map((driver) =>
          s
            .http()
            .post(`/v1/driver/offers/${offers.get(driver.userId)!}/accept`)
            .set('Authorization', driver.auth),
        ),
      );
      const winners = responses.filter((r) => r.status === 200);
      const losers = responses.filter((r) => r.status !== 200);
      expect(winners).toHaveLength(1);
      for (const loser of losers) {
        expect(loser.status).toBe(409);
        expect(loser.body.code).toBe('RIDE_NO_LONGER_AVAILABLE');
      }
      const winnerIndex = responses.findIndex((r) => r.status === 200);
      await assertSingleAssignment(rideId, drivers[winnerIndex]!.userId);

      // Free the winner for the next round.
      expectStatus(
        await s
          .http()
          .post(`/v1/rides/${rideId}/cancel`)
          .set('Authorization', passenger.auth)
          .send({}),
        200,
      );
    }
  });

  it('resolves a passenger accepting a counteroffer while another driver accepts the proposal', async () => {
    for (let round = 0; round < ITERATIONS; round += 1) {
      const passenger = await s.registerPassenger(`Counter race ${round}`);
      const { rideId, offers } = await rideWithOffersToAllDrivers(passenger);
      const [counterDriver, acceptingDriver] = drivers;
      const counterOfferId = offers.get(counterDriver!.userId)!;
      expectStatus(
        await s
          .http()
          .post(`/v1/driver/offers/${counterOfferId}/counteroffer`)
          .set('Authorization', counterDriver!.auth)
          .send({ amount: { amountMinor: 30_000, currency: 'SDG' } }),
        200,
      );

      const [passengerAccept, driverAccept] = await Promise.all([
        s
          .http()
          .post(`/v1/rides/${rideId}/offers/${counterOfferId}/accept-counteroffer`)
          .set('Authorization', passenger.auth),
        s
          .http()
          .post(`/v1/driver/offers/${offers.get(acceptingDriver!.userId)!}/accept`)
          .set('Authorization', acceptingDriver!.auth),
      ]);
      const statuses = [passengerAccept.status, driverAccept.status].sort();
      expect(statuses).toEqual([200, 409]);
      const winnerId =
        passengerAccept.status === 200 ? counterDriver!.userId : acceptingDriver!.userId;
      await assertSingleAssignment(rideId, winnerId);
      const { rows } = await s.db.admin.query(
        `select agreed_fare_minor from taketuk.rides where id = $1`,
        [rideId],
      );
      expect(rows[0].agreed_fare_minor).toBe(passengerAccept.status === 200 ? 30_000 : 25_000);

      expectStatus(
        await s
          .http()
          .post(`/v1/rides/${rideId}/cancel`)
          .set('Authorization', passenger.auth)
          .send({}),
        200,
      );
    }
  });

  it('treats concurrent retries of the same acceptance as one acceptance', async () => {
    const passenger = await s.registerPassenger('Retry storm');
    const { rideId, offers } = await rideWithOffersToAllDrivers(passenger);
    const driver = drivers[2]!;
    const offerId = offers.get(driver.userId)!;
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        s.http().post(`/v1/driver/offers/${offerId}/accept`).set('Authorization', driver.auth),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    await assertSingleAssignment(rideId, driver.userId);
    expectStatus(
      await s
        .http()
        .post(`/v1/rides/${rideId}/cancel`)
        .set('Authorization', passenger.auth)
        .send({}),
      200,
    );
  });

  it('creates exactly one ride for concurrent requests with the same idempotency key', async () => {
    const passenger = await s.registerPassenger('Idempotent');
    const quote = await s.quote(passenger);
    const key = `idem-${randomUUID()}`;
    const responses: Response[] = await Promise.all(
      Array.from({ length: 6 }, () =>
        s.requestRide(passenger, 25_000, { key, quoteId: quote.body.id as string }),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(6).fill(201));
    const ids = new Set(responses.map((r) => r.body.id as string));
    expect(ids.size).toBe(1);
    expect(responses.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(5);
    const { rows } = await s.db.admin.query(
      `select count(*)::int as n from taketuk.rides where passenger_id = $1`,
      [passenger.userId],
    );
    expect(rows[0].n).toBe(1);

    // Same key, different body: rejected without side effects.
    const reused = await s.requestRide(passenger, 26_000, {
      key,
      quoteId: quote.body.id as string,
    });
    expect(reused.status).toBe(422);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    await s
      .http()
      .post(`/v1/rides/${[...ids][0]!}/cancel`)
      .set('Authorization', passenger.auth)
      .send({});
  });

  it('allows only one open ride when a passenger fires two different requests at once', async () => {
    const passenger = await s.registerPassenger('Double tap');
    const [q1, q2] = await Promise.all([s.quote(passenger), s.quote(passenger)]);
    const responses = await Promise.all([
      s.requestRide(passenger, 25_000, { quoteId: q1.body.id as string }),
      s.requestRide(passenger, 25_000, { quoteId: q2.body.id as string }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(responses.find((r) => r.status === 409)!.body.code).toBe('RIDE_ALREADY_OPEN');
    const created = responses.find((r) => r.status === 201)!;
    await s
      .http()
      .post(`/v1/rides/${created.body.id}/cancel`)
      .set('Authorization', passenger.auth)
      .send({});
  });

  it('gives a driver at most one open offer when several rides dispatch at the same time', async () => {
    // Take all racers offline except one, so every ride competes for the same driver.
    for (const d of drivers.slice(1)) {
      expectStatus(
        await s
          .http()
          .put('/v1/driver/availability')
          .set('Authorization', d.auth)
          .send({ availability: 'offline' }),
        200,
      );
    }
    const lone = drivers[0]!;
    const passengers = await Promise.all(
      [0, 1, 2, 3].map((i) => s.registerPassenger(`Parallel ${i}`)),
    );
    // Create rides without the immediate dispatch winning first: insert them, then dispatch concurrently.
    const rides = await Promise.all(passengers.map((p) => s.requestRide(p, 25_000)));
    rides.forEach((r) => {
      expectStatus(r, 201);
    });
    await Promise.all(rides.map((r) => s.dispatch().dispatchRide(r.body.id as string)));
    const { rows } = await s.db.admin.query(
      `select count(*)::int as n from taketuk.ride_offers where driver_id = $1 and status in ('pending', 'countered')`,
      [lone.userId],
    );
    expect(rows[0].n).toBe(1);
    for (const [i, r] of rides.entries()) {
      await s
        .http()
        .post(`/v1/rides/${r.body.id}/cancel`)
        .set('Authorization', passengers[i]!.auth)
        .send({});
    }
    for (const d of drivers.slice(1)) {
      await s
        .http()
        .put('/v1/driver/availability')
        .set('Authorization', d.auth)
        .send({ availability: 'online', vehicleId: d.vehicleId });
    }
  });

  it('records one payment and one commission for concurrent completion retries', async () => {
    const passenger = await s.registerPassenger('Complete twice');
    const { rideId, offers } = await rideWithOffersToAllDrivers(passenger);
    const driver = drivers[3]!;
    expectStatus(
      await s
        .http()
        .post(`/v1/driver/offers/${offers.get(driver.userId)!}/accept`)
        .set('Authorization', driver.auth),
      200,
    );
    expectStatus(
      await s.http().post(`/v1/driver/rides/${rideId}/arrive`).set('Authorization', driver.auth),
      200,
    );
    expectStatus(
      await s.http().post(`/v1/driver/rides/${rideId}/start`).set('Authorization', driver.auth),
      200,
    );
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        s.http().post(`/v1/driver/rides/${rideId}/complete`).set('Authorization', driver.auth),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const { rows: payments } = await s.db.admin.query(
      `select count(*)::int as n from taketuk.ride_payments where ride_id = $1`,
      [rideId],
    );
    const { rows: txs } = await s.db.admin.query(
      `select count(*)::int as n from taketuk.ledger_transactions where ride_id = $1`,
      [rideId],
    );
    expect(payments[0].n).toBe(1);
    expect(txs[0].n).toBe(1);
  });

  it('activates exactly one policy version under concurrent activation', async () => {
    const drafts = await Promise.all(
      [1, 2, 3].map(() =>
        s.http().post('/v1/admin/commission-policies').set('Authorization', admin.auth).send({
          serviceAreaCode: 'test_city',
          serviceTypeCode: 'passenger_transport',
          rateBasisPoints: 900,
        }),
      ),
    );
    drafts.forEach((d) => {
      expectStatus(d, 201);
    });
    expect(new Set(drafts.map((d) => d.body.version as number)).size).toBe(3);
    await Promise.all(
      drafts.map((d) =>
        s
          .http()
          .post(`/v1/admin/commission-policies/${d.body.id}/activate`)
          .set('Authorization', admin.auth),
      ),
    );
    const { rows } = await s.db.admin.query(
      `select count(*)::int as n from taketuk.commission_policies p join taketuk.service_areas a on a.id = p.service_area_id
        where a.code = 'test_city' and p.status = 'active'`,
    );
    expect(rows[0].n).toBe(1);
  });

  it('rejects a second active assignment for a ride even when application checks are bypassed', async () => {
    const passenger = await s.registerPassenger('Bypass');
    const { rideId, offers } = await rideWithOffersToAllDrivers(passenger);
    const winner = drivers[4]!;
    expectStatus(
      await s
        .http()
        .post(`/v1/driver/offers/${offers.get(winner.userId)!}/accept`)
        .set('Authorization', winner.auth),
      200,
    );
    const existing = { ride_id: rideId, driver_id: winner.userId };
    const other = drivers[0]!;
    await expect(
      s.db.admin.query(
        `insert into taketuk.ride_assignments (ride_id, driver_id, vehicle_id, fare_agreement_id, commission_policy_id,
            commission_policy_version, commission_rate_basis_points, status)
         select ride_id, $2, $3, fare_agreement_id, commission_policy_id, commission_policy_version,
                commission_rate_basis_points, 'active'
           from taketuk.ride_assignments where ride_id = $1 and status = 'active'`,
        [existing.ride_id, other.userId, other.vehicleId],
      ),
    ).rejects.toThrow(
      /ride_assignments_fare_agreement_id_key|ride_assignments_one_active_per_ride/,
    );
  });
});
