/* eslint-disable no-console -- operator command-line tool: console output is its interface */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Client } from 'pg';
import { findMigrationsDirectory, migrate } from '../infrastructure/database/migrator';
import { isRole } from '../shared/auth/roles-and-permissions';

/**
 * Operator CLI (docs/operations/OPERATIONS.md §5).
 *
 *   migrate      Apply supabase/migrations to a PLAIN PostgreSQL database (tests/CI/local).
 *                Refuses Supabase-managed databases: use the Supabase CLI there (ADR-0003).
 *   seed-dev     Apply supabase/seed.sql (development data). Refuses NODE_ENV=production.
 *   grant-role   Grant a role (e.g. admin) to an existing user, with an audit event.
 *
 * Connection: DATABASE_ADMIN_URL (migrate, seed-dev) or DATABASE_URL (grant-role).
 */

const USAGE = `usage:
  cli migrate
  cli seed-dev
  cli grant-role --user <uuid> --role <passenger|driver|admin> --operator <name> --reason <text>`;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function withClient<T>(url: string, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url, application_name: 'taketuk-cli' });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function assertNotSupabase(url: string): Promise<void> {
  const managed = await withClient(url, async (client) => {
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from pg_namespace where nspname in ('supabase_migrations', 'auth', 'storage')`,
    );
    return (rows[0]?.n ?? 0) > 0;
  });
  if (managed) {
    throw new Error(
      'This database looks Supabase-managed. Apply migrations with the Supabase CLI ' +
        '(supabase db reset / supabase db push), not with this runner.',
    );
  }
}

async function runMigrate(): Promise<void> {
  const url = env('DATABASE_ADMIN_URL');
  await assertNotSupabase(url);
  const result = await migrate(url, {
    log: (line) => {
      console.log(line);
    },
  });
  console.log(`applied ${result.applied.length}, already applied ${result.alreadyApplied.length}`);
}

async function runSeedDev(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-dev is refused when NODE_ENV=production');
  }
  const url = env('DATABASE_ADMIN_URL');
  const seedPath = join(findMigrationsDirectory(), '..', 'seed.sql');
  const sql = await readFile(seedPath, 'utf8');
  await withClient(url, (client) => client.query(sql));
  console.log(`applied ${seedPath}`);
}

async function runGrantRole(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      user: { type: 'string' },
      role: { type: 'string' },
      operator: { type: 'string' },
      reason: { type: 'string' },
    },
    strict: true,
  });
  const { user, role, operator, reason } = values;
  if (!user || !role || !operator || !reason) throw new Error(USAGE);
  if (!/^[0-9a-f-]{36}$/i.test(user)) throw new Error('--user must be a UUID');
  if (!isRole(role)) throw new Error(`unknown role ${role}`);

  await withClient(env('DATABASE_URL'), async (client) => {
    await client.query('begin');
    try {
      const { rows } = await client.query(`select 1 from taketuk.users where id = $1 for update`, [
        user,
      ]);
      if (rows.length === 0)
        throw new Error('user not found: they must register through the app first');
      const granted = await client.query(
        `insert into taketuk.user_roles (user_id, role) values ($1, $2) on conflict do nothing`,
        [user, role],
      );
      if (granted.rowCount === 1) {
        await client.query(
          `insert into taketuk.audit_events (actor_type, action, entity_type, entity_id, metadata)
           values ('system', 'user.role_granted', 'user', $1, $2)`,
          [user, JSON.stringify({ role, via: 'cli', operator, reason })],
        );
      }
      await client.query('commit');
      console.log(
        granted.rowCount === 1 ? `granted ${role} to ${user}` : `${user} already has ${role}`,
      );
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  });
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'migrate':
      return runMigrate();
    case 'seed-dev':
      return runSeedDev();
    case 'grant-role':
      return runGrantRole(rest);
    default:
      throw new Error(USAGE);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
