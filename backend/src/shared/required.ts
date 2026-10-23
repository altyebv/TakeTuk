import { AppError } from './errors/app-error';

/**
 * Narrows a value that must exist by invariant (e.g. the row an INSERT ... RETURNING just wrote,
 * or a record re-read inside the transaction that locked it). Fails loudly, never silently.
 */
export function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new AppError('INTERNAL_ERROR', `Invariant violated: ${what} is missing.`);
  }
  return value;
}
