import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Per-request observability context (request id, authenticated user id). Used only for logging
 * and audit metadata — never to carry transactions or business state.
 */
export interface RequestContext {
  readonly requestId: string;
  userId: string | undefined;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

const CLIENT_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const supplied = req.header('x-request-id');
    const requestId = supplied && CLIENT_REQUEST_ID.test(supplied) ? supplied : randomUUID();
    const context: RequestContext = { requestId, userId: undefined };
    const startedAt = process.hrtime.bigint();

    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      // Route pattern, never the raw URL: query strings and ids can carry personal data.
      const route = (req.route as { path?: string } | undefined)?.path ?? '(unmatched)';
      const line = {
        requestId,
        method: req.method,
        route: `${req.baseUrl}${route}`,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
        userId: context.userId,
      };
      if (res.statusCode >= 500) {
        this.logger.error(line);
      } else {
        this.logger.log(line);
      }
    });

    storage.run(context, () => {
      next();
    });
  }
}
