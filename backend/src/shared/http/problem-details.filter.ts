import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from '../errors/app-error';
import { ERROR_CODES, HTTP_STATUS_BY_KIND, type ErrorCode } from '../errors/error-codes';
import {
  isConnectionError,
  isIllegalTransitionError,
  isRetryableTransactionError,
  isStatementTimeout,
} from '../../infrastructure/database/pg-errors';
import { currentRequestId } from './request-context';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail: string;
  requestId: string | undefined;
  errors?: ReadonlyArray<{ path: string; message: string }>;
  [extension: string]: unknown;
}

const PROBLEM_TYPE_BASE = 'https://docs.taketuk.app/problems/';

function problemType(code: ErrorCode): string {
  return `${PROBLEM_TYPE_BASE}${code.toLowerCase().replace(/_/g, '-')}`;
}

/** Maps any thrown value to an RFC 9457 problem (docs/api/API_CONVENTIONS.md §6). */
export function toProblem(
  exception: unknown,
  logger: Logger,
): { problem: ProblemDetails; retryAfter?: number } {
  const requestId = currentRequestId();

  if (exception instanceof AppError) {
    const status = HTTP_STATUS_BY_KIND[exception.kind];
    if (status >= 500) {
      logger.error(`${exception.code}: ${exception.message}`, causeStack(exception));
    }
    return {
      problem: {
        ...(exception.extensions ?? {}),
        type: problemType(exception.code),
        title: exception.title,
        status,
        code: exception.code,
        detail: exception.message,
        requestId,
        ...(exception.errors ? { errors: exception.errors } : {}),
      },
      ...(exception.retryAfterSeconds === undefined
        ? {}
        : { retryAfter: exception.retryAfterSeconds }),
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code: ErrorCode =
      status === 404
        ? 'NOT_FOUND'
        : status === 401
          ? 'AUTHENTICATION_REQUIRED'
          : status === 403
            ? 'PERMISSION_DENIED'
            : status === 429
              ? 'RATE_LIMITED'
              : status < 500
                ? 'VALIDATION_FAILED'
                : 'INTERNAL_ERROR';
    if (status >= 500) {
      logger.error(exception.message, exception.stack);
    }
    return { problem: simpleProblem(code, status, safeHttpDetail(exception, status), requestId) };
  }

  const clientError = bodyParserError(exception);
  if (clientError) {
    return {
      problem: simpleProblem(clientError.code, clientError.status, clientError.detail, requestId),
    };
  }

  if (isConnectionError(exception) || isStatementTimeout(exception)) {
    logger.error(`Database unavailable: ${(exception as Error).message}`);
    return {
      problem: simpleProblem(
        'DATABASE_UNAVAILABLE',
        503,
        ERROR_CODES.DATABASE_UNAVAILABLE.title,
        requestId,
      ),
    };
  }

  if (isRetryableTransactionError(exception)) {
    // Serialization failure or deadlock that persisted through the transaction helper's retries.
    logger.warn(`Transaction conflict persisted after retries: ${(exception as Error).message}`);
    return {
      problem: simpleProblem(
        'CONCURRENT_UPDATE',
        409,
        ERROR_CODES.CONCURRENT_UPDATE.title,
        requestId,
      ),
    };
  }

  if (isIllegalTransitionError(exception)) {
    // The database state-machine backstop fired: application checks were bypassed. This is a bug
    // (or a lost race that the use case did not anticipate) and is logged at error level.
    logger.error(`Database rejected a status transition: ${(exception as Error).message}`);
    return {
      problem: simpleProblem(
        'INVALID_STATE_TRANSITION',
        409,
        'The operation is not allowed in the current state.',
        requestId,
      ),
    };
  }

  logger.error(
    exception instanceof Error ? exception.message : 'Non-error thrown',
    exception instanceof Error ? exception.stack : undefined,
  );
  return {
    problem: simpleProblem('INTERNAL_ERROR', 500, ERROR_CODES.INTERNAL_ERROR.title, requestId),
  };
}

/** Errors raised by Express body parsing (http-errors objects with an exposed 4xx status). */
function bodyParserError(
  exception: unknown,
): { code: ErrorCode; status: number; detail: string } | undefined {
  if (exception === null || typeof exception !== 'object') return undefined;
  const { status, expose, type } = exception as {
    status?: unknown;
    expose?: unknown;
    type?: unknown;
  };
  if (typeof status !== 'number' || status < 400 || status >= 500 || expose !== true)
    return undefined;
  if (status === 413 || type === 'entity.too.large') {
    return { code: 'PAYLOAD_TOO_LARGE', status: 413, detail: 'The request body is too large.' };
  }
  return {
    code: 'VALIDATION_FAILED',
    status: 400,
    detail: 'The request body could not be parsed.',
  };
}

function simpleProblem(
  code: ErrorCode,
  status: number,
  detail: string,
  requestId: string | undefined,
): ProblemDetails {
  return {
    type: problemType(code),
    title: ERROR_CODES[code].title,
    status,
    code,
    detail,
    requestId,
  };
}

function safeHttpDetail(exception: HttpException, status: number): string {
  if (status >= 500) return ERROR_CODES.INTERNAL_ERROR.title;
  if (status === 413) return 'The request body is too large.';
  if (status === 404) return 'The requested route does not exist.';
  // Body-parser errors (malformed JSON) and similar framework 4xx errors.
  return status === 400 ? 'The request body could not be parsed.' : exception.message;
}

function causeStack(error: Error): string | undefined {
  const cause = (error as { cause?: unknown }).cause;
  return cause instanceof Error ? cause.stack : error.stack;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { problem, retryAfter } = toProblem(exception, this.logger);
    if (response.headersSent) {
      return;
    }
    if (retryAfter !== undefined) {
      response.setHeader('Retry-After', String(retryAfter));
    }
    response.status(problem.status).type('application/problem+json').send(JSON.stringify(problem));
  }
}
