import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { FleetModule } from '../fleet';
import { GeographyModule } from '../geography';
import { DriverOnboardingService } from './application/driver-onboarding.service';
import { DriverOperationsService } from './application/driver-operations.service';
import { DriverReviewService } from './application/driver-review.service';
import { AdminDriversController } from './http/admin-drivers.controller';
import { DriverOnboardingController } from './http/driver-onboarding.controller';
import { DriverOperationsController } from './http/driver-operations.controller';
import {
  DOCUMENT_STORAGE,
  InMemoryDocumentStorage,
  SupabaseDocumentStorage,
  type DocumentStorage,
} from './infrastructure/document-storage';
import { DriversRepository } from './infrastructure/drivers.repository';

@Module({
  imports: [FleetModule, GeographyModule],
  controllers: [DriverOnboardingController, DriverOperationsController, AdminDriversController],
  providers: [
    DriversRepository,
    DriverOnboardingService,
    DriverOperationsService,
    DriverReviewService,
    {
      provide: DOCUMENT_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): DocumentStorage =>
        config.storage.provider === 'supabase'
          ? new SupabaseDocumentStorage(config.storage.supabaseUrl, config.storage.secretKey ?? '')
          : new InMemoryDocumentStorage(),
    },
  ],
  exports: [DriverOperationsService, DOCUMENT_STORAGE],
})
export class DriversModule {}
