import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';

/**
 * Integration tests run against a real PostgreSQL + PostGIS server (ADR-0003). A template
 * database is migrated once per test run (global-setup.ts); every test file gets a fresh copy.
 *
 * TEST_DATABASE_ADMIN_URL must point at a role that can create databases and roles
 * (default: the local postgres superuser). The application under test connects as
 * TEST_API_LOGIN_ROLE, a login role whose only privileges come from membership in taketuk_api,
 * so least-privilege grants are exercised for real.
 */
export const ADMIN_BASE_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
export const TEMPLATE_DATABASE = 'taketuk_test_template';
export const API_LOGIN_ROLE = 'taketuk_api_test_login';
export const API_LOGIN_PASSWORD = 'test-only-password';

export function adminUrl(database: string): string {
  const url = new URL(ADMIN_BASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

export function apiUrl(database: string): string {
  const url = new URL(ADMIN_BASE_URL);
  url.username = API_LOGIN_ROLE;
  url.password = API_LOGIN_PASSWORD;
  url.pathname = `/${database}`;
  return url.toString();
}

export async function withAdminClient<T>(
  database: string,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: adminUrl(database) });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export interface TestDatabase {
  readonly name: string;
  readonly apiUrl: string;
  readonly adminUrl: string;
  /** Superuser pool for fixtures and assertions (bypasses RLS and grants — never used by the app). */
  readonly admin: Pool;
  drop(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `taketuk_test_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await withAdminClient('postgres', (client) =>
    client.query(`create database ${name} template ${TEMPLATE_DATABASE}`),
  );
  const admin = new Pool({ connectionString: adminUrl(name), max: 5 });
  return {
    name,
    apiUrl: apiUrl(name),
    adminUrl: adminUrl(name),
    admin,
    async drop() {
      await admin.end();
      await withAdminClient('postgres', (client) =>
        client.query(`drop database if exists ${name} with (force)`),
      );
    },
  };
}
