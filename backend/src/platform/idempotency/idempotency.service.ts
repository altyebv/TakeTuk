import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import type { Queryable, Tx } from '../../infrastructure/database/database';
import { AppError } from '../../shared/errors/app-error';

export interface IdempotentResponse<T> {
  readonly status: number;
  readonly body: T;
  /** true when this is a replay of a previously committed response. */
  readonly replayed: boolean;
}

export interface IdempotencyScope {
  readonly userId: string;
  readonly operation: string;
  readonly key: string;
  /** The validated request; its canonical fingerprint is compared on replay. */
  readonly request: unknown;
}

const KEY_FORMAT = /^[A-Za-z0-9_-]{8,128}$/;

/** Validates the Idempotency-Key header value (API_CONVENTIONS §8). */
export function requireIdempotencyKey(header: string | undefined): string {
  if (header === undefined || header === '') {
    throw new AppError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'This operation requires an Idempotency-Key header.',
    );
  }
  if (!KEY_FORMAT.test(header)) {
    throw new AppError('VALIDATION_FAILED', 'The Idempotency-Key header is invalid.', {
      errors: [
        { path: 'headers.idempotency-key', message: 'must be 8-128 characters of [A-Za-z0-9_-]' },
      ],
    });
  }
  return header;
}

/** Stable JSON: object keys sorted recursively, so fingerprints do not depend on key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  // JSON.stringify returns undefined for undefined/functions despite its declared type.
  const encoded = JSON.stringify(value) as string | undefined;
  return encoded ?? 'null';
}

export function fingerprint(request: unknown): string {
  return createHash('sha256').update(canonicalJson(request)).digest('hex');
}

interface StoredRow {
  request_hash: string;
  response_status: number;
  response_body: unknown;
}

/**
 * Idempotency keys (STATE_MACHINES §12). The record is written in the SAME transaction as the
 * effect: it exists if and only if the effect committed. A concurrent duplicate blocks on the
 * primary key until the first transaction ends, then replays its response.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async execute<T>(
    tx: Tx,
    scope: IdempotencyScope,
    effect: () => Promise<{ status: number; body: T }>,
  ): Promise<IdempotentResponse<T>> {
    const requestHash = fingerprint(scope.request);

    // An expired record no longer protects the key; remove it so the key can be reused.
    await tx.query(
      `delete from taketuk.idempotency_keys
        where user_id = $1 and operation = $2 and idempotency_key = $3 and expires_at <= now()`,
      [scope.userId, scope.operation, scope.key],
    );

    const claimed = await tx.query(
      `insert into taketuk.idempotency_keys
         (user_id, operation, idempotency_key, request_hash, response_status, response_body, expires_at)
       values ($1, $2, $3, $4, 0, 'null'::jsonb, now() + make_interval(hours => $5))
       on conflict (user_id, operation, idempotency_key) do nothing`,
      [scope.userId, scope.operation, scope.key, requestHash, this.config.idempotency.ttlHours],
    );

    if (claimed.rowCount === 0) {
      const stored = await this.find(tx, scope);
      if (!stored) {
        // The conflicting row vanished (expired and cleaned concurrently): ask the client to retry.
        throw new AppError('CONCURRENT_UPDATE', 'Please retry the request.');
      }
      if (stored.request_hash !== requestHash) {
        throw new AppError('IDEMPOTENCY_KEY_REUSED');
      }
      return { status: stored.response_status, body: stored.response_body as T, replayed: true };
    }

    const result = await effect();
    await tx.query(
      `update taketuk.idempotency_keys
          set response_status = $4, response_body = $5
        where user_id = $1 and operation = $2 and idempotency_key = $3`,
      [scope.userId, scope.operation, scope.key, result.status, JSON.stringify(result.body)],
    );
    return { ...result, replayed: false };
  }

  private async find(db: Queryable, scope: IdempotencyScope): Promise<StoredRow | undefined> {
    const { rows } = await db.query<StoredRow>(
      `select request_hash, response_status, response_body from taketuk.idempotency_keys
        where user_id = $1 and operation = $2 and idempotency_key = $3`,
      [scope.userId, scope.operation, scope.key],
    );
    return rows[0];
  }
}
