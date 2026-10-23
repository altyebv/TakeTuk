import {
  Global,
  Module,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { DatabaseModule } from './infrastructure/database/database.module';
import { DriversModule } from './modules/drivers';
import { FinanceModule } from './modules/finance';
import { FleetModule } from './modules/fleet';
import { GeographyModule } from './modules/geography';
import { HealthModule } from './modules/health';
import { IdentityModule } from './modules/identity';
import { MobilityModule } from './modules/mobility';
import { NotificationsModule } from './modules/notifications';
import { PricingModule } from './modules/pricing';
import { AuditModule } from './platform/audit';
import { IdempotencyModule } from './platform/idempotency';
import { OutboxModule } from './platform/outbox';
import { ProblemDetailsFilter } from './shared/http/problem-details.filter';
import { RequestContextMiddleware } from './shared/http/request-context';

@Global()
@Module({})
class ConfigModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}

@Module({})
export class AppModule implements NestModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.register(config),
        DatabaseModule,
        AuditModule,
        OutboxModule,
        IdempotencyModule,
        IdentityModule,
        GeographyModule,
        FleetModule,
        DriversModule,
        FinanceModule,
        PricingModule,
        MobilityModule,
        NotificationsModule,
        HealthModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
