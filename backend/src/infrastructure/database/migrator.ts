import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Client } from 'pg';

/**
 * Applies supabase/migrations/*.sql to a PLAIN PostgreSQL database (tests, CI, local without the
 * Supabase CLI). Supabase environments must use the Supabase CLI instead (ADR-0003); this runner
 * keeps its own history in schema `taketuk_migrations` and never touches Supabase's.
 */

export interface MigrationFile {
  readonly version: string;
  readonly name: string;
  readonly fileName: string;
  readonly sql: string;
  readonly checksum: string;
}

const FILE_PATTERN = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const LOCK_KEY = 7_340_661; // arbitrary constant advisory-lock key for the migration runner

/** Finds `supabase/migrations` by walking up from this file (works from src/ and dist/). */
export function findMigrationsDirectory(start: string = __dirname): string {
  for (let current = start; ; current = dirname(current)) {
    const candidate = join(current, 'supabase', 'migrations');
    if (existsSync(candidate)) return candidate;
    if (dirname(current) === current) {
      throw new Error('Could not locate supabase/migrations; pass the directory explicitly.');
    }
  }
}

export async function readMigrations(
  directory: string = findMigrationsDirectory(),
): Promise<MigrationFile[]> {
  const entries = (await readdir(directory)).filter((f) => f.endsWith('.sql')).sort();
  const migrations: MigrationFile[] = [];
  for (const fileName of entries) {
    const match = FILE_PATTERN.exec(fileName);
    if (!match?.[1] || !match[2]) {
      throw new Error(
        `Migration file name does not match <14-digit version>_<name>.sql: ${fileName}`,
      );
    }
    const sql = await readFile(join(directory, fileName), 'utf8');
    migrations.push({
      version: match[1],
      name: match[2],
      fileName,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  const versions = new Set(migrations.map((m) => m.version));
  if (versions.size !== migrations.length) {
    throw new Error('Duplicate migration versions found');
  }
  return migrations;
}

export interface MigrateResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

export async function migrate(
  connectionString: string,
  options: { directory?: string; log?: (line: string) => void } = {},
): Promise<MigrateResult> {
  const log = options.log ?? (() => undefined);
  const migrations = await readMigrations(options.directory);
  const client = new Client({ connectionString, application_name: 'taketuk-migrator' });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`
      create schema if not exists taketuk_migrations;
      create table if not exists taketuk_migrations.applied (
        version text primary key,
        name text not null,
        checksum text not null,
        applied_at timestamptz not null default now()
      );`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'select version, checksum from taketuk_migrations.applied',
    );
    const appliedChecksums = new Map(rows.map((r) => [r.version, r.checksum]));

    const applied: string[] = [];
    const alreadyApplied: string[] = [];
    for (const migration of migrations) {
      const existing = appliedChecksums.get(migration.version);
      if (existing !== undefined) {
        if (existing !== migration.checksum) {
          throw new Error(
            `Migration ${migration.fileName} was modified after being applied. ` +
              'Applied migrations are immutable: add a new migration instead.',
          );
        }
        alreadyApplied.push(migration.fileName);
        continue;
      }
      log(`applying ${migration.fileName}`);
      await client.query('begin');
      try {
        await client.query(migration.sql);
        await client.query(
          'insert into taketuk_migrations.applied (version, name, checksum) values ($1, $2, $3)',
          [migration.version, migration.name, migration.checksum],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(
          `Migration ${migration.fileName} failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      applied.push(migration.fileName);
    }
    return { applied, alreadyApplied };
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}
