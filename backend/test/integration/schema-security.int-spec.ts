import { Pool } from 'pg';
import { migrate, readMigrations } from '../../src/infrastructure/database/migrator';
import { createTestDatabase, type TestDatabase } from '../support/test-database';

/**
 * Migration and database-security tests (docs/security/SECURITY.md §5, ADR-0015).
 * The template database was built from a clean database by global-setup; this suite checks the
 * resulting schema and the least-privilege posture with the real backend login role.
 */
describe('schema and database security', () => {
  let db: TestDatabase;
  let api: Pool;

  beforeAll(async () => {
    db = await createTestDatabase();
    api = new Pool({ connectionString: db.apiUrl, max: 2 });
  });

  afterAll(async () => {
    await api.end();
    await db.drop();
  });

  it('records every repository migration as applied, and re-running is a no-op', async () => {
    const files = await readMigrations();
    const { rows } = await db.admin.query<{ version: string }>(
      'select version from taketuk_migrations.applied order by version',
    );
    expect(rows.map((r) => r.version)).toEqual(files.map((f) => f.version));

    const rerun = await migrate(db.adminUrl);
    expect(rerun.applied).toEqual([]);
    expect(rerun.alreadyApplied).toHaveLength(files.length);
  });

  it('enables RLS on every domain table and grants nothing to PUBLIC/anon/authenticated/service_role', async () => {
    const { rows: tables } = await db.admin.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'taketuk' and c.relkind = 'r'`,
    );
    expect(tables.length).toBeGreaterThan(20);
    expect(tables.filter((t) => !t.relrowsecurity).map((t) => t.relname)).toEqual([]);

    const { rows: grants } = await db.admin.query<{ grantee: string; table_name: string }>(
      `select grantee, table_name from information_schema.role_table_grants
        where table_schema = 'taketuk' and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')`,
    );
    expect(grants).toEqual([]);

    const { rows: schemaUsage } = await db.admin.query<{ role: string; has_usage: boolean }>(
      `select r as role, has_schema_privilege(r, 'taketuk', 'USAGE') as has_usage
         from unnest(array['anon', 'authenticated', 'service_role']) as r`,
    );
    expect(schemaUsage.every((r) => !r.has_usage)).toBe(true);
  });

  it('gives the backend role append-only access to financial and audit history', async () => {
    const { rows } = await db.admin.query<{ table_name: string; privileges: string[] }>(
      `select table_name, array_agg(privilege_type::text order by privilege_type) as privileges
         from information_schema.role_table_grants
        where table_schema = 'taketuk' and grantee = 'taketuk_api'
        group by table_name`,
    );
    const byTable = Object.fromEntries(rows.map((r) => [r.table_name, r.privileges]));
    for (const table of [
      'fare_agreements',
      'ledger_transactions',
      'ledger_entries',
      'audit_events',
    ]) {
      expect(byTable[table]).toEqual(['INSERT', 'SELECT']);
    }
    for (const table of [
      'status_transitions',
      'vehicle_types',
      'service_types',
      'service_vehicle_compatibility',
    ]) {
      expect(byTable[table]).toEqual(['SELECT']);
    }
    expect(Object.values(byTable).flat()).not.toContain('TRUNCATE');
  });

  it('prevents the backend login role from DDL and from rewriting history', async () => {
    await expect(api.query('create table taketuk.not_allowed (id int)')).rejects.toThrow(
      /permission denied/,
    );
    await expect(api.query('drop table taketuk.rides')).rejects.toThrow(
      /must be owner|permission denied/,
    );
    await expect(api.query(`update taketuk.audit_events set action = 'x.y'`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(api.query('delete from taketuk.ledger_entries')).rejects.toThrow(
      /permission denied/,
    );
    await expect(api.query(`delete from taketuk.status_transitions`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it('denies the Supabase API roles any access to domain data', async () => {
    const client = await db.admin.connect();
    try {
      for (const role of ['anon', 'authenticated']) {
        await client.query(`set role ${role}`);
        await expect(client.query('select * from taketuk.users')).rejects.toThrow(
          /permission denied/,
        );
        await client.query('reset role');
      }
    } finally {
      client.release();
    }
  });

  it('declaratively forbids passenger services on non-passenger vehicles', async () => {
    await expect(
      db.admin.query(
        `insert into taketuk.service_vehicle_compatibility values ('passenger_transport', true, 'motorcycle', false)`,
      ),
    ).rejects.toThrow(/compatibility_passenger_service_needs_passenger_vehicle/);
    await expect(
      db.admin.query(
        `update taketuk.vehicle_types set passenger_capable = false where code = 'raksha'`,
      ),
    ).rejects.toThrow(/compatibility_passenger_service_needs_passenger_vehicle/);
  });

  it('rejects status changes that are not in the transition table', async () => {
    const { rows } = await db.admin.query<{ id: string }>(
      `insert into taketuk.service_areas (code, display_name, timezone, boundary, status)
       values ('t_area', 'T', 'UTC', extensions.st_geogfromtext('MULTIPOLYGON(((0 0, 1 0, 1 1, 0 1, 0 0)))'), 'active')
       returning id`,
    );
    const areaId = rows[0]!.id;
    await expect(
      db.admin.query(
        `insert into taketuk.fare_policies (service_area_id, service_type_code, version, status, currency,
            base_fare_minor, per_km_fare_minor, minimum_fare_minor, rounding_increment_minor)
         values ($1, 'passenger_transport', 1, 'active', 'SDG', 1, 1, 1, 1)`,
        [areaId],
      ),
    ).rejects.toMatchObject({ code: 'TK001' });

    const { rows: policy } = await db.admin.query<{ id: string }>(
      `insert into taketuk.fare_policies (service_area_id, service_type_code, version, status, currency,
          base_fare_minor, per_km_fare_minor, minimum_fare_minor, rounding_increment_minor)
       values ($1, 'passenger_transport', 1, 'draft', 'SDG', 1, 1, 1, 1) returning id`,
      [areaId],
    );
    await db.admin.query(`update taketuk.fare_policies set status = 'retired' where id = $1`, [
      policy[0]!.id,
    ]);
    await expect(
      db.admin.query(`update taketuk.fare_policies set status = 'active' where id = $1`, [
        policy[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: 'TK001' });
  });

  it('keeps policy parameters immutable once a policy leaves draft', async () => {
    const { rows } = await db.admin.query<{ id: string }>(
      `insert into taketuk.service_areas (code, display_name, timezone, boundary, status)
       values ('t_area_2', 'T2', 'UTC', extensions.st_geogfromtext('MULTIPOLYGON(((0 0, 1 0, 1 1, 0 1, 0 0)))'), 'active')
       returning id`,
    );
    const { rows: policy } = await db.admin.query<{ id: string }>(
      `insert into taketuk.commission_policies (service_area_id, service_type_code, version, status, rate_basis_points)
       values ($1, 'passenger_transport', 1, 'draft', 500) returning id`,
      [rows[0]!.id],
    );
    const id = policy[0]!.id;
    await db.admin.query(
      `update taketuk.commission_policies set rate_basis_points = 600 where id = $1`,
      [id],
    );
    await db.admin.query(`update taketuk.commission_policies set status = 'active' where id = $1`, [
      id,
    ]);
    await expect(
      db.admin.query(
        `update taketuk.commission_policies set rate_basis_points = 700 where id = $1`,
        [id],
      ),
    ).rejects.toMatchObject({ code: 'TK002' });
  });

  it('rejects unbalanced ledger transactions at commit time', async () => {
    // DDL is transactional: the constraint drop (which lets us insert without a real ride) is
    // rolled back together with the failed commit.
    const tx = await db.admin.connect();
    try {
      await tx.query('begin');
      await tx.query(
        `alter table taketuk.ledger_transactions drop constraint ledger_transactions_ride_required`,
      );
      const { rows } = await tx.query<{ id: string }>(
        `insert into taketuk.ledger_transactions (kind, description) values ('ride_commission', 'x') returning id`,
      );
      await tx.query(
        `insert into taketuk.ledger_entries (transaction_id, account_type, currency, amount_minor)
         values ($1, 'platform_commission_revenue', 'SDG', -100)`,
        [rows[0]!.id],
      );
      await expect(tx.query('commit')).rejects.toMatchObject({ code: 'TK003' });
    } finally {
      tx.release();
    }
  });
});
