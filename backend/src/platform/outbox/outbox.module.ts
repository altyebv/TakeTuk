import { Global, Module } from '@nestjs/common';
import { OutboxHandlerRegistry, OutboxService } from './outbox.service';
import { OutboxRetentionWorker } from './outbox-retention.worker';
import { OutboxWorker } from './outbox.worker';

@Global()
@Module({
  providers: [OutboxService, OutboxHandlerRegistry, OutboxWorker, OutboxRetentionWorker],
  exports: [OutboxService, OutboxHandlerRegistry, OutboxWorker],
})
export class OutboxModule {}
