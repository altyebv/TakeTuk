import { randomUUID } from 'node:crypto';
import { expectStatus, PLACES, Scenario, type Person } from '../support/scenario';

describe('driver onboarding, verification and matching', () => {
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

  describe('registration and verification', () => {
    it('registers idempotently and rejects conflicting re-registration', async () => {
      const userId = randomUUID();
      const auth = await s.bearer(userId, '249912345000');
      const body = {
        displayName: 'Adam',
        fullLegalName: 'Adam  Ibrahim',
        drivingLicenseNumber: ' dl 123 ',
        serviceAreaCode: 'test_city',
      };
      const first = await s
        .http()
        .post('/v1/driver/registration')
        .set('Authorization', auth)
        .send(body);
      expectStatus(first, 201);
      expect(first.body).toMatchObject({
        status: 'applicant',
        fullLegalName: 'Adam Ibrahim',
        drivingLicenseNumber: 'DL 123',
        availability: 'offline',
      });
      expectStatus(
        await s.http().post('/v1/driver/registration').set('Authorization', auth).send(body),
        200,
      );
      const conflicting = await s
        .http()
        .post('/v1/driver/registration')
        .set('Authorization', auth)
        .send({ ...body, drivingLicenseNumber: 'OTHER-1' });
      expect(conflicting.status).toBe(409);
      expect(conflicting.body.code).toBe('ALREADY_REGISTERED');
      const unknownArea = await s
        .http()
        .post('/v1/driver/registration')
        .set('Authorization', await s.bearer(randomUUID()))
        .send({ ...body, serviceAreaCode: 'atlantis' });
      expect(unknownArea.body.code).toBe('SERVICE_AREA_NOT_FOUND');
    });

    it('requires the documents and a vehicle before submission', async () => {
      const userId = randomUUID();
      const driver = { userId, auth: await s.bearer(userId), vehicleId: '' };
      expectStatus(
        await s.http().post('/v1/driver/registration').set('Authorization', driver.auth).send({
          displayName: 'Incomplete',
          fullLegalName: 'Incomplete Driver',
          drivingLicenseNumber: 'DL-INC-1',
          serviceAreaCode: 'test_city',
        }),
        201,
      );
      const empty = await s
        .http()
        .post('/v1/driver/verification/submit')
        .set('Authorization', driver.auth);
      expect(empty.status).toBe(422);
      expect(empty.body.code).toBe('VERIFICATION_REQUIREMENTS_NOT_MET');
      expect(empty.body.missing).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ scope: 'driver', documentType: 'driving_license' }),
          expect.objectContaining({ scope: 'vehicle', reason: 'no vehicle registered' }),
        ]),
      );

      // Uploads must exist in storage before confirmation.
      const slot = await s
        .http()
        .post('/v1/driver/documents/upload-requests')
        .set('Authorization', driver.auth)
        .send({ documentType: 'driver_photo', contentType: 'image/png' });
      expectStatus(slot, 201);
      expect(slot.body.upload).toMatchObject({
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
      });
      // Document metadata never exposes bucket or path; only the signed URL encodes the object.
      expect(Object.keys(slot.body.document as object).sort()).toEqual([
        'contentType',
        'createdAt',
        'documentType',
        'id',
        'status',
        'uploadedAt',
        'vehicleId',
      ]);
      const premature = await s
        .http()
        .post(`/v1/driver/documents/${slot.body.document.id}/confirm`)
        .set('Authorization', driver.auth);
      expect(premature.status).toBe(409);
      expect(premature.body.code).toBe('DOCUMENT_NOT_UPLOADED');

      // vehicleId is required exactly for vehicle documents.
      const noVehicle = await s
        .http()
        .post('/v1/driver/documents/upload-requests')
        .set('Authorization', driver.auth)
        .send({ documentType: 'vehicle_photo', contentType: 'image/jpeg' });
      expect(noVehicle.status).toBe(400);
    });

    it('hides other drivers’ documents', async () => {
      const a = await s.submittedDriver({ name: 'DocOwner' });
      const b = await s.submittedDriver({ name: 'DocSnoop' });
      const docs = await s.http().get('/v1/driver/documents').set('Authorization', a.auth);
      const docId = docs.body.items[0].id as string;
      const snoop = await s
        .http()
        .post(`/v1/driver/documents/${docId}/confirm`)
        .set('Authorization', b.auth);
      expect(snoop.status).toBe(404);
    });

    it('only lets admins review, forbids self-review, and audits document views', async () => {
      const driver = await s.submittedDriver({ name: 'Reviewed' });
      const profile = await s.http().get('/v1/driver/profile').set('Authorization', driver.auth);
      expect(profile.body.status).toBe('pending_review');

      // A driver cannot approve themselves or anyone else.
      const selfApprove = await s
        .http()
        .post(`/v1/admin/drivers/${driver.userId}/approve`)
        .set('Authorization', driver.auth)
        .send({});
      expect(selfApprove.status).toBe(403);
      expect(selfApprove.body.code).toBe('PERMISSION_DENIED');

      // An admin who is also the driver cannot review their own submission.
      await s.db.admin.query(
        `insert into taketuk.user_roles (user_id, role) values ($1, 'admin')`,
        [driver.userId],
      );
      const adminSelf = await s
        .http()
        .post(`/v1/admin/drivers/${driver.userId}/approve`)
        .set('Authorization', driver.auth)
        .send({});
      expect(adminSelf.status).toBe(403);
      expect(adminSelf.body.code).toBe('SELF_REVIEW_FORBIDDEN');
      await s.db.admin.query(
        `delete from taketuk.user_roles where user_id = $1 and role = 'admin'`,
        [driver.userId],
      );

      const rejectNoNote = await s
        .http()
        .post(`/v1/admin/drivers/${driver.userId}/reject`)
        .set('Authorization', admin.auth)
        .send({});
      expect(rejectNoNote.status).toBe(400);

      const review = await s
        .http()
        .get(`/v1/admin/drivers/${driver.userId}`)
        .set('Authorization', admin.auth);
      expectStatus(review, 200);
      expect(review.body.documents).toHaveLength(5);
      const docId = review.body.documents[0].id as string;
      const view = await s
        .http()
        .get(`/v1/admin/drivers/${driver.userId}/documents/${docId}/view-url`)
        .set('Authorization', admin.auth);
      expectStatus(view, 200);
      expect(view.body.url).toMatch(/^memory:\/\//);
      expect(await s.auditActions(docId)).toContain('driver_document.viewed');

      const queue = await s
        .http()
        .get('/v1/admin/drivers?status=pending_review')
        .set('Authorization', admin.auth);
      expect((queue.body.items as Array<{ userId: string }>).map((d) => d.userId)).toContain(
        driver.userId,
      );

      expectStatus(
        await s
          .http()
          .post(`/v1/admin/drivers/${driver.userId}/reject`)
          .set('Authorization', admin.auth)
          .send({ note: 'Licence photo unreadable' }),
        200,
      );
      const rejected = await s.http().get('/v1/driver/profile').set('Authorization', driver.auth);
      expect(rejected.body).toMatchObject({
        status: 'rejected',
        reviewNote: 'Licence photo unreadable',
      });

      // Rejected drivers may edit and resubmit.
      expectStatus(
        await s
          .http()
          .patch('/v1/driver/profile')
          .set('Authorization', driver.auth)
          .send({ drivingLicenseNumber: 'DL-NEW-9' }),
        200,
      );
      expectStatus(
        await s.http().post('/v1/driver/verification/submit').set('Authorization', driver.auth),
        200,
      );
      expectStatus(
        await s
          .http()
          .post(`/v1/admin/drivers/${driver.userId}/approve`)
          .set('Authorization', admin.auth)
          .send({}),
        200,
      );
      const approvedEdit = await s
        .http()
        .patch('/v1/driver/profile')
        .set('Authorization', driver.auth)
        .send({ fullLegalName: 'Changed Name' });
      expect(approvedEdit.status).toBe(409);
      expect(approvedEdit.body.code).toBe('PROFILE_NOT_EDITABLE');
      expect(await s.auditActions(driver.userId)).toEqual(
        expect.arrayContaining([
          'driver.registered',
          'driver.submitted_for_review',
          'driver.rejected',
          'driver.approved',
        ]),
      );
    });
  });

  describe('availability and location', () => {
    it('requires approval and an approved, owned vehicle to go online', async () => {
      const driver = await s.submittedDriver({ name: 'Eager' });
      const early = await s
        .http()
        .put('/v1/driver/availability')
        .set('Authorization', driver.auth)
        .send({ availability: 'online', vehicleId: driver.vehicleId });
      expect(early.status).toBe(403);
      expect(early.body.code).toBe('DRIVER_NOT_APPROVED');
      const earlyLocation = await s
        .http()
        .put('/v1/driver/location')
        .set('Authorization', driver.auth)
        .send({ ...PLACES.nearPickup, recordedAt: new Date().toISOString() });
      expect(earlyLocation.body.code).toBe('DRIVER_NOT_APPROVED');

      expectStatus(
        await s
          .http()
          .post(`/v1/admin/drivers/${driver.userId}/approve`)
          .set('Authorization', admin.auth)
          .send({}),
        200,
      );
      const unapprovedVehicle = await s
        .http()
        .put('/v1/driver/availability')
        .set('Authorization', driver.auth)
        .send({ availability: 'online', vehicleId: driver.vehicleId });
      expect(unapprovedVehicle.status).toBe(422);
      expect(unapprovedVehicle.body.code).toBe('VEHICLE_NOT_ELIGIBLE');

      const someoneElses = await s.submittedDriver({ name: 'OtherOwner' });
      const notMine = await s
        .http()
        .put('/v1/driver/availability')
        .set('Authorization', driver.auth)
        .send({ availability: 'online', vehicleId: someoneElses.vehicleId });
      expect(notMine.status).toBe(404);

      expectStatus(
        await s
          .http()
          .post(`/v1/admin/vehicles/${driver.vehicleId}/approve`)
          .set('Authorization', admin.auth)
          .send({}),
        200,
      );
      const online = await s
        .http()
        .put('/v1/driver/availability')
        .set('Authorization', driver.auth)
        .send({ availability: 'online', vehicleId: driver.vehicleId });
      expectStatus(online, 200);
      expect(online.body).toMatchObject({
        availability: 'online',
        activeVehicleId: driver.vehicleId,
      });

      const future = await s
        .http()
        .put('/v1/driver/location')
        .set('Authorization', driver.auth)
        .send({ ...PLACES.nearPickup, recordedAt: new Date(Date.now() + 3_600_000).toISOString() });
      expect(future.status).toBe(400);
    });

    it('forces suspended drivers offline and lets the sweeper withdraw their open offers', async () => {
      const driver = await s.onlineDriver(admin, { name: 'ToSuspend', at: PLACES.nearPickup });
      const passenger = await s.registerPassenger('SuspendCase');
      const ride = await s.requestRide(passenger, 25_000);
      const offer = (await s.openOffers(driver)).find((o) => o.rideId === ride.body.id)!;
      expect(offer).toBeDefined();

      expectStatus(
        await s
          .http()
          .post(`/v1/admin/drivers/${driver.userId}/suspend`)
          .set('Authorization', admin.auth)
          .send({ note: 'Safety complaint under review' }),
        200,
      );
      const profile = await s.http().get('/v1/driver/profile').set('Authorization', driver.auth);
      expect(profile.body).toMatchObject({ status: 'suspended', availability: 'offline' });

      // Even before the sweeper runs, the suspended driver cannot accept.
      const accept = await s
        .http()
        .post(`/v1/driver/offers/${offer.offerId}/accept`)
        .set('Authorization', driver.auth);
      expect(accept.status).toBe(403);
      expect(accept.body.code).toBe('DRIVER_NOT_APPROVED');

      await s.dispatch().sweep();
      const { rows } = await s.db.admin.query(
        `select status from taketuk.ride_offers where id = $1`,
        [offer.offerId],
      );
      expect(rows[0].status).toBe('withdrawn');

      expectStatus(
        await s
          .http()
          .post(`/v1/admin/drivers/${driver.userId}/reinstate`)
          .set('Authorization', admin.auth)
          .send({}),
        200,
      );
      await s
        .http()
        .post(`/v1/rides/${ride.body.id}/cancel`)
        .set('Authorization', passenger.auth)
        .send({});
    });

    it('sets the driver offline when their active vehicle is suspended', async () => {
      const driver = await s.onlineDriver(admin, { name: 'VehicleSuspended', at: PLACES.farAway });
      expectStatus(
        await s
          .http()
          .post(`/v1/admin/vehicles/${driver.vehicleId}/suspend`)
          .set('Authorization', admin.auth)
          .send({ note: 'Failed inspection' }),
        200,
      );
      const profile = await s.http().get('/v1/driver/profile').set('Authorization', driver.auth);
      expect(profile.body.availability).toBe('offline');
      const back = await s
        .http()
        .put('/v1/driver/availability')
        .set('Authorization', driver.auth)
        .send({ availability: 'online' });
      expect(back.body.code).toBe('VEHICLE_NOT_ELIGIBLE');
    });
  });

  describe('matching eligibility', () => {
    it('offers only to approved, online, compatible, nearby drivers with fresh positions and no job', async () => {
      // Every driver created below is a candidate except for exactly one disqualifying property.
      const eligible = await s.onlineDriver(admin, { name: 'Eligible', at: PLACES.nearPickup });
      const far = await s.onlineDriver(admin, { name: 'Far', at: PLACES.farAway });
      const stale = await s.onlineDriver(admin, { name: 'Stale', at: PLACES.nearPickup });
      await s.db.admin.query(
        `update taketuk.driver_locations set received_at = now() - interval '10 minutes' where driver_id = $1`,
        [stale.userId],
      );
      const offline = await s.onlineDriver(admin, { name: 'Offline', at: PLACES.nearPickup });
      expectStatus(
        await s
          .http()
          .put('/v1/driver/availability')
          .set('Authorization', offline.auth)
          .send({ availability: 'offline' }),
        200,
      );
      const moto = await s.onlineDriver(admin, {
        name: 'Moto',
        vehicleType: 'motorcycle',
        at: PLACES.nearPickup,
      });
      const pickupTruck = await s.onlineDriver(admin, {
        name: 'Pickup',
        vehicleType: 'pickup',
        at: PLACES.nearPickup,
      });
      const unapproved = await s.submittedDriver({ name: 'Unapproved' });
      await s.db.admin.query(
        `insert into taketuk.driver_locations (driver_id, location, device_recorded_at)
         values ($1, extensions.st_setsrid(extensions.st_makepoint(33.521, 14.402), 4326)::extensions.geography, now())`,
        [unapproved.userId],
      );

      const passenger = await s.registerPassenger('Matcher');
      const ride = await s.requestRide(passenger, 25_000);
      expectStatus(ride, 201);
      const { rows } = await s.db.admin.query<{ driver_id: string }>(
        `select driver_id from taketuk.ride_offers where ride_id = $1`,
        [ride.body.id],
      );
      const offered = rows.map((r) => r.driver_id);
      expect(offered).toContain(eligible.userId);
      for (const excluded of [far, stale, offline, moto, pickupTruck, unapproved]) {
        expect(offered).not.toContain(excluded.userId);
      }
      // Motorcycles and pickups never receive passenger transport offers (PRD §3).
      await s
        .http()
        .post(`/v1/rides/${ride.body.id}/cancel`)
        .set('Authorization', passenger.auth)
        .send({});
    });

    it('never offers a passenger their own ride when they are also a driver', async () => {
      const driver = await s.onlineDriver(admin, { name: 'Both roles', at: PLACES.nearPickup });
      // Adding the passenger role to an existing user is a change: 201.
      expectStatus(
        await s
          .http()
          .post('/v1/passenger/registration')
          .set('Authorization', driver.auth)
          .send({ displayName: 'Both roles' }),
        201,
      );
      const ride = await s.requestRide(driver, 25_000);
      expectStatus(ride, 201);
      const { rows } = await s.db.admin.query(
        `select driver_id from taketuk.ride_offers where ride_id = $1 and driver_id = $2`,
        [ride.body.id, driver.userId],
      );
      expect(rows).toEqual([]);
      await s
        .http()
        .post(`/v1/rides/${ride.body.id}/cancel`)
        .set('Authorization', driver.auth)
        .send({});
    });

    it('postpones dispatch when nobody is eligible and offers later when a driver appears', async () => {
      await s.db.admin.query(`update taketuk.drivers set availability = 'offline'`);
      const passenger = await s.registerPassenger('Waiting');
      const ride = await s.requestRide(passenger, 25_000);
      const rideId = ride.body.id as string;
      const { rows: none } = await s.db.admin.query(
        `select count(*)::int as n from taketuk.ride_offers where ride_id = $1`,
        [rideId],
      );
      expect(none[0].n).toBe(0);
      const late = await s.onlineDriver(admin, { name: 'Late arrival', at: PLACES.midDistance });
      await s.db.admin.query(`update taketuk.rides set next_dispatch_at = now() where id = $1`, [
        rideId,
      ]);
      const sweep = await s.dispatch().sweep();
      expect(sweep.rounds).toEqual(
        expect.arrayContaining([expect.objectContaining({ rideId, outcome: 'offered' })]),
      );
      expect((await s.openOffers(late)).map((o) => o.rideId)).toContain(rideId);
    });
  });
});
