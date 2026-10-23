import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance';
import { GeographyModule } from '../geography';
import { FarePolicyService } from './application/fare-policy.service';
import { QuoteCleanupWorker, QuoteService } from './application/quote.service';
import { AdminFarePoliciesController, FareQuotesController } from './http/pricing.controllers';
import { FarePoliciesRepository } from './infrastructure/fare-policies.repository';
import { FareQuotesRepository } from './infrastructure/fare-quotes.repository';

@Module({
  imports: [GeographyModule, FinanceModule],
  controllers: [FareQuotesController, AdminFarePoliciesController],
  providers: [
    FarePoliciesRepository,
    FareQuotesRepository,
    FarePolicyService,
    QuoteService,
    QuoteCleanupWorker,
  ],
  exports: [QuoteService, FarePolicyService],
})
export class PricingModule {}
