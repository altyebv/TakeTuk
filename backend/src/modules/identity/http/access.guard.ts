import { Injectable, Logger, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ACCESS_RULE_METADATA,
  type AccessRule,
  type AuthenticatedRequest,
} from '../../../shared/auth/access.decorators';
import { AppError } from '../../../shared/errors/app-error';
import { currentRequestContext } from '../../../shared/http/request-context';
import { IdentityService } from '../application/identity.service';

/**
 * Global guard enforcing each route's declared access rule (deny by default).
 * Identity comes only from the verified bearer token; roles come from our database.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  private readonly logger = new Logger(AccessGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly identity: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_RULE_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule) {
      this.logger.error(
        `Route ${context.getClass().name}.${context.getHandler().name} declares no access rule`,
      );
      throw new AppError('INTERNAL_ERROR', 'Route access rule missing.');
    }
    if (rule.kind === 'public') {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request.headers.authorization);
    const auth = await this.identity.authenticate(token);
    request.auth = auth;
    const requestContext = currentRequestContext();
    if (requestContext) requestContext.userId = auth.identity.userId;

    if (auth.user?.status === 'disabled') {
      throw new AppError('ACCOUNT_DISABLED');
    }
    if (rule.kind === 'authenticated') {
      return true;
    }
    if (!auth.user) {
      throw new AppError(
        'REGISTRATION_REQUIRED',
        'Complete registration before using this operation.',
      );
    }
    const missing = rule.permissions.filter((permission) => !auth.permissions.has(permission));
    if (missing.length > 0) {
      throw new AppError('PERMISSION_DENIED', undefined, {
        extensions: { missingPermissions: missing },
      });
    }
    return true;
  }
}

function bearerToken(header: string | undefined): string {
  const match = header ? /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(header) : null;
  if (!match?.[1]) {
    throw new AppError('AUTHENTICATION_REQUIRED', 'A bearer token is required.');
  }
  return match[1];
}
