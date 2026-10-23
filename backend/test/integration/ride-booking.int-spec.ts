import {
  expectStatus,
  PLACES,
  Scenario,
  TEST_PRICING,
  type DriverPerson,
  type Person,
} from '../support/scenario';

/**
 * End-to-end ride booking through the HTTP API against PostgreSQL (docs/domain/STATE_MACHINES.md).
 */
describe('ride booking (end to end)', () => {
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

  describe('quotes', () => {
    it('computes the minimum fare from the routing distance and the active policy version', async () => {
      const passenger = await s.registerPassenger('Quote');
      const res = await s.quote(passenger);
      expectStatus(res, 201);
      expect(res.body).toMatchObject({
        serviceTypeCode: 'passenger_transport',
        route: { distanceMeters: 2500, provider: 'test_routing' },
        minimumFare: { amountMinor: TEST_PRICING.expectedMinimumFareMinor, currency: 'SDG' },
        farePolicy: { version: 1 },
        pickup: { label: 'University main gate' },
      });
      expect(new Date(res.body.expiresAt as string).getTime()).toBeGreaterThan(Date.now());
    });

    it('rejects locations outside the service area and identical points', async () => {
      const passenger = await s.registerPassenger('Outside');
      const outside = await s.quote(passenger, PLACES.outsideArea, PLACES.destination);
      expect(outside.status).toBe(422);
      expect(outside.body.code).toBe('OUTSIDE_SERVICE_AREA');
      const destOutside = await s.quote(passenger, PLACES.pickup, PLACES.outsideArea);
      expect(destOutside.body.code).toBe('OUTSIDE_SERVICE_AREA');
      const same = await s.quote(passenger, PLACES.pickup, PLACES.pickup);
      expect(same.body.code).toBe('PICKUP_EQUALS_DESTINATION');
    });

    it('requires the passenger role', async () => {
      const driver = await s.submittedDriver({ name: 'NotAPassenger' });
      const res = await s.quote(driver);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PERMISSION_DENIED');
    });
  });

  describe('ride creation', () => {
    it('rejects proposals below the minimum fare (and leaves the quote usable)', async () => {
      const passenger = await s.registerPassenger('Low');
      const quote = await s.quote(passenger);
      const low = await s.requestRide(passenger, TEST_PRICING.expectedMinimumFareMinor - 1, {
        quoteId: quote.body.id,
      });
      expect(low.status).toBe(422);
      expect(low.body).toMatchObject({
        code: 'FARE_BELOW_MINIMUM',
        minimumFare: { amountMinor: TEST_PRICING.expectedMinimumFareMinor, currency: 'SDG' },
      });
      const ok = await s.requestRide(passenger, TEST_PRICING.expectedMinimumFareMinor, {
        quoteId: quote.body.id,
      });
      expectStatus(ok, 201);
      expect(ok.body.status).toBe('searching');
      expectStatus(
        await s
          .http()
          .post(`/v1/rides/${ok.body.id}/cancel`)
          .set('Authorization', passenger.auth)
          .send({}),
        200,
      );
    });

    it('rejects the wrong currency, a missing idempotency key, reused quotes and other passengers’ quotes', async () => {
      const passenger = await s.registerPassenger('Checks');
      const other = await s.registerPassenger('Other');
      const quote = await s.quote(passenger);

      const usd = await s
        .http()
        .post('/v1/rides')
        .set('Authorization', passenger.auth)
        .set('Idempotency-Key', 'key-currency-1')
        .send({ quoteId: quote.body.id, proposedFare: { amountMinor: 30_000, currency: 'USD' } });
      expect(usd.body.code).toBe('CURRENCY_MISMATCH');

      const noKey = await s
        .http()
        .post('/v1/rides')
        .set('Authorization', passenger.auth)
        .send({ quoteId: quote.body.id, proposedFare: { amountMinor: 30_000, currency: 'SDG' } });
      expect(noKey.status).toBe(400);
      expect(noKey.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

      const stolen = await s.requestRide(other, 30_000, { quoteId: quote.body.id });
      expect(stolen.status).toBe(404);
      expect(stolen.body.code).toBe('QUOTE_NOT_FOUND');

      const first = await s.requestRide(passenger, 30_000, { quoteId: quote.body.id });
      expectStatus(first, 201);
      await s
        .http()
        .post(`/v1/rides/${first.body.id}/cancel`)
        .set('Authorization', passenger.auth)
        .send({});
      const reused = await s.requestRide(passenger, 30_000, { quoteId: quote.body.id });
      expect(reused.status).toBe(409);
      expect(reused.body.code).toBe('QUOTE_ALREADY_USED');
    });

    it('rejects expired quotes using the database clock', async () => {
      const passenger = await s.registerPassenger('Expired');
      const quote = await s.quote(passenger);
      await s.db.admin.query(
        `update taketuk.fare_quotes set created_at = now() - interval '1 hour', expires_at = now() - interval '1 minute' where id = $1`,
        [quote.body.id],
      );
      const res = await s.requestRide(passenger, 30_000, { quoteId: quote.body.id });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('QUOTE_EXPIRED');
    });

    it('allows at most one open ride per passenger', async () => {
      const passenger = await s.registerPassenger('One');
      const first = await s.requestRide(passenger, 25_000);
      expectStatus(first, 201);
      const second = await s.requestRide(passenger, 25_000);
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('RIDE_ALREADY_OPEN');
      await s
        .http()
        .post(`/v1/rides/${first.body.id}/cancel`)
        .set('Authorization', passenger.auth)
        .send({});
    });
  });

  describe('accepting the proposed fare, trip lifecycle, payment and commission', () => {
    let passenger: Person;
    let driver: DriverPerson;
    let rideId: string;

    beforeAll(async () => {
      passenger = await s.registerPassenger('Hiba', '249911111111');
      driver = await s.onlineDriver(admin, { name: 'Musa', at: PLACES.nearPickup });
    });

    it('offers the ride automatically to the eligible nearby driver without confirming anything', async () => {
      const ride = await s.requestRide(passenger, 25_000);
      expectStatus(ride, 201);
      rideId = ride.body.id as string;
      expect(ride.body).toMatchObject({
        status: 'searching',
        proposedFare: { amountMinor: 25_000, currency: 'SDG' },
        minimumFare: { amountMinor: TEST_PRICING.expectedMinimumFareMinor },
        agreedFare: null,
        driver: null,
      });

      const offers = await s.openOffers(driver);
      expect(offers).toEqual([
        expect.objectContaining({
          rideId,
          status: 'pending',
          offeredFare: { amountMinor: 25_000, currency: 'SDG' },
          passenger: { displayName: 'Hiba' },
        }),
      ]);
      const view = await s.http().get(`/v1/rides/${rideId}`).set('Authorization', passenger.auth);
      expect(view.body.status).toBe('searching');
      expect(view.body.negotiation.driversNotified).toBe(1);
    });

    it('confirms the assignment when the driver accepts, recording the fare agreement', async () => {
      const [offer] = await s.openOffers(driver);
      const accepted = await s
        .http()
        .post(`/v1/driver/offers/${offer!.offerId}/accept`)
        .set('Authorization', driver.auth);
      expectStatus(accepted, 200);
      expect(accepted.body).toMatchObject({
        id: rideId,
        status: 'driver_assigned',
        agreedFare: { amountMinor: 25_000, currency: 'SDG' },
        passenger: { displayName: 'Hiba', phoneE164: '+249911111111' },
      });

      const view = await s.http().get(`/v1/rides/${rideId}`).set('Authorization', passenger.auth);
      expect(view.body.driver).toMatchObject({
        displayName: 'Musa',
        vehicle: { vehicleTypeCode: 'raksha' },
      });
      expect(view.body.driver.phoneE164).toMatch(/^\+2499/);

      const { rows } = await s.db.admin.query(
        `select * from taketuk.fare_agreements where ride_id = $1`,
        [rideId],
      );
      expect(rows).toEqual([
        expect.objectContaining({
          basis: 'driver_accepted_passenger_proposal',
          agreed_fare_minor: 25_000,
          passenger_proposed_fare_minor: 25_000,
          driver_counter_fare_minor: null,
          minimum_fare_minor: TEST_PRICING.expectedMinimumFareMinor,
          fare_policy_version: 1,
          route_distance_meters: 2500,
          route_provider: 'test_routing',
        }),
      ]);
    });

    it('lets only the assigned driver move the trip forward; passengers cannot', async () => {
      const passengerTry = await s
        .http()
        .post(`/v1/driver/rides/${rideId}/complete`)
        .set('Authorization', passenger.auth);
      expect(passengerTry.status).toBe(403);
      const otherDriver = await s.onlineDriver(admin, { name: 'Other', at: PLACES.farAway });
      const otherTry = await s
        .http()
        .post(`/v1/driver/rides/${rideId}/arrive`)
        .set('Authorization', otherDriver.auth);
      expect(otherTry.status).toBe(404);
      expect(otherTry.body.code).toBe('RIDE_NOT_FOUND');

      const skipAhead = await s
        .http()
        .post(`/v1/driver/rides/${rideId}/complete`)
        .set('Authorization', driver.auth);
      expect(skipAhead.status).toBe(409);
      expect(skipAhead.body.code).toBe('INVALID_STATE_TRANSITION');

      expectStatus(
        await s.http().post(`/v1/driver/rides/${rideId}/arrive`).set('Authorization', driver.auth),
        200,
      );
      expectStatus(
        await s.http().post(`/v1/driver/rides/${rideId}/start`).set('Authorization', driver.auth),
        200,
      );

      const cancelInProgress = await s
        .http()
        .post(`/v1/rides/${rideId}/cancel`)
        .set('Authorization', passenger.auth)
        .send({});
      expect(cancelInProgress.status).toBe(409);
    });

    it('records a cash obligation and exactly one commission on completion (idempotent)', async () => {
      const completed = await s
        .http()
        .post(`/v1/driver/rides/${rideId}/complete`)
        .set('Authorization', driver.auth);
      expectStatus(completed, 200);
      expect(completed.body.status).toBe('completed');
      expect(completed.body.payment).toMatchObject({
        status: 'awaiting_collection',
        amountDue: { amountMinor: 25_000, currency: 'SDG' },
        amountCollected: null,
      });
      expect(completed.body.passenger.phoneE164).toBeNull();

      const again = await s
        .http()
        .post(`/v1/driver/rides/${rideId}/complete`)
        .set('Authorization', driver.auth);
      expectStatus(again, 200);

      const { rows: payments } = await s.db.admin.query(
        `select * from taketuk.ride_payments where ride_id = $1`,
        [rideId],
      );
      expect(payments).toHaveLength(1);
      const { rows: entries } = await s.db.admin.query<{
        account_type: string;
        amount_minor: number;
      }>(
        `select e.account_type, e.amount_minor from taketuk.ledger_entries e
           join taketuk.ledger_transactions t on t.id = e.transaction_id
          where t.ride_id = $1 order by e.amount_minor desc`,
        [rideId],
      );
      // 10% of 25 000 = 2 500, debit driver receivable / credit platform revenue.
      expect(entries).toEqual([
        { account_type: 'driver_commission_receivable', amount_minor: 2500 },
        { account_type: 'platform_commission_revenue', amount_minor: -2500 },
      ]);
    });

    it('records the reported cash collection separately from the obligation', async () => {
      const report = await s
        .http()
        .post(`/v1/driver/rides/${rideId}/cash-collection`)
        .set('Authorization', driver.auth)
        .send({ outcome: 'collected', amountCollected: { amountMinor: 24_000, currency: 'SDG' } });
      expectStatus(report, 200);
      expect(report.body).toMatchObject({
        status: 'collected',
        amountDue: { amountMinor: 25_000 },
        amountCollected: { amountMinor: 24_000 },
      });

      const same = await s
        .http()
        .post(`/v1/driver/rides/${rideId}/cash-collection`)
        .set('Authorization', driver.auth)
        .send({ outcome: 'collected', amountCollected: { amountMinor: 24_000, currency: 'SDG' } });
      expectStatus(same, 200);
      const different = await s
        .http()
        .post(`/v1/driver/rides/${rideId}/cash-collection`)
        .set('Authorization', driver.auth)
        .send({ outcome: 'not_collected' });
      expect(different.status).toBe(409);
      expect(different.body.code).toBe('PAYMENT_ALREADY_REPORTED');

      const earnings = await s.http().get('/v1/driver/earnings').set('Authorization', driver.auth);
      expectStatus(earnings, 200);
      expect(earnings.body.commissionOwed).toEqual([{ currency: 'SDG', amountMinor: 2500 }]);
      expect(earnings.body.items[0]).toMatchObject({
        rideId,
        agreedFare: { amountMinor: 25_000 },
        amountCollected: { amountMinor: 24_000 },
        commission: { amountMinor: 2500 },
      });
    });

    it('keeps an audit trail of every transition', async () => {
      expect(await s.auditActions(rideId)).toEqual([
        'ride.requested',
        'ride.assigned',
        'ride.driver_arrived',
        'ride.started',
        'ride.completed',
        'finance.ride_commission_charged',
        'finance.cash_collection_reported',
      ]);
    });

    it('delivers notifications through the outbox only after commit', async () => {
      const deviceId = '7d2c8f8e-0a77-4b8e-9d55-3c1c5f0f7a11';
      expectStatus(
        await s
          .http()
          .put(`/v1/me/devices/${deviceId}`)
          .set('Authorization', passenger.auth)
          .send({ app: 'passenger', platform: 'android', pushToken: 'passenger-token-0001' }),
        200,
      );
      const forbidden = await s
        .http()
        .put(`/v1/me/devices/${deviceId}`)
        .set('Authorization', passenger.auth)
        .send({ app: 'driver', platform: 'android', pushToken: 'passenger-token-0001' });
      expect(forbidden.status).toBe(403);

      // Requeue the ride's events to exercise delivery with a registered device.
      await s.db.admin.query(
        `update taketuk.outbox_events set status = 'pending', published_at = null where aggregate_id = $1`,
        [rideId],
      );
      const result = await s.outbox().runOnce();
      expect(result.failed).toBe(0);
      const titles = s.notifications.sent
        .filter((m) => m.tokens.includes('passenger-token-0001'))
        .map((m) => m.message.title);
      expect(titles).toEqual(
        expect.arrayContaining(['Driver assigned', 'Driver arrived', 'Trip completed']),
      );
      expect(
        s.notifications.sent.every(
          (m) => m.message.data.rideId !== undefined || m.message.data.driverId !== undefined,
        ),
      ).toBe(true);
    });
  });

  describe('counteroffers', () => {
    it('confirms only after the passenger accepts a counteroffer, at the counter fare', async () => {
      const passenger = await s.registerPassenger('Counter');
      const driver = await s.onlineDriver(admin, { name: 'Countering', at: PLACES.nearPickup });
      const ride = await s.requestRide(passenger, 23_000);
      expectStatus(ride, 201);
      const offers = await s.openOffers(driver);
      const offer = offers.find((o) => o.rideId === ride.body.id)!;

      const tooLow = await s
        .http()
        .post(`/v1/driver/offers/${offer.offerId}/counteroffer`)
        .set('Authorization', driver.auth)
        .send({
          amount: { amountMinor: TEST_PRICING.expectedMinimumFareMinor - 500, currency: 'SDG' },
        });
      expect(tooLow.body.code).toBe('FARE_BELOW_MINIMUM');
      const notHigher = await s
        .http()
        .post(`/v1/driver/offers/${offer.offerId}/counteroffer`)
        .set('Authorization', driver.auth)
        .send({ amount: { amountMinor: 23_000, currency: 'SDG' } });
      expect(notHigher.body.code).toBe('COUNTEROFFER_NOT_ABOVE_PROPOSAL');

      const countered = await s
        .http()
        .post(`/v1/driver/offers/${offer.offerId}/counteroffer`)
        .set('Authorization', driver.auth)
        .send({ amount: { amountMinor: 30_000, currency: 'SDG' } });
      expectStatus(countered, 200);
      expect(countered.body).toMatchObject({
        status: 'countered',
        counterFare: { amountMinor: 30_000 },
      });

      // Countering does not confirm anything.
      const pending = await s
        .http()
        .get(`/v1/rides/${ride.body.id}`)
        .set('Authorization', passenger.auth);
      expect(pending.body.status).toBe('searching');
      expect(pending.body.negotiation.counteroffers).toEqual([
        expect.objectContaining({
          offerId: offer.offerId,
          status: 'countered',
          amount: { amountMinor: 30_000, currency: 'SDG' },
          driverDisplayName: 'Countering',
          vehicleTypeCode: 'raksha',
        }),
      ]);
      expect(pending.body.driver).toBeNull();

      // The driver cannot accept on the passenger's behalf.
      const selfAccept = await s
        .http()
        .post(`/v1/driver/offers/${offer.offerId}/accept`)
        .set('Authorization', driver.auth);
      expect(selfAccept.status).toBe(409);
      expect(selfAccept.body.code).toBe('OFFER_NOT_OPEN');

      const accepted = await s
        .http()
        .post(`/v1/rides/${ride.body.id}/offers/${offer.offerId}/accept-counteroffer`)
        .set('Authorization', passenger.auth);
      expectStatus(accepted, 200);
      expect(accepted.body).toMatchObject({
        status: 'driver_assigned',
        agreedFare: { amountMinor: 30_000, currency: 'SDG' },
        proposedFare: { amountMinor: 23_000 },
      });
      const { rows } = await s.db.admin.query(
        `select basis, agreed_fare_minor, driver_counter_fare_minor from taketuk.fare_agreements where ride_id = $1`,
        [ride.body.id],
      );
      expect(rows).toEqual([
        {
          basis: 'passenger_accepted_driver_counteroffer',
          agreed_fare_minor: 30_000,
          driver_counter_fare_minor: 30_000,
        },
      ]);

      // Retrying the acceptance is harmless.
      const retry = await s
        .http()
        .post(`/v1/rides/${ride.body.id}/offers/${offer.offerId}/accept-counteroffer`)
        .set('Authorization', passenger.auth);
      expectStatus(retry, 200);
      expect(retry.body.status).toBe('driver_assigned');

      // Driver cancels before arrival: ride ends as cancelled (no re-dispatch in v1; DSP-3).
      const cancelled = await s
        .http()
        .post(`/v1/driver/rides/${ride.body.id}/cancel`)
        .set('Authorization', driver.auth)
        .send({ reason: 'Vehicle broke down' });
      expectStatus(cancelled, 200);
      expect(cancelled.body).toMatchObject({
        status: 'cancelled',
        cancellation: {
          cancelledByRole: 'driver',
          statusBeforeCancellation: 'driver_assigned',
          reason: 'Vehicle broke down',
        },
      });
      const { rows: assignment } = await s.db.admin.query(
        `select status from taketuk.ride_assignments where ride_id = $1`,
        [ride.body.id],
      );
      expect(assignment).toEqual([{ status: 'cancelled' }]);
    });

    it('lets the passenger reject a counteroffer and re-dispatches to other drivers', async () => {
      const passenger = await s.registerPassenger('Rejecting');
      const first = await s.onlineDriver(admin, { name: 'First', at: PLACES.nearPickup });
      const ride = await s.requestRide(passenger, 23_000);
      const rideId = ride.body.id as string;
      // Other online drivers from earlier tests may have received offers too; take this driver's.
      const offer = (await s.openOffers(first)).find((o) => o.rideId === rideId)!;
      expectStatus(
        await s
          .http()
          .post(`/v1/driver/offers/${offer.offerId}/counteroffer`)
          .set('Authorization', first.auth)
          .send({ amount: { amountMinor: 40_000, currency: 'SDG' } }),
        200,
      );
      const rejected = await s
        .http()
        .post(`/v1/rides/${rideId}/offers/${offer.offerId}/reject-counteroffer`)
        .set('Authorization', passenger.auth);
      expectStatus(rejected, 200);
      expect(rejected.body.negotiation.counteroffers[0].status).toBe('counter_rejected');

      // A new driver comes online; once open offers close, the next round reaches them.
      const second = await s.onlineDriver(admin, { name: 'Second', at: PLACES.midDistance });
      await s.expireOffers(rideId);
      await s.dispatch().sweep();
      const secondOffers = await s.openOffers(second);
      expect(secondOffers.map((o) => o.rideId)).toContain(rideId);
      // The first driver is never re-offered the same ride.
      expect((await s.openOffers(first)).map((o) => o.rideId)).not.toContain(rideId);
      await s
        .http()
        .post(`/v1/rides/${rideId}/cancel`)
        .set('Authorization', passenger.auth)
        .send({ reason: 'changed plans' });
    });
  });

  describe('timeouts', () => {
    it('never accepts an offer past its response window, even before the sweeper runs', async () => {
      const passenger = await s.registerPassenger('Late');
      const driver = await s.onlineDriver(admin, { name: 'Slow', at: PLACES.nearPickup });
      const ride = await s.requestRide(passenger, 25_000);
      const offer = (await s.openOffers(driver)).find((o) => o.rideId === ride.body.id)!;
      await s.expireOffers(ride.body.id as string);
      const late = await s
        .http()
        .post(`/v1/driver/offers/${offer.offerId}/accept`)
        .set('Authorization', driver.auth);
      expect(late.status).toBe(409);
      expect(late.body.code).toBe('OFFER_EXPIRED');
      await s
        .http()
        .post(`/v1/rides/${ride.body.id}/cancel`)
        .set('Authorization', passenger.auth)
        .send({});
    });

    it('expires a ride whose search window elapsed without agreement', async () => {
      const passenger = await s.registerPassenger('NoDriver');
      const ride = await s.requestRide(passenger, 25_000);
      await s.expireSearch(ride.body.id as string);
      const sweep = await s.dispatch().sweep();
      expect(sweep.ridesExpired).toBeGreaterThanOrEqual(1);
      const view = await s
        .http()
        .get(`/v1/rides/${ride.body.id}`)
        .set('Authorization', passenger.auth);
      expect(view.body.status).toBe('expired');
      const { rows } = await s.db.admin.query(
        `select count(*)::int as open from taketuk.ride_offers where ride_id = $1 and status in ('pending', 'countered')`,
        [ride.body.id],
      );
      expect(rows[0].open).toBe(0);
    });
  });

  describe('passenger privacy and access', () => {
    it('hides other passengers’ rides (404) and lists only the caller’s rides', async () => {
      const owner = await s.registerPassenger('Owner');
      const intruder = await s.registerPassenger('Intruder');
      const ride = await s.requestRide(owner, 25_000);
      const peek = await s
        .http()
        .get(`/v1/rides/${ride.body.id}`)
        .set('Authorization', intruder.auth);
      expect(peek.status).toBe(404);
      const cancel = await s
        .http()
        .post(`/v1/rides/${ride.body.id}/cancel`)
        .set('Authorization', intruder.auth)
        .send({});
      expect(cancel.status).toBe(404);
      const list = await s.http().get('/v1/rides').set('Authorization', intruder.auth);
      expect(list.body.items).toEqual([]);
      const ownerList = await s.http().get('/v1/rides?limit=1').set('Authorization', owner.auth);
      expect(ownerList.body.items.map((r: { id: string }) => r.id)).toEqual([ride.body.id]);
      await s
        .http()
        .post(`/v1/rides/${ride.body.id}/cancel`)
        .set('Authorization', owner.auth)
        .send({});
    });
  });
});
