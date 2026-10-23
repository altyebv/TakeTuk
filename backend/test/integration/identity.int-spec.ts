import { randomUUID } from 'node:crypto';
import { createTestApp, type TestApp } from '../support/test-app';
import { createTestDatabase, type TestDatabase } from '../support/test-database';
import { TestTokens } from '../support/test-tokens';

describe('identity, authentication and the access guard (HTTP)', () => {
  let db: TestDatabase;
  let tokens: TestTokens;
  let app: TestApp;

  beforeAll(async () => {
    db = await createTestDatabase();
    tokens = await TestTokens.create();
    app = await createTestApp(db, tokens);
  });

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  const bearer = async (userId: string, phone?: string) =>
    `Bearer ${await tokens.sign(userId, phone ? { phone } : {})}`;

  describe('health', () => {
    it('serves liveness and readiness without authentication', async () => {
      await app.http().get('/health/live').expect(200, { status: 'ok' });
      await app
        .http()
        .get('/health/ready')
        .expect(200, { status: 'ok', checks: { database: 'ok' } });
    });

    it('returns a request id header, honouring a valid client-supplied one', async () => {
      const res = await app
        .http()
        .get('/health/live')
        .set('X-Request-Id', 'client-req-12345')
        .expect(200);
      expect(res.headers['x-request-id']).toBe('client-req-12345');
      const generated = await app
        .http()
        .get('/health/live')
        .set('X-Request-Id', 'bad id!')
        .expect(200);
      expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('authentication failures', () => {
    it('401 AUTHENTICATION_REQUIRED without a bearer token', async () => {
      const res = await app.http().get('/v1/me').expect(401);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body).toMatchObject({ status: 401, code: 'AUTHENTICATION_REQUIRED' });
      expect(res.body.requestId).toEqual(res.headers['x-request-id']);
    });

    it('401 INVALID_TOKEN for expired, forged or malformed tokens', async () => {
      const expired = await tokens.sign(randomUUID(), { expiresInSeconds: -3600 });
      await app.http().get('/v1/me').set('Authorization', `Bearer ${expired}`).expect(401);
      const other = await TestTokens.create();
      const forged = await other.sign(randomUUID());
      const res = await app
        .http()
        .get('/v1/me')
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
      expect(res.body.code).toBe('INVALID_TOKEN');
      await app.http().get('/v1/me').set('Authorization', 'Basic abc').expect(401);
    });
  });

  describe('registration', () => {
    it('reports an authenticated but unregistered caller', async () => {
      const userId = randomUUID();
      const res = await app
        .http()
        .get('/v1/me')
        .set('Authorization', await bearer(userId))
        .expect(200);
      expect(res.body).toEqual({
        userId,
        registered: false,
        displayName: null,
        phoneE164: null,
        status: null,
        roles: [],
      });
    });

    it('blocks unregistered callers from registered-only operations', async () => {
      const res = await app
        .http()
        .patch('/v1/me/profile')
        .set('Authorization', await bearer(randomUUID()))
        .send({ displayName: 'X' })
        .expect(403);
      expect(res.body.code).toBe('REGISTRATION_REQUIRED');
    });

    it('registers a passenger idempotently, taking the phone only from the verified token', async () => {
      const userId = randomUUID();
      const auth = await bearer(userId, '249912000001');
      const first = await app
        .http()
        .post('/v1/passenger/registration')
        .set('Authorization', auth)
        .send({ displayName: '  Amna  ' })
        .expect(201);
      expect(first.body).toMatchObject({
        userId,
        registered: true,
        displayName: 'Amna',
        phoneE164: '+249912000001',
        roles: ['passenger'],
      });

      const again = await app
        .http()
        .post('/v1/passenger/registration')
        .set('Authorization', auth)
        .send({ displayName: 'Amna' })
        .expect(200);
      expect(again.body.roles).toEqual(['passenger']);

      const { rows } = await db.admin.query(
        `select action from taketuk.audit_events where entity_id = $1 order by id`,
        [userId],
      );
      expect(rows.map((r: { action: string }) => r.action)).toEqual([
        'user.registered',
        'user.role_granted',
      ]);
    });

    it('rejects unknown fields (no smuggling of roles or ids)', async () => {
      const res = await app
        .http()
        .post('/v1/passenger/registration')
        .set('Authorization', await bearer(randomUUID()))
        .send({ displayName: 'Eve', roles: ['admin'] })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors).toEqual([
        { path: 'body', message: expect.stringContaining('roles') as string },
      ]);
    });

    it('rejects malformed JSON and oversized bodies with problem details', async () => {
      const auth = await bearer(randomUUID());
      const malformed = await app
        .http()
        .post('/v1/passenger/registration')
        .set('Authorization', auth)
        .set('Content-Type', 'application/json')
        .send('{"displayName":')
        .expect(400);
      expect(malformed.body.code).toBe('VALIDATION_FAILED');

      const huge = await app
        .http()
        .post('/v1/passenger/registration')
        .set('Authorization', auth)
        .send({ displayName: 'x'.repeat(70_000) })
        .expect(413);
      expect(huge.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(huge.body.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('updates the display name for registered users', async () => {
      const userId = randomUUID();
      const auth = await bearer(userId);
      await app
        .http()
        .post('/v1/passenger/registration')
        .set('Authorization', auth)
        .send({ displayName: 'Old' })
        .expect(201);
      const res = await app
        .http()
        .patch('/v1/me/profile')
        .set('Authorization', auth)
        .send({ displayName: 'New' })
        .expect(200);
      expect(res.body.displayName).toBe('New');
    });

    it('blocks disabled users on every authenticated route', async () => {
      const userId = randomUUID();
      const auth = await bearer(userId);
      await app
        .http()
        .post('/v1/passenger/registration')
        .set('Authorization', auth)
        .send({ displayName: 'D' })
        .expect(201);
      await db.admin.query(`update taketuk.users set status = 'disabled' where id = $1`, [userId]);
      const res = await app.http().get('/v1/me').set('Authorization', auth).expect(403);
      expect(res.body.code).toBe('ACCOUNT_DISABLED');
      await app
        .http()
        .post('/v1/passenger/registration')
        .set('Authorization', auth)
        .send({ displayName: 'D' })
        .expect(403);
    });
  });

  it('returns problem details for unknown routes', async () => {
    const res = await app.http().get('/v1/does-not-exist').expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
