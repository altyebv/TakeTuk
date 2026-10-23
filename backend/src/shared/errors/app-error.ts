import { ERROR_CODES, type ErrorCode, type ErrorKind } from './error-codes';

export interface FieldError {
  readonly path: string;
  readonly message: string;
}

export interface AppErrorOptions {
  readonly errors?: readonly FieldError[];
  readonly retryAfterSeconds?: number;
  /** Extra, non-sensitive fields exposed in the problem response (e.g. current status). */
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

/**
 * The single error type that crosses module boundaries. Domain and application code throw it
 * with a stable code; the HTTP layer renders it as RFC 9457 problem details.
 */
export class AppError extends Error {
  readonly kind: ErrorKind;
  readonly title: string;
  readonly errors: readonly FieldError[] | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly extensions: Readonly<Record<string, unknown>> | undefined;

  constructor(
    readonly code: ErrorCode,
    detail?: string,
    options: AppErrorOptions = {},
  ) {
    const definition = ERROR_CODES[code];
    super(
      detail ?? definition.title,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'AppError';
    this.kind = definition.kind;
    this.title = definition.title;
    this.errors = options.errors;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.extensions = options.extensions;
  }
}

export function isAppError(error: unknown, code?: ErrorCode): error is AppError {
  return error instanceof AppError && (code === undefined || error.code === code);
}
