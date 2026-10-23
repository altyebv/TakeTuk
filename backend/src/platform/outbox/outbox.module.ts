import { Global, Module } from '@nestjs/common';
import { OutboxHandlerRegistry, OutboxService } from './outbox.service';
import { OutboxWorker } from './outbox.worker';

@Global()
@Module({
  providers: [OutboxService, OutboxHandlerRegistry, OutboxWorker],
  exports: [OutboxService, OutboxHandlerRegistry, OutboxWorker],
})
export class OutboxModule {}
