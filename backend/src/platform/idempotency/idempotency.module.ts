import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';
import { MaintenanceWorker } from './maintenance.worker';

@Global()
@Module({
  providers: [IdempotencyService, MaintenanceWorker],
  exports: [IdempotencyService, MaintenanceWorker],
})
export class IdempotencyModule {}
