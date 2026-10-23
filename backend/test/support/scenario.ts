import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { DOCUMENT_STORAGE, InMemoryDocumentStorage } from '../../src/modules/drivers';
import { ROUTING_PROVIDER } from '../../src/modules/geography';
import { DispatchService } from '../../src/modules/mobility';
import { NOTIFICATION_PROVIDER, LogNotificationProvider } from '../../src/modules/notifications';
import { OutboxWorker } from '../../src/platform/outbox';
import { ControllableRoutingProvider } from './controllable-routing';
import { createTestApp, type TestApp } from './test-app';
import { createTestDatabase, type TestDatabase } from './test-database';
import { TestTokens } from './test-tokens';

/** Points inside the test service area (around Wad Madani; coordinates are illustrative). */
export const PLACES = {
  pickup: { lat: 14.4, lng: 33.52 },
  destination: { lat: 14.42, lng: 33.53 },
  nearPickup: { lat: 14.402, lng: 33.521 }, // ~250 m from pickup
  midDistance: { lat: 14.41, lng: 33.52 }, // ~1.1 km
  farAway: { lat: 14.46, lng: 33.58 }, // ~9 km: outside the 3 km dispatch radius
  outsideArea: { lat: 15.6, lng: 32.53 }, // Khartoum: outside the test service area
} as const;

/** Test pricing (deliberately arbitrary). With the 2 500 m test route the minimum fare is 22 500. */
export const TEST_PRICING = {
  currency: 'SDG',
  baseFareMinor: 10_000,
  perKmFareMinor: 5_000,
  minimumFareMinor: 20_000,
  roundingIncrementMinor: 500,
  commissionBasisPoints: 1_000,
  expectedMinimumFareMinor: 22_500,
} as const;

export interface Person {
  readonly userId: string;
  readonly auth: string;
}

export interface DriverPerson extends Person {
  readonly vehicleId: string;
}

export class Scenario {
  private constructor(
    readonly db: TestDatabase,
    readonly tokens: TestTokens,
    readonly app: TestApp,
    readonly routing: ControllableRoutingProvider,
    readonly storage: InMemoryDocumentStorage,
    readonly notifications: LogNotificationProvider,
  ) {}

  static async create(options: { env?: Record<string, string> } = {}): Promise<Scenario> {
    const db = await createTestDatabase();
    const tokens = await TestTokens.create();
    const routing = new ControllableRoutingProvider();
    const storage = new InMemoryDocumentStorage();
    const notifications = new LogNotificationProvider();
    const app = await createTestApp(db, tokens, {
      ...(options.env ? { env: options.env } : {}),
      overrides: [
        { token: ROUTING_PROVIDER, value: routing },
        { token: DOCUMENT_STORAGE, value: storage },
        { token: NOTIFICATION_PROVIDER, value: notifications },
      ],
    });
    return new Scenario(db, tokens, app, routing, storage, notifications);
  }

  async close(): Promise<void> {
    await this.app.close();
    await this.db.drop();
  }

  http() {
    return this.app.http();
  }

  dispatch(): DispatchService {
    return this.app.get(DispatchService);
  }

  outbox(): OutboxWorker {
    return this.app.get(OutboxWorker);
  }

  async bearer(userId: string, phone?: string): Promise<string> {
    return `Bearer ${await this.tokens.sign(userId, phone ? { phone } : {})}`;
  }

  /** A test service area covering the Wad Madani test box, offering passenger transport. */
  async createServiceArea(code = 'test_city'): Promise<string> {
    const { rows } = await this.db.admin.query<{ id: string }>(
      `insert into taketuk.service_areas (code, display_name, timezone, boundary, status)
       values ($1, 'Test city', 'Africa/Khartoum',
               extensions.st_geogfromtext('MULTIPOLYGON(((33.45 14.33, 33.60 14.33, 33.60 14.47, 33.45 14.47, 33.45 14.33)))'),
               'active')
       returning id`,
      [code],
    );
    const id = rows[0]!.id;
    await this.db.admin.query(
      `insert into taketuk.service_area_services (service_area_id, service_type_code) values ($1, 'passenger_transport')`,
      [id],
    );
    return id;
  }

  /** Admins are granted by operators only (no API); fixtures use SQL like the operator CLI. */
  async createAdmin(name = 'Admin'): Promise<Person> {
    const userId = randomUUID();
    await this.db.admin.query(`insert into taketuk.users (id, display_name) values ($1, $2)`, [
      userId,
      name,
    ]);
    await this.db.admin.query(
      `insert into taketuk.user_roles (user_id, role) values ($1, 'admin')`,
      [userId],
    );
    return { userId, auth: await this.bearer(userId) };
  }

  async configurePricing(
    admin: Person,
    areaCode = 'test_city',
  ): Promise<{ farePolicyId: string; commissionPolicyId: string }> {
    const fare = await this.http()
      .post('/v1/admin/fare-policies')
      .set('Authorization', admin.auth)
      .send({
        serviceAreaCode: areaCode,
        serviceTypeCode: 'passenger_transport',
        currency: TEST_PRICING.currency,
        baseFareMinor: TEST_PRICING.baseFareMinor,
        perKmFareMinor: TEST_PRICING.perKmFareMinor,
        minimumFareMinor: TEST_PRICING.minimumFareMinor,
        roundingIncrementMinor: TEST_PRICING.roundingIncrementMinor,
        notes: 'test values',
      });
    expectStatus(fare, 201);
    expectStatus(
      await this.http()
        .post(`/v1/admin/fare-policies/${fare.body.id}/activate`)
        .set('Authorization', admin.auth),
      200,
    );
    const commission = await this.http()
      .post('/v1/admin/commission-policies')
      .set('Authorization', admin.auth)
      .send({
        serviceAreaCode: areaCode,
        serviceTypeCode: 'passenger_transport',
        rateBasisPoints: TEST_PRICING.commissionBasisPoints,
      });
    expectStatus(commission, 201);
    expectStatus(
      await this.http()
        .post(`/v1/admin/commission-policies/${commission.body.id}/activate`)
        .set('Authorization', admin.auth),
      200,
    );
    return {
      farePolicyId: fare.body.id as string,
      commissionPolicyId: commission.body.id as string,
    };
  }

  async registerPassenger(name = 'Passenger', phone?: string): Promise<Person> {
    const userId = randomUUID();
    const auth = await this.bearer(
      userId,
      phone ?? `2499${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    );
    expectStatus(
      await this.http()
        .post('/v1/passenger/registration')
        .set('Authorization', auth)
        .send({ displayName: name }),
      201,
    );
    return { userId, auth };
  }

  /** Registers a driver applicant with one vehicle and all required documents, then submits. */
  async submittedDriver(
    options: { name?: string; vehicleType?: string; plate?: string; areaCode?: string } = {},
  ): Promise<DriverPerson> {
    const userId = randomUUID();
    const auth = await this.bearer(
      userId,
      `2499${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    );
    const name = options.name ?? 'Driver';
    expectStatus(
      await this.http()
        .post('/v1/driver/registration')
        .set('Authorization', auth)
        .send({
          displayName: name,
          fullLegalName: `${name} Full Name`,
          drivingLicenseNumber: `DL-${userId.slice(0, 8)}`,
          serviceAreaCode: options.areaCode ?? 'test_city',
        }),
      201,
    );
    const vehicle = await this.http()
      .post('/v1/driver/vehicles')
      .set('Authorization', auth)
      .send({
        vehicleTypeCode: options.vehicleType ?? 'raksha',
        plateNumber: options.plate ?? `GZ ${userId.slice(0, 6)}`,
      });
    expectStatus(vehicle, 201);
    const vehicleId = vehicle.body.id as string;

    for (const documentType of ['driver_photo', 'driving_license', 'national_id']) {
      await this.uploadDocument({ userId, auth, vehicleId }, documentType);
    }
    for (const documentType of ['vehicle_registration', 'vehicle_photo']) {
      await this.uploadDocument({ userId, auth, vehicleId }, documentType, vehicleId);
    }
    expectStatus(
      await this.http().post('/v1/driver/verification/submit').set('Authorization', auth),
      200,
    );
    return { userId, auth, vehicleId };
  }

  async uploadDocument(
    driver: DriverPerson,
    documentType: string,
    vehicleId?: string,
  ): Promise<string> {
    const request = await this.http()
      .post('/v1/driver/documents/upload-requests')
      .set('Authorization', driver.auth)
      .send({ documentType, contentType: 'image/jpeg', ...(vehicleId ? { vehicleId } : {}) });
    expectStatus(request, 201);
    const documentId = request.body.document.id as string;
    // Simulate the client's direct PUT to the signed URL.
    const { rows } = await this.db.admin.query<{ storage_bucket: string; storage_path: string }>(
      `select storage_bucket, storage_path from taketuk.driver_documents where id = $1`,
      [documentId],
    );
    this.storage.markUploaded(rows[0]!.storage_bucket, rows[0]!.storage_path);
    expectStatus(
      await this.http()
        .post(`/v1/driver/documents/${documentId}/confirm`)
        .set('Authorization', driver.auth),
      200,
    );
    return documentId;
  }

  /** A fully approved, online driver with a fresh position. */
  async onlineDriver(
    admin: Person,
    options: { name?: string; vehicleType?: string; at?: { lat: number; lng: number } } = {},
  ): Promise<DriverPerson> {
    const driver = await this.submittedDriver(options);
    expectStatus(
      await this.http()
        .post(`/v1/admin/drivers/${driver.userId}/approve`)
        .set('Authorization', admin.auth)
        .send({}),
      200,
    );
    expectStatus(
      await this.http()
        .post(`/v1/admin/vehicles/${driver.vehicleId}/approve`)
        .set('Authorization', admin.auth)
        .send({}),
      200,
    );
    expectStatus(
      await this.http()
        .put('/v1/driver/availability')
        .set('Authorization', driver.auth)
        .send({ availability: 'online', vehicleId: driver.vehicleId }),
      200,
    );
    await this.reportLocation(driver, options.at ?? PLACES.nearPickup);
    return driver;
  }

  async reportLocation(driver: Person, at: { lat: number; lng: number }): Promise<void> {
    expectStatus(
      await this.http()
        .put('/v1/driver/location')
        .set('Authorization', driver.auth)
        .send({ ...at, accuracyMeters: 10, recordedAt: new Date().toISOString() }),
      200,
    );
  }

  async quote(
    passenger: Person,
    from: { lat: number; lng: number } = PLACES.pickup,
    to: { lat: number; lng: number } = PLACES.destination,
  ): Promise<Response> {
    return this.http()
      .post('/v1/fare-quotes')
      .set('Authorization', passenger.auth)
      .send({
        pickup: from,
        destination: to,
        pickupLabel: 'University main gate',
        destinationLabel: 'Souq',
      });
  }

  async requestRide(
    passenger: Person,
    amountMinor: number,
    options: { key?: string; quoteId?: string } = {},
  ): Promise<Response> {
    let quoteId = options.quoteId;
    if (!quoteId) {
      const quote = await this.quote(passenger);
      expectStatus(quote, 201);
      quoteId = quote.body.id as string;
    }
    return this.http()
      .post('/v1/rides')
      .set('Authorization', passenger.auth)
      .set('Idempotency-Key', options.key ?? `ride-${randomUUID()}`)
      .send({ quoteId, proposedFare: { amountMinor, currency: TEST_PRICING.currency } });
  }

  async openOffers(
    driver: Person,
  ): Promise<Array<{ offerId: string; rideId: string; status: string }>> {
    const res = await this.http().get('/v1/driver/offers').set('Authorization', driver.auth);
    expectStatus(res, 200);
    return res.body.items as Array<{ offerId: string; rideId: string; status: string }>;
  }

  /** Moves database time-based state into the past (tests cannot wait for real timeouts). */
  async expireOffers(rideId: string): Promise<void> {
    await this.db.admin.query(
      `update taketuk.ride_offers set expires_at = now() - interval '1 second'
        where ride_id = $1 and status in ('pending', 'countered')`,
      [rideId],
    );
  }

  async expireSearch(rideId: string): Promise<void> {
    await this.db.admin.query(
      `update taketuk.rides set search_expires_at = now() - interval '1 second' where id = $1`,
      [rideId],
    );
  }

  async auditActions(entityId: string): Promise<string[]> {
    const { rows } = await this.db.admin.query<{ action: string }>(
      `select action from taketuk.audit_events where entity_id = $1 order by id`,
      [entityId],
    );
    return rows.map((r) => r.action);
  }
}

/** Assertion with the response body in the failure message (easier debugging than supertest's). */
export function expectStatus(res: Response, status: number): void {
  if (res.status !== status) {
    throw new Error(`Expected HTTP ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
}
