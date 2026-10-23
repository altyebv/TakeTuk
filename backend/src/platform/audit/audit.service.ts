import { Injectable } from '@nestjs/common';
import type { Queryable, Tx } from '../../infrastructure/database/database';
import { actorRole, actorUserId, type Actor } from '../../shared/auth/auth-context';
import { currentRequestId } from '../../shared/http/request-context';
import { decodeCursor, invalidCursor, toPage, type Page } from '../../shared/pagination';

export interface AuditEntry {
  readonly actor: Actor;
  /** Dotted, lower-case action name, e.g. `ride.assigned` (STATE_MACHINES). */
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  /** Non-sensitive context only: never tokens, documents, or contact details. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AuditEventView {
  readonly id: number;
  readonly occurredAt: string;
  readonly actorType: 'user' | 'system';
  readonly actorUserId: string | null;
  readonly actorRole: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly requestId: string | null;
  readonly metadata: Record<string, unknown>;
}

interface AuditRow {
  id: number;
  occurred_at: Date;
  actor_type: 'user' | 'system';
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  request_id: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Append-only audit trail. Always written inside the transaction of the change it describes,
 * so the record and the effect commit or roll back together (SECURITY.md §8).
 */
@Injectable()
export class AuditService {
  async record(tx: Tx, entry: AuditEntry): Promise<void> {
    const metadata =
      entry.actor.type === 'system'
        ? { ...entry.metadata, component: entry.actor.component }
        : (entry.metadata ?? {});
    await tx.query(
      `insert into taketuk.audit_events
         (actor_type, actor_user_id, actor_role, action, entity_type, entity_id, request_id, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.actor.type,
        actorUserId(entry.actor),
        actorRole(entry.actor),
        entry.action,
        entry.entityType,
        entry.entityId,
        currentRequestId() ?? null,
        JSON.stringify(metadata),
      ],
    );
  }

  async list(
    db: Queryable,
    filter: {
      entityType?: string | undefined;
      entityId?: string | undefined;
      limit: number;
      cursor?: string | undefined;
    },
  ): Promise<Page<AuditEventView>> {
    // Audit ids are monotonically increasing identities, so the id alone is the keyset.
    const keyset = decodeCursor(filter.cursor);
    if (keyset && !/^[0-9]{1,18}$/.test(keyset.id)) throw invalidCursor();
    const { rows } = await db.query<AuditRow>(
      `select id, occurred_at, actor_type, actor_user_id, actor_role, action, entity_type, entity_id,
              request_id, metadata
         from taketuk.audit_events
        where ($1::text is null or entity_type = $1)
          and ($2::text is null or entity_id = $2)
          and ($3::bigint is null or id < $3)
        order by id desc
        limit $4`,
      [
        filter.entityType ?? null,
        filter.entityId ?? null,
        keyset ? Number(keyset.id) : null,
        filter.limit + 1,
      ],
    );
    return toPage(
      rows,
      filter.limit,
      (r): AuditEventView => ({
        id: r.id,
        occurredAt: r.occurred_at.toISOString(),
        actorType: r.actor_type,
        actorUserId: r.actor_user_id,
        actorRole: r.actor_role,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        requestId: r.request_id,
        metadata: r.metadata,
      }),
      (r) => ({ sortKey: 'id', id: String(r.id) }),
    );
  }
}
