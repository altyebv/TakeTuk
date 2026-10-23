import { randomUUID } from 'node:crypto';
import type { OpenAPIObject } from '@nestjs/swagger';
import { buildOpenApiDocument } from '../../src/bootstrap';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Scenario, type Person } from '../support/scenario';

/**
 * Route-by-route authorization sweep, generated from the OpenAPI document so new endpoints are
 * covered automatically (SECURITY.md §3, API_CONVENTIONS §3).
 */
interface Operation {
  readonly method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  readonly path: string;
  readonly permissions: string[] | undefined;
  readonly secured: boolean;
}

function operations(doc: OpenAPIObject): Operation[] {
  const result: Operation[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const op = item[method] as (Record<string, unknown> & { security?: unknown[] }) | undefined;
      if (!op) continue;
      result.push({
        method,
        path: path.replace(/\{[^}]+\}/g, () => randomUUID()),
        permissions: op['x-taketuk-permissions'] as string[] | undefined,
        secured: Array.isArray(op.security) && op.security.length > 0,
      });
    }
  }
  return result;
}

describe('authorization sweep', () => {
  let s: Scenario;
  let ops: Operation[];
  let passenger: Person;
  let driverApplicant: Person;
  let unregistered: Person;

  beforeAll(async () => {
    s = await Scenario.create();
    await s.createServiceArea();
    ops = operations(buildOpenApiDocument(s.app.app as NestExpressApplication));
    passenger = await s.registerPassenger('Sweep passenger');
    driverApplicant = await s.submittedDriver({ name: 'Sweep driver' });
    const id = randomUUID();
    unregistered = { userId: id, auth: await s.bearer(id) };
  });

  afterAll(async () => {
    await s.close();
  });

  const call = (op: Operation, auth?: string) => {
    const req = s.http()[op.method](op.path);
    return (auth ? req.set('Authorization', auth) : req).send({});
  };

  it('documents a meaningful number of operations', () => {
    expect(ops.length).toBeGreaterThan(40);
  });

  it('requires a bearer token on every non-health operation', async () => {
    for (const op of ops.filter((o) => !o.path.startsWith('/health'))) {
      expect(op.secured).toBe(true);
      const res = await call(op);
      expect({ op: `${op.method} ${op.path}`, status: res.status }).toEqual({
        op: `${op.method} ${op.path}`,
        status: 401,
      });
    }
  });

  it('rejects unregistered users on every permission-guarded operation', async () => {
    for (const op of ops.filter((o) => o.permissions !== undefined)) {
      const res = await call(op, unregistered.auth);
      expect({ op: `${op.method} ${op.path}`, code: res.body.code as string }).toEqual({
        op: `${op.method} ${op.path}`,
        code: 'REGISTRATION_REQUIRED',
      });
    }
  });

  it('denies passengers every admin and driver operation', async () => {
    for (const op of ops.filter((o) => o.permissions?.some((p) => !['ride:request'].includes(p)))) {
      const res = await call(op, passenger.auth);
      expect({ op: `${op.method} ${op.path}`, status: res.status }).toEqual({
        op: `${op.method} ${op.path}`,
        status: 403,
      });
    }
  });

  it('denies drivers every admin and passenger operation', async () => {
    const driverPermissions = ['driver:self', 'driver:operate'];
    for (const op of ops.filter((o) =>
      o.permissions?.some((p) => !driverPermissions.includes(p)),
    )) {
      const res = await call(op, driverApplicant.auth);
      expect({ op: `${op.method} ${op.path}`, status: res.status }).toEqual({
        op: `${op.method} ${op.path}`,
        status: 403,
      });
    }
  });

  it('keeps unapproved drivers from commercial work even though they hold the driver role', async () => {
    const online = await s
      .http()
      .put('/v1/driver/availability')
      .set('Authorization', driverApplicant.auth)
      .send({ availability: 'online' });
    expect(online.body.code).toBe('DRIVER_NOT_APPROVED');
    const location = await s
      .http()
      .put('/v1/driver/location')
      .set('Authorization', driverApplicant.auth)
      .send({ lat: 14.4, lng: 33.52, recordedAt: new Date().toISOString() });
    expect(location.body.code).toBe('DRIVER_NOT_APPROVED');
  });
});
