import { Inject, Injectable } from '@nestjs/common';
import { Database, type Queryable, type Tx } from '../../../infrastructure/database/database';
import { AuditService } from '../../../platform/audit';
import type {
  Actor,
  AuthContext,
  RegisteredUser,
  VerifiedIdentity,
} from '../../../shared/auth/auth-context';
import { permissionsFor, type Role } from '../../../shared/auth/roles-and-permissions';
import { AppError } from '../../../shared/errors/app-error';
import { TOKEN_VERIFIER, type TokenVerifier } from '../infrastructure/supabase-token-verifier';
import { UsersRepository, type UserContact } from '../infrastructure/users.repository';

export interface RegistrationResult {
  readonly user: RegisteredUser;
  readonly roles: readonly Role[];
  /** true when the user record or the requested role was newly created. */
  readonly changed: boolean;
}

@Injectable()
export class IdentityService {
  constructor(
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    private readonly db: Database,
    private readonly users: UsersRepository,
    private readonly audit: AuditService,
  ) {}

  /** Token → identity → TAKE-TUK user and roles (authoritative, from our database). */
  async authenticate(token: string): Promise<AuthContext> {
    const identity = await this.verifier.verify(token);
    const found = await this.users.findWithRoles(this.db, identity.userId);
    const roles = found?.roles ?? [];
    return { identity, user: found?.user ?? null, roles, permissions: permissionsFor(roles) };
  }

  /**
   * Ensures a user record exists for a verified identity and grants a self-service role
   * (`passenger` or `driver`). `admin` can never be granted here.
   */
  async ensureUserWithRole(
    tx: Tx,
    identity: VerifiedIdentity,
    displayName: string,
    role: Extract<Role, 'passenger' | 'driver'>,
  ): Promise<RegistrationResult> {
    const created = await this.users.insertIfAbsent(tx, {
      id: identity.userId,
      displayName,
      phoneE164: identity.phoneE164,
    });
    const user = await this.users.lockById(tx, identity.userId);
    if (!user) {
      throw new AppError('INTERNAL_ERROR', 'User record missing after insert.');
    }
    if (user.status === 'disabled') {
      throw new AppError('ACCOUNT_DISABLED');
    }
    if (!created && identity.phoneE164 && identity.phoneE164 !== user.phoneE164) {
      // Keep the contact number in step with the verified token (SECURITY.md §7).
      await this.users.updateProfile(tx, user.id, { phoneE164: identity.phoneE164 });
    }
    const granted = await this.users.grantRole(tx, user.id, role, null);
    const actor: Actor = { type: 'user', userId: user.id, role };
    if (created) {
      await this.audit.record(tx, {
        actor,
        action: 'user.registered',
        entityType: 'user',
        entityId: user.id,
      });
    }
    if (granted) {
      await this.audit.record(tx, {
        actor,
        action: 'user.role_granted',
        entityType: 'user',
        entityId: user.id,
        metadata: { role, via: 'self_registration' },
      });
    }
    const refreshed = await this.users.findWithRoles(tx, user.id);
    return {
      user: refreshed?.user ?? user,
      roles: refreshed?.roles ?? [role],
      changed: created || granted,
    };
  }

  async registerPassenger(
    identity: VerifiedIdentity,
    displayName: string,
  ): Promise<RegistrationResult> {
    return this.db.transaction((tx) =>
      this.ensureUserWithRole(tx, identity, displayName, 'passenger'),
    );
  }

  async updateDisplayName(auth: AuthContext, displayName: string): Promise<RegisteredUser> {
    const userId = requireRegistered(auth).id;
    return this.db.transaction(async (tx) => {
      await this.users.updateProfile(tx, userId, {
        displayName,
        ...(auth.identity.phoneE164 ? { phoneE164: auth.identity.phoneE164 } : {}),
      });
      const user = await this.users.lockById(tx, userId);
      if (!user) throw new AppError('USER_NOT_FOUND');
      return user;
    });
  }

  async contacts(db: Queryable, userIds: readonly string[]): Promise<Map<string, UserContact>> {
    return this.users.findContacts(db, userIds);
  }
}

export function requireRegistered(auth: AuthContext): RegisteredUser {
  if (!auth.user) throw new AppError('REGISTRATION_REQUIRED');
  return auth.user;
}
