import { Injectable, Logger } from '@nestjs/common';
import type { Tx } from '../../infrastructure/database/database';

export interface OutboxEventInput {
  /** Dotted event name, e.g. `ride.assigned`. */
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface OutboxEvent {
  readonly id: number;
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
  readonly attempts: number;
}

/** Handlers are invoked at least once per event and must tolerate duplicates (ADR-0010). */
export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

/**
 * Transactional outbox: events are written in the same transaction as the state change that
 * produced them and delivered later by the OutboxWorker.
 */
@Injectable()
export class OutboxService {
  async enqueue(tx: Tx, event: OutboxEventInput): Promise<void> {
    await tx.query(
      `insert into taketuk.outbox_events (event_type, aggregate_type, aggregate_id, payload)
       values ($1, $2, $3, $4)`,
      [event.type, event.aggregateType, event.aggregateId, JSON.stringify(event.payload)],
    );
  }
}

@Injectable()
export class OutboxHandlerRegistry {
  private readonly logger = new Logger(OutboxHandlerRegistry.name);
  private readonly handlers = new Map<string, OutboxHandler[]>();

  register(eventType: string, handler: OutboxHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
    this.logger.debug(`Registered outbox handler for ${eventType}`);
  }

  handlersFor(eventType: string): readonly OutboxHandler[] {
    return this.handlers.get(eventType) ?? [];
  }
}
