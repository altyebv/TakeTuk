import { AppError } from '../errors/app-error';
import type { Permission, Role } from './roles-and-permissions';

/** Identity proven by a verified Supabase access token. Nothing here comes from request bodies. */
export interface VerifiedIdentity {
  readonly userId: string;
  readonly phoneE164: string | null;
  readonly email: string | null;
}

export interface RegisteredUser {
  readonly id: string;
  readonly displayName: string;
  readonly phoneE164: string | null;
  readonly status: 'active' | 'disabled';
}

export interface AuthContext {
  readonly identity: VerifiedIdentity;
  /** null when the token is valid but the person has not registered with TAKE-TUK. */
  readonly user: RegisteredUser | null;
  readonly roles: readonly Role[];
  readonly permissions: ReadonlySet<Permission>;
}

/** Who performed an action, as recorded in audit events and cancellation facts. */
export type Actor =
  | { readonly type: 'user'; readonly userId: string; readonly role: Role }
  | { readonly type: 'system'; readonly component: string };

export type ActorRole = Role | 'system';

export function actorRole(actor: Actor): ActorRole {
  return actor.type === 'user' ? actor.role : 'system';
}

export function actorUserId(actor: Actor): string | null {
  return actor.type === 'user' ? actor.userId : null;
}

/** The caller acting in a specific role. Fails closed if the role is not held. */
export function actorAs(auth: AuthContext, role: Role): Actor & { type: 'user' } {
  if (!auth.user || !auth.roles.includes(role)) {
    throw new AppError('PERMISSION_DENIED', `This operation requires the ${role} role.`);
  }
  return { type: 'user', userId: auth.user.id, role };
}

export const systemActor = (component: string): Actor => ({ type: 'system', component });
