import { migrate } from '../../src/infrastructure/database/migrator';
import {
  adminUrl,
  API_LOGIN_PASSWORD,
  API_LOGIN_ROLE,
  TEMPLATE_DATABASE,
  withAdminClient,
} from './test-database';

/**
 * Builds the migrated template database once per test run. This is also the migration test's
 * precondition: a clean database can be created from the repository's migration history.
 */
export default async function globalSetup(): Promise<void> {
  await withAdminClient('postgres', async (client) => {
    // Emulate the Supabase Data API roles so the migrations' revokes and the security tests that
    // assert "anon/authenticated have no access" are meaningful on plain PostgreSQL.
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await client.query(
        `do $$ begin
           if not exists (select 1 from pg_roles where rolname = '${role}') then
             create role ${role} nologin;
           end if;
         end $$`,
      );
    }
    await client.query(`drop database if exists ${TEMPLATE_DATABASE} with (force)`);
    await client.query(`create database ${TEMPLATE_DATABASE}`);
  });

  await migrate(adminUrl(TEMPLATE_DATABASE));

  await withAdminClient(TEMPLATE_DATABASE, async (client) => {
    await client.query(
      `do $$ begin
         if not exists (select 1 from pg_roles where rolname = '${API_LOGIN_ROLE}') then
           create role ${API_LOGIN_ROLE} login password '${API_LOGIN_PASSWORD}';
         end if;
       end $$`,
    );
    await client.query(`grant taketuk_api to ${API_LOGIN_ROLE}`);
  });
}
