import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { Database } from '../../infrastructure/database/database';
import { PeriodicTask } from '../workers/periodic-task';

/** Retention for delivered outbox events (operational history only; business state is elsewhere). */
const PUBLISHED_OUTBOX_RETENTION_DAYS = 7;

/** Deletes expired idempotency records and old delivered outbox events. */
@Injectable()
export class MaintenanceWorker extends PeriodicTask {
  protected readonly logger = new Logger(MaintenanceWorker.name);

  constructor(
    private readonly db: Database,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    super('maintenance', config.workers.enabled, config.workers.maintenanceTickMs);
  }

  protected async tick(): Promise<void> {
    await this.runOnce();
  }

  async runOnce(): Promise<{ idempotencyKeysDeleted: number; outboxEventsDeleted: number }> {
    const keys = await this.db.query(
      `delete from taketuk.idempotency_keys where expires_at <= now()`,
    );
    const outbox = await this.db.query(
      `delete from taketuk.outbox_events
        where status = 'published' and published_at < now() - make_interval(days => $1)`,
      [PUBLISHED_OUTBOX_RETENTION_DAYS],
    );
    return { idempotencyKeysDeleted: keys.rowCount, outboxEventsDeleted: outbox.rowCount };
  }
}
