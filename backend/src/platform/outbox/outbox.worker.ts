import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { Database } from '../../infrastructure/database/database';
import { PeriodicTask } from '../workers/periodic-task';
import { OutboxHandlerRegistry, type OutboxEvent } from './outbox.service';

interface ClaimedRow {
  id: number;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  attempts: number;
}

const CLAIM_SECONDS = 60;
const BACKOFF_BASE_SECONDS = 2;
const BACKOFF_MAX_SECONDS = 300;

export interface OutboxRunResult {
  readonly published: number;
  readonly retried: number;
  readonly failed: number;
}

/** Retry delay before attempt n+1: 2, 4, 8, ... seconds, capped at 5 minutes. */
export function outboxBackoffSeconds(attemptsSoFar: number): number {
  return Math.min(BACKOFF_MAX_SECONDS, BACKOFF_BASE_SECONDS * 2 ** Math.max(0, attemptsSoFar - 1));
}

/**
 * Delivers outbox events (ADR-0010). Claiming happens in a short transaction; delivery happens
 * outside any transaction; the outcome is recorded in another short transaction. A crashed
 * worker's claim lapses after CLAIM_SECONDS and the event is retried.
 */
@Injectable()
export class OutboxWorker extends PeriodicTask {
  protected readonly logger = new Logger(OutboxWorker.name);

  constructor(
    private readonly db: Database,
    private readonly registry: OutboxHandlerRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    super('outbox', config.workers.enabled, config.workers.outboxTickMs);
  }

  protected async tick(): Promise<void> {
    await this.runOnce();
  }

  async runOnce(): Promise<OutboxRunResult> {
    const events = await this.claimBatch();
    let published = 0;
    let retried = 0;
    let failed = 0;
    for (const event of events) {
      const outcome = await this.deliver(event);
      if (outcome === 'published') published += 1;
      else if (outcome === 'retry') retried += 1;
      else failed += 1;
    }
    return { published, retried, failed };
  }

  private async claimBatch(): Promise<OutboxEvent[]> {
    const { rows } = await this.db.query<ClaimedRow>(
      `update taketuk.outbox_events e
          set claimed_until = now() + make_interval(secs => $2)
        where e.id in (
          select id from taketuk.outbox_events
           where status = 'pending' and available_at <= now()
             and (claimed_until is null or claimed_until < now())
           order by available_at, id
           limit $1
           for update skip locked)
        returning e.id, e.event_type, e.aggregate_type, e.aggregate_id, e.payload, e.attempts`,
      [this.config.outbox.batchSize, CLAIM_SECONDS],
    );
    return rows
      .sort((a, b) => a.id - b.id)
      .map((r) => ({
        id: r.id,
        type: r.event_type,
        aggregateType: r.aggregate_type,
        aggregateId: r.aggregate_id,
        payload: r.payload,
        attempts: r.attempts,
      }));
  }

  private async deliver(event: OutboxEvent): Promise<'published' | 'retry' | 'failed'> {
    try {
      for (const handler of this.registry.handlersFor(event.type)) {
        await handler(event);
      }
      await this.db.query(
        `update taketuk.outbox_events
            set status = 'published', published_at = now(), claimed_until = null, last_error = null
          where id = $1`,
        [event.id],
      );
      return 'published';
    } catch (error) {
      const attempts = event.attempts + 1;
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      if (attempts >= this.config.outbox.maxAttempts) {
        this.logger.error(
          `Outbox event ${event.id} (${event.type}) failed permanently after ${attempts} attempts: ${message}`,
        );
        await this.db.query(
          `update taketuk.outbox_events
              set status = 'failed', attempts = $2, last_error = $3, claimed_until = null
            where id = $1`,
          [event.id, attempts, message],
        );
        return 'failed';
      }
      this.logger.warn(
        `Outbox event ${event.id} (${event.type}) attempt ${attempts} failed: ${message}`,
      );
      await this.db.query(
        `update taketuk.outbox_events
            set attempts = $2, last_error = $3, claimed_until = null,
                available_at = now() + make_interval(secs => $4)
          where id = $1`,
        [event.id, attempts, message, outboxBackoffSeconds(attempts)],
      );
      return 'retry';
    }
  }
}
