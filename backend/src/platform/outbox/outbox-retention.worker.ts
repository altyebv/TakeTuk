import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { Database } from '../../infrastructure/database/database';
import { PeriodicTask } from '../workers/periodic-task';

/** Retention for delivered outbox events (operational history only; business state is elsewhere). */
const PUBLISHED_OUTBOX_RETENTION_DAYS = 7;

/** Deletes delivered outbox events after the retention period. Failed events are kept for operators. */
@Injectable()
export class OutboxRetentionWorker extends PeriodicTask {
  protected readonly logger = new Logger(OutboxRetentionWorker.name);

  constructor(
    private readonly db: Database,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    super('outbox-retention', config.workers.enabled, config.workers.maintenanceTickMs);
  }

  protected async tick(): Promise<void> {
    await this.runOnce();
  }

  async runOnce(): Promise<number> {
    const { rowCount } = await this.db.query(
      `delete from taketuk.outbox_events
        where status = 'published' and published_at < now() - make_interval(days => $1)`,
      [PUBLISHED_OUTBOX_RETENTION_DAYS],
    );
    return rowCount;
  }
}
