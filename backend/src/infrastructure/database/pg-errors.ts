/** Helpers for interpreting node-postgres errors (SQLSTATE codes). */

interface PgErrorLike {
  readonly code?: string;
  readonly constraint?: string;
  readonly message?: string;
}

function asPgError(error: unknown): PgErrorLike | undefined {
  return error !== null && typeof error === 'object' ? error : undefined;
}

export function sqlState(error: unknown): string | undefined {
  const code = asPgError(error)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pg = asPgError(error);
  return pg?.code === '23505' && (constraint === undefined || pg.constraint === constraint);
}

export function isCheckViolation(error: unknown, constraint?: string): boolean {
  const pg = asPgError(error);
  return pg?.code === '23514' && (constraint === undefined || pg.constraint === constraint);
}

export function isRetryableTransactionError(error: unknown): boolean {
  const code = sqlState(error);
  return code === '40001' || code === '40P01';
}

/** Illegal status transition rejected by taketuk.enforce_status_transition (a backstop). */
export function isIllegalTransitionError(error: unknown): boolean {
  return sqlState(error) === 'TK001';
}

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EPIPE',
]);

export function isConnectionError(error: unknown): boolean {
  const pg = asPgError(error);
  if (!pg) return false;
  const code = pg.code ?? '';
  if (CONNECTION_ERROR_CODES.has(code)) return true;
  if (
    code.startsWith('08') ||
    code === '57P01' ||
    code === '57P02' ||
    code === '57P03' ||
    code === '53300'
  ) {
    return true;
  }
  const message = pg.message ?? '';
  return (
    message.includes('Connection terminated') ||
    message.includes('timeout exceeded when trying to connect') ||
    message.includes('Client has encountered a connection error')
  );
}

export function isStatementTimeout(error: unknown): boolean {
  return sqlState(error) === '57014';
}
