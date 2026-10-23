import {
  applyDecorators,
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExtension } from '@nestjs/swagger';
import type { Request } from 'express';
import { AppError } from '../errors/app-error';
import type { AuthContext } from './auth-context';
import type { Permission } from './roles-and-permissions';

/**
 * Every route declares exactly one access rule (deny by default; API_CONVENTIONS §3).
 * The global AccessGuard (identity module) enforces it; a route without a rule fails closed.
 */
export type AccessRule =
  | { readonly kind: 'public' }
  | { readonly kind: 'authenticated' }
  | { readonly kind: 'registered'; readonly permissions: readonly Permission[] };

export const ACCESS_RULE_METADATA = 'taketuk:access-rule';

/** No token required (health checks only). */
export const Public = () =>
  SetMetadata(ACCESS_RULE_METADATA, { kind: 'public' } satisfies AccessRule);

/** Any verified token, including users who have not registered yet. */
export const Authenticated = () =>
  applyDecorators(
    SetMetadata(ACCESS_RULE_METADATA, { kind: 'authenticated' } satisfies AccessRule),
    ApiBearerAuth(),
  );

/** A registered, active user holding every listed permission (none listed = any registered user). */
export const RequirePermissions = (...permissions: Permission[]) =>
  applyDecorators(
    SetMetadata(ACCESS_RULE_METADATA, { kind: 'registered', permissions } satisfies AccessRule),
    ApiBearerAuth(),
    ApiExtension('x-taketuk-permissions', permissions),
  );

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

/** The verified caller. Only available on non-public routes (set by the AccessGuard). */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) {
      throw new AppError('AUTHENTICATION_REQUIRED');
    }
    return request.auth;
  },
);
