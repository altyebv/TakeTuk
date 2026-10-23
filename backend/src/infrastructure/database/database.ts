import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Pool, TypeOverrides, type PoolClient, type QueryResultRow } from 'pg';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { isConnectionError, isRetryableTransactionError } from './pg-errors';

export interface QueryResultLike<R> {
  readonly rows: R[];
  readonly rowCount: number;
}

/** Anything that can run a parameterised query: the pool or a transaction. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResultLike<R>>;
}

/**
 * A query handle bound to an open transaction. Functions that must run atomically with their
 * caller take a `Tx` (never the pool), which makes transaction boundaries explicit (ADR-0013).
 */
export interface Tx extends Queryable {
  readonly __transaction: true;
}

const MAX_TRANSACTION_ATTEMPTS = 3;
const INT8_OID = 20;

function parseInt8(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`int8 value ${value} exceeds the safe integer range`);
  }
  return parsed;
}

/**
 * bigint columns are parsed as numbers and rejected if they exceed Number.MAX_SAFE_INTEGER.
 * Scoped to this pool (no global pg type mutation).
 */
export function createTypeOverrides(): TypeOverrides {
  const overrides = new TypeOverrides();
  overrides.setTypeParser(INT8_OID, 'text', parseInt8);
  return overrides;
}

@Injectable()
export class Database implements OnModuleDestroy {
  private readonly logger = new Logger(Database.name);
  private readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.database.url,
      max: config.database.poolMax,
      statement_timeout: config.database.statementTimeoutMs,
      idle_in_transaction_session_timeout: 30_000,
      application_name: 'taketuk-api',
      connectionTimeoutMillis: 5_000,
      types: createTypeOverrides(),
    });
    this.pool.on('error', (error) => {
      this.logger.error(`Idle database client error: ${error.message}`);
    });
  }

  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResultLike<R>> {
    const result = await this.pool.query<R>(text, values as unknown[] | undefined);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  }

  /**
   * Runs `work` in a READ COMMITTED transaction. Serialization failures and deadlocks are retried
   * (the transaction is rolled back first, so retries are safe as long as `work` performs no
   * external side effects — which is a rule for all use cases).
   */
  async transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      const client = await this.pool.connect();
      let releaseError: Error | undefined;
      try {
        await client.query('BEGIN');
        const result = await work(bindTransaction(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          releaseError =
            rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
        }
        if (isConnectionError(error)) {
          releaseError = error instanceof Error ? error : new Error(String(error));
        }
        if (isRetryableTransactionError(error) && attempt < MAX_TRANSACTION_ATTEMPTS) {
          this.logger.warn(`Retrying transaction after ${describe(error)} (attempt ${attempt})`);
          continue;
        }
        throw error;
      } finally {
        client.release(releaseError);
      }
    }
  }

  async ping(timeoutMs = 2_000): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('database ping timed out'));
        }, timeoutMs);
      });
      await Promise.race([this.pool.query('select 1'), timeout]);
      return true;
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

function bindTransaction(client: PoolClient): Tx {
  const query = async (text: string, values?: readonly unknown[]) => {
    const result = await client.query(text, values as unknown[] | undefined);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  };
  return { __transaction: true, query: query };
}

function describe(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return `SQLSTATE ${String(error.code)}`;
  }
  return 'error';
}
