import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { Database } from '../../infrastructure/database/database';
import { PeriodicTask } from '../workers/periodic-task';

/** Deletes expired idempotency records (STATE_MACHINES §12). */
@Injectable()
export class MaintenanceWorker extends PeriodicTask {
  protected readonly logger = new Logger(MaintenanceWorker.name);

  constructor(
    private readonly db: Database,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    super('idempotency-cleanup', config.workers.enabled, config.workers.maintenanceTickMs);
  }

  protected async tick(): Promise<void> {
    await this.runOnce();
  }

  async runOnce(): Promise<{ idempotencyKeysDeleted: number }> {
    const keys = await this.db.query(
      `delete from taketuk.idempotency_keys where expires_at <= now()`,
    );
    return { idempotencyKeysDeleted: keys.rowCount };
  }
}
