import { z } from 'zod';
import { AppError } from './errors/app-error';

/**
 * Cursor pagination over a keyset (sortKey desc, id desc) (docs/api/API_CONVENTIONS.md §7).
 *
 * `sortKey` is the exact text form of the sort column as produced by PostgreSQL (e.g.
 * `created_at::text`), never a JavaScript Date: Dates truncate PostgreSQL's microsecond
 * precision, which would make keyset comparisons skip rows.
 */

export const PageQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(300).optional(),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

export interface Keyset {
  readonly sortKey: string;
  readonly id: string;
}

export interface Page<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

export const pageResponseSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

const KeysetSchema = z.strictObject({
  k: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[0-9A-Za-z :.+-]+$/),
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[0-9A-Za-z-]+$/),
});

export function encodeCursor(keyset: Keyset): string {
  return Buffer.from(JSON.stringify({ k: keyset.sortKey, id: keyset.id })).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): Keyset | undefined {
  if (cursor === undefined) return undefined;
  try {
    const parsed = KeysetSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    return { sortKey: parsed.k, id: parsed.id };
  } catch {
    throw invalidCursor();
  }
}

export function invalidCursor(): AppError {
  return new AppError('VALIDATION_FAILED', 'The cursor is invalid.', {
    errors: [{ path: 'query.cursor', message: 'invalid cursor' }],
  });
}

/** Builds a page from `limit + 1` fetched rows. */
export function toPage<R, T>(
  rows: readonly R[],
  limit: number,
  map: (row: R) => T,
  keyOf: (row: R) => Keyset,
): Page<T> {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(map),
    nextCursor: hasMore && last !== undefined ? encodeCursor(keyOf(last)) : null,
  };
}
