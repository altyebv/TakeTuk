import { Injectable } from '@nestjs/common';
import type { Queryable, Tx } from '../../../infrastructure/database/database';
import { isRole, type Role } from '../../../shared/auth/roles-and-permissions';
import type { RegisteredUser } from '../../../shared/auth/auth-context';

export interface UserWithRoles {
  readonly user: RegisteredUser;
  readonly roles: Role[];
}

export interface UserContact {
  readonly userId: string;
  readonly displayName: string;
  readonly phoneE164: string | null;
}

interface UserRow {
  id: string;
  display_name: string;
  phone_e164: string | null;
  status: 'active' | 'disabled';
  roles: string[] | null;
}

const toUser = (row: UserRow): RegisteredUser => ({
  id: row.id,
  displayName: row.display_name,
  phoneE164: row.phone_e164,
  status: row.status,
});

@Injectable()
export class UsersRepository {
  async findWithRoles(db: Queryable, userId: string): Promise<UserWithRoles | null> {
    const { rows } = await db.query<UserRow>(
      `select u.id, u.display_name, u.phone_e164, u.status,
              array_remove(array_agg(r.role order by r.role), null) as roles
         from taketuk.users u
         left join taketuk.user_roles r on r.user_id = u.id
        where u.id = $1
        group by u.id`,
      [userId],
    );
    const row = rows[0];
    if (!row) return null;
    return { user: toUser(row), roles: (row.roles ?? []).filter(isRole) };
  }

  /** Inserts the user if absent. Returns true when a row was created. */
  async insertIfAbsent(
    tx: Tx,
    input: { id: string; displayName: string; phoneE164: string | null },
  ): Promise<boolean> {
    const { rowCount } = await tx.query(
      `insert into taketuk.users (id, display_name, phone_e164) values ($1, $2, $3)
       on conflict (id) do nothing`,
      [input.id, input.displayName, input.phoneE164],
    );
    return rowCount === 1;
  }

  async lockById(tx: Tx, userId: string): Promise<RegisteredUser | null> {
    const { rows } = await tx.query<UserRow>(
      `select id, display_name, phone_e164, status, null::text[] as roles
         from taketuk.users where id = $1 for update`,
      [userId],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async updateProfile(
    tx: Tx,
    userId: string,
    changes: { displayName?: string; phoneE164?: string | null },
  ): Promise<void> {
    await tx.query(
      `update taketuk.users
          set display_name = coalesce($2, display_name),
              phone_e164 = case when $3::boolean then $4 else phone_e164 end
        where id = $1`,
      [
        userId,
        changes.displayName ?? null,
        changes.phoneE164 !== undefined,
        changes.phoneE164 ?? null,
      ],
    );
  }

  /** Grants a role if not already held. Returns true when the grant is new. */
  async grantRole(tx: Tx, userId: string, role: Role, grantedBy: string | null): Promise<boolean> {
    const { rowCount } = await tx.query(
      `insert into taketuk.user_roles (user_id, role, granted_by) values ($1, $2, $3)
       on conflict (user_id, role) do nothing`,
      [userId, role, grantedBy],
    );
    return rowCount === 1;
  }

  async findContacts(db: Queryable, userIds: readonly string[]): Promise<Map<string, UserContact>> {
    if (userIds.length === 0) return new Map();
    const { rows } = await db.query<{
      id: string;
      display_name: string;
      phone_e164: string | null;
    }>(`select id, display_name, phone_e164 from taketuk.users where id = any($1::uuid[])`, [
      userIds,
    ]);
    return new Map(
      rows.map((r) => [
        r.id,
        { userId: r.id, displayName: r.display_name, phoneE164: r.phone_e164 },
      ]),
    );
  }
}
