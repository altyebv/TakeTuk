import { Module } from '@nestjs/common';
import { GeographyModule } from '../geography';
import { CommissionPolicyService } from './application/commission-policy.service';
import { FinanceService } from './application/finance.service';
import {
  AdminCommissionPoliciesController,
  DriverFinanceController,
} from './http/finance.controllers';
import { FinanceRepository } from './infrastructure/finance.repository';

@Module({
  imports: [GeographyModule],
  controllers: [DriverFinanceController, AdminCommissionPoliciesController],
  providers: [FinanceRepository, FinanceService, CommissionPolicyService],
  exports: [FinanceService],
})
export class FinanceModule {}
