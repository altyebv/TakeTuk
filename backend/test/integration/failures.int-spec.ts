import { randomUUID } from 'node:crypto';
import { OutboxService } from '../../src/platform/outbox';
import { createTestApp } from '../support/test-app';
import { createTestDatabase } from '../support/test-database';
import { TestTokens } from '../support/test-tokens';
import { expectStatus, PLACES, Scenario, TEST_PRICING, type Person } from '../support/scenario';

describe('failure behaviour', () => {
  let s: Scenario;
  let admin: Person;

  beforeAll(async () => {
    s = await Scenario.create({
      env: { OUTBOX_MAX_ATTEMPTS: '3', QUOTE_RATE_LIMIT_PER_MINUTE: '5' },
    });
    await s.createServiceArea();
    admin = await s.createAdmin();
    await s.configurePricing(admin);
  });

  afterAll(async () => {
    await s.close();
  });

  describe('routing provider', () => {
    afterEach(() => {
      s.routing.mode = 'ok';
    });

    it('fails the quote with 503 and stores nothing when routing is unavailable (no fallback distance)', async () => {
      const passenger = await s.registerPassenger('NoRouting');
      s.routing.mode = 'unavailable';
      const res = await s.quote(passenger);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('ROUTING_UNAVAILABLE');
      const { rows } = await s.db.admin.query(
        `select count(*)::int as n from taketuk.fare_quotes where passenger_id = $1`,
        [passenger.userId],
      );
      expect(rows[0].n).toBe(0);
    });

    it('reports NO_ROUTE_FOUND as a 422', async () => {
      const passenger = await s.registerPassenger('NoRoute');
      s.routing.mode = 'no_route';
      const res = await s.quote(passenger);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('NO_ROUTE_FOUND');
    });

    it('rate-limits quotes per user to protect routing spend', async () => {
      const passenger = await s.registerPassenger('Spammer');
      for (let i = 0; i < 5; i += 1) expectStatus(await s.quote(passenger), 201);
      const limited = await s.quote(passenger);
      expect(limited.status).toBe(429);
      expect(limited.body.code).toBe('RATE_LIMITED');
      expect(limited.headers['retry-after']).toBe('60');
    });
  });

  describe('pricing configuration', () => {
    it('fails closed when no fare policy is active, while existing quotes keep their snapshot', async () => {
      const passenger = await s.registerPassenger('Snapshot');
      const quote = await s.quote(passenger);
      expectStatus(quote, 201);
      const { rows } = await s.db.admin.query<{ id: string }>(
        `select id from taketuk.fare_policies where status = 'active'`,
      );
      expectStatus(
        await s
          .http()
          .post(`/v1/admin/fare-policies/${rows[0]!.id}/retire`)
          .set('Authorization', admin.auth),
        200,
      );

      const other = await s.registerPassenger('AfterRetire');
      const refused = await s.quote(other);
      expect(refused.status).toBe(503);
      expect(refused.body.code).toBe('PRICING_NOT_CONFIGURED');

      const ride = await s.requestRide(passenger, TEST_PRICING.expectedMinimumFareMinor, {
        quoteId: quote.body.id as string,
      });
      expectStatus(ride, 201);
      expect(ride.body.minimumFare.amountMinor).toBe(TEST_PRICING.expectedMinimumFareMinor);
      await s
        .http()
        .post(`/v1/rides/${ride.body.id}/cancel`)
        .set('Authorization', passenger.auth)
        .send({});
      await s.configurePricing(admin); // restore (new versions)
    });
  });

  describe('storage', () => {
    it('returns 503 and creates no document when storage is unavailable', async () => {
      const userId = randomUUID();
      const auth = await s.bearer(userId);
      expectStatus(
        await s.http().post('/v1/driver/registration').set('Authorization', auth).send({
          displayName: 'StorageDown',
          fullLegalName: 'Storage Down',
          drivingLicenseNumber: 'DL-SD-1',
          serviceAreaCode: 'test_city',
        }),
        201,
      );
      s.storage.failing = true;
      try {
        const res = await s
          .http()
          .post('/v1/driver/documents/upload-requests')
          .set('Authorization', auth)
          .send({ documentType: 'driver_photo', contentType: 'image/jpeg' });
        expect(res.status).toBe(503);
        expect(res.body.code).toBe('STORAGE_UNAVAILABLE');
      } finally {
        s.storage.failing = false;
      }
      const { rows } = await s.db.admin.query(
        `select count(*)::int as n from taketuk.driver_documents where driver_id = $1`,
        [userId],
      );
      expect(rows[0].n).toBe(0);
    });
  });

  describe('transaction atomicity', () => {
    it('rolls back the whole assignment when any step fails (no half-assigned ride)', async () => {
      const driver = await s.onlineDriver(admin, { name: 'Atomic', at: PLACES.nearPickup });
      const passenger = await s.registerPassenger('Atomic');
      const ride = await s.requestRide(passenger, 25_000);
      const offer = (await s.openOffers(driver)).find((o) => o.rideId === ride.body.id)!;

      const outbox = s.app.get(OutboxService);
      const original = outbox.enqueue.bind(outbox);
      const spy = jest.spyOn(outbox, 'enqueue').mockImplementation(async (tx, event) => {
        if (event.type === 'ride.assigned') throw new Error('simulated failure after writes');
        return original(tx, event);
      });
      try {
        const res = await s
          .http()
          .post(`/v1/driver/offers/${offer.offerId}/accept`)
          .set('Authorization', driver.auth);
        expect(res.status).toBe(500);
        expect(res.body.code).toBe('INTERNAL_ERROR');
        expect(JSON.stringify(res.body)).not.toContain('simulated'); // internals never leak
      } finally {
        spy.mockRestore();
      }
      const { rows: ridesRows } = await s.db.admin.query(
        `select status, fare_agreement_id from taketuk.rides where id = $1`,
        [ride.body.id],
      );
      expect(ridesRows).toEqual([{ status: 'searching', fare_agreement_id: null }]);
      const { rows: agreements } = await s.db.admin.query(
        `select count(*)::int as n from taketuk.fare_agreements where ride_id = $1`,
        [ride.body.id],
      );
      expect(agreements[0].n).toBe(0);

      // The same acceptance succeeds once the fault is gone.
      expectStatus(
        await s
          .http()
          .post(`/v1/driver/offers/${offer.offerId}/accept`)
          .set('Authorization', driver.auth),
        200,
      );
      await s
        .http()
        .post(`/v1/rides/${ride.body.id}/cancel`)
        .set('Authorization', passenger.auth)
        .send({});
    });
  });

  describe('notifications and the outbox', () => {
    it('retries push failures with backoff, then marks the event failed; business state is unaffected', async () => {
      const passenger = await s.registerPassenger('PushFail');
      await s
        .http()
        .put(`/v1/me/devices/${randomUUID()}`)
        .set('Authorization', passenger.auth)
        .send({ app: 'passenger', platform: 'ios', pushToken: 'ios-token-failing-1' });
      const ride = await s.requestRide(passenger, 25_000);
      expectStatus(
        await s
          .http()
          .post(`/v1/rides/${ride.body.id}/cancel`)
          .set('Authorization', passenger.auth)
          .send({}),
        200,
      );
      await s.outbox().runOnce(); // deliver everything pending so far
      await s.db.admin.query(
        `update taketuk.outbox_events set status = 'published' where status = 'pending'`,
      );

      // An admin cancellation notifies the passenger; make every push attempt fail.
      const ride2 = await s.requestRide(passenger, 25_000);
      expectStatus(
        await s
          .http()
          .post(`/v1/admin/rides/${ride2.body.id}/cancel`)
          .set('Authorization', admin.auth)
          .send({ reason: 'Operational test' }),
        200,
      );
      s.notifications.failNext = 100;
      try {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          await s.outbox().runOnce();
          const { rows } = await s.db.admin.query<{
            status: string;
            attempts: number;
            available_at: Date;
          }>(
            `select status, attempts, available_at from taketuk.outbox_events where aggregate_id = $1 and event_type = 'ride.cancelled'`,
            [ride2.body.id],
          );
          expect(rows[0]!.attempts).toBe(attempt);
          if (attempt < 3) {
            expect(rows[0]!.status).toBe('pending');
            expect(rows[0]!.available_at.getTime()).toBeGreaterThan(Date.now()); // backoff scheduled
            await s.db.admin.query(
              `update taketuk.outbox_events set available_at = now() where aggregate_id = $1`,
              [ride2.body.id],
            );
          } else {
            expect(rows[0]!.status).toBe('failed');
          }
        }
      } finally {
        s.notifications.failNext = 0;
      }
      const view = await s
        .http()
        .get(`/v1/rides/${ride2.body.id}`)
        .set('Authorization', passenger.auth);
      expect(view.body.status).toBe('cancelled');
    });

    it('re-delivers an event whose worker crashed after claiming it', async () => {
      const passenger = await s.registerPassenger('Crash');
      await s
        .http()
        .put(`/v1/me/devices/${randomUUID()}`)
        .set('Authorization', passenger.auth)
        .send({ app: 'passenger', platform: 'android', pushToken: 'android-token-crash-1' });
      const ride = await s.requestRide(passenger, 25_000);
      expectStatus(
        await s
          .http()
          .post(`/v1/admin/rides/${ride.body.id}/cancel`)
          .set('Authorization', admin.auth)
          .send({ reason: 'Crash recovery test' }),
        200,
      );
      // Simulate a worker that claimed the event and died before recording the outcome.
      await s.db.admin.query(
        `update taketuk.outbox_events set claimed_until = now() + interval '1 hour' where aggregate_id = $1 and status = 'pending'`,
        [ride.body.id],
      );
      const before = s.notifications.sent.length;
      await s.outbox().runOnce();
      expect(s.notifications.sent.length).toBe(before); // still claimed by the "dead" worker
      await s.db.admin.query(
        `update taketuk.outbox_events set claimed_until = now() - interval '1 second' where aggregate_id = $1`,
        [ride.body.id],
      );
      await s.outbox().runOnce();
      const delivered = s.notifications.sent
        .slice(before)
        .filter((m) => m.tokens.includes('android-token-crash-1'));
      expect(delivered.map((m) => m.message.title)).toContain('Ride cancelled');
    });
  });

  describe('database unavailable', () => {
    it('reports not-ready and answers 503 instead of crashing', async () => {
      const db = await createTestDatabase();
      const tokens = await TestTokens.create();
      const broken = await createTestApp(
        { ...db, apiUrl: 'postgres://nobody:nothing@127.0.0.1:1/none' },
        tokens,
        { env: { DATABASE_POOL_MAX: '2' } },
      );
      try {
        const ready = await broken.http().get('/health/ready');
        expect(ready.status).toBe(503);
        expect(ready.body).toEqual({ status: 'unavailable', checks: { database: 'unavailable' } });
        await broken.http().get('/health/live').expect(200);
        const me = await broken
          .http()
          .get('/v1/me')
          .set('Authorization', `Bearer ${await tokens.sign(randomUUID())}`);
        expect(me.status).toBe(503);
        expect(me.body.code).toBe('DATABASE_UNAVAILABLE');
      } finally {
        await broken.close();
        await db.drop();
      }
    });
  });
});
