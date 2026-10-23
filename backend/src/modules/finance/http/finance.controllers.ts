import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../../../shared/auth/access.decorators';
import type { AuthContext } from '../../../shared/auth/auth-context';
import { ApiEndpoint, ApiZodBody, ApiZodResponse } from '../../../shared/http/openapi';
import { validBody, validParam, validQuery } from '../../../shared/http/zod-validation.pipe';
import { PageQuerySchema } from '../../../shared/pagination';
import { POLICY_STATUSES } from '../../../shared/policy-lifecycle';
import { IdParamSchema, isoDate, MoneyResponseSchema, MoneySchema } from '../../../shared/schemas';
import { CommissionPolicyService } from '../application/commission-policy.service';
import { FinanceService } from '../application/finance.service';
import { PAYMENT_STATUSES, type CommissionPolicy, type RidePayment } from '../domain/finance';

const CodeSchema = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);

export const RidePaymentSchema = z.object({
  rideId: z.uuid(),
  method: z.literal('cash'),
  status: z.enum(PAYMENT_STATUSES),
  amountDue: MoneyResponseSchema,
  amountCollected: MoneyResponseSchema.nullable(),
  reportedAt: z.string().nullable(),
});
export type RidePaymentResponse = z.infer<typeof RidePaymentSchema>;

export const presentPayment = (p: RidePayment): RidePaymentResponse => ({
  rideId: p.rideId,
  method: p.method,
  status: p.status,
  amountDue: { amountMinor: p.amountDueMinor, currency: p.currency },
  amountCollected:
    p.amountCollectedMinor === null
      ? null
      : { amountMinor: p.amountCollectedMinor, currency: p.currency },
  reportedAt: isoDate(p.reportedAt),
});

const CashReportSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('collected'), amountCollected: MoneySchema }),
  z.strictObject({ outcome: z.literal('not_collected') }),
]);

const EarningsSchema = z.object({
  commissionOwed: z.array(MoneyResponseSchema),
  items: z.array(
    z.object({
      rideId: z.uuid(),
      completedAt: z.string(),
      agreedFare: MoneyResponseSchema,
      amountCollected: MoneyResponseSchema.nullable(),
      paymentStatus: z.enum(PAYMENT_STATUSES),
      commission: MoneyResponseSchema,
    }),
  ),
  nextCursor: z.string().nullable(),
});

@Controller('v1/driver')
export class DriverFinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Post('rides/:id/cash-collection')
  @RequirePermissions('driver:operate')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'finance.reportCashCollection',
    summary: 'Report the cash collected for a completed ride, or that the passenger did not pay',
    tag: 'driver-operations',
    description:
      'Naturally idempotent: repeating the same report returns 200; a different report returns 409.',
    problems: ['PAYMENT_NOT_FOUND', 'PAYMENT_ALREADY_REPORTED', 'CURRENCY_MISMATCH'],
  })
  @ApiZodBody(CashReportSchema)
  @ApiZodResponse(200, RidePaymentSchema, 'Payment record')
  async reportCash(
    @CurrentAuth() auth: AuthContext,
    @Param(validParam(IdParamSchema)) params: z.infer<typeof IdParamSchema>,
    @Body(validBody(CashReportSchema)) body: z.infer<typeof CashReportSchema>,
  ): Promise<RidePaymentResponse> {
    const payment = await this.finance.reportCash(
      auth,
      params.id,
      body.outcome === 'collected'
        ? { outcome: 'collected', amount: body.amountCollected }
        : { outcome: 'not_collected' },
    );
    return presentPayment(payment);
  }

  @Get('earnings')
  @RequirePermissions('driver:operate')
  @ApiEndpoint({
    operationId: 'finance.driverEarnings',
    summary: 'Completed-ride fares, reported collections, commissions and commission owed',
    tag: 'driver-operations',
  })
  @ApiZodResponse(200, EarningsSchema, 'Earnings')
  async earnings(
    @CurrentAuth() auth: AuthContext,
    @Query(validQuery(PageQuerySchema)) query: z.infer<typeof PageQuerySchema>,
  ): Promise<z.infer<typeof EarningsSchema>> {
    const { commissionOwed, page } = await this.finance.driverEarnings(auth, query);
    return {
      commissionOwed,
      items: page.items.map((row) => ({
        rideId: row.payment.rideId,
        completedAt: row.payment.createdAt.toISOString(),
        agreedFare: { amountMinor: row.payment.amountDueMinor, currency: row.payment.currency },
        amountCollected:
          row.payment.amountCollectedMinor === null
            ? null
            : { amountMinor: row.payment.amountCollectedMinor, currency: row.payment.currency },
        paymentStatus: row.payment.status,
        commission: { amountMinor: row.commissionMinor, currency: row.payment.currency },
      })),
      nextCursor: page.nextCursor,
    };
  }
}

const CommissionPolicySchema = z.object({
  id: z.uuid(),
  serviceAreaCode: z.string(),
  serviceTypeCode: z.string(),
  version: z.number().int(),
  status: z.enum(POLICY_STATUSES),
  rateBasisPoints: z.number().int(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  activatedAt: z.string().nullable(),
  retiredAt: z.string().nullable(),
});
type CommissionPolicyResponse = z.infer<typeof CommissionPolicySchema>;

const presentCommissionPolicy = (p: CommissionPolicy): CommissionPolicyResponse => ({
  id: p.id,
  serviceAreaCode: p.serviceAreaCode,
  serviceTypeCode: p.serviceTypeCode,
  version: p.version,
  status: p.status,
  rateBasisPoints: p.rateBasisPoints,
  notes: p.notes,
  createdAt: p.createdAt.toISOString(),
  activatedAt: isoDate(p.activatedAt),
  retiredAt: isoDate(p.retiredAt),
});

const CreateCommissionPolicySchema = z.strictObject({
  serviceAreaCode: CodeSchema,
  serviceTypeCode: CodeSchema,
  rateBasisPoints: z.number().int().min(0).max(10_000),
  notes: z.string().trim().min(1).max(1000).optional(),
});

const ListPoliciesQuerySchema = z.strictObject({
  serviceAreaCode: CodeSchema.optional(),
  serviceTypeCode: CodeSchema.optional(),
  status: z.enum(POLICY_STATUSES).optional(),
});

@Controller('v1/admin/commission-policies')
export class AdminCommissionPoliciesController {
  constructor(private readonly policies: CommissionPolicyService) {}

  @Get()
  @RequirePermissions('policy:manage')
  @ApiEndpoint({
    operationId: 'adminCommissionPolicies.list',
    summary: 'List commission policy versions',
    tag: 'admin',
  })
  @ApiZodResponse(200, z.object({ items: z.array(CommissionPolicySchema) }), 'Policies')
  async list(
    @Query(validQuery(ListPoliciesQuerySchema)) query: z.infer<typeof ListPoliciesQuerySchema>,
  ): Promise<{ items: CommissionPolicyResponse[] }> {
    return { items: (await this.policies.list(query)).map(presentCommissionPolicy) };
  }

  @Post()
  @RequirePermissions('policy:manage')
  @ApiEndpoint({
    operationId: 'adminCommissionPolicies.create',
    summary: 'Create a draft commission policy version',
    tag: 'admin',
    problems: ['SERVICE_AREA_NOT_FOUND'],
  })
  @ApiZodBody(CreateCommissionPolicySchema)
  @ApiZodResponse(201, CommissionPolicySchema, 'Draft created')
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(validBody(CreateCommissionPolicySchema))
    body: z.infer<typeof CreateCommissionPolicySchema>,
  ): Promise<CommissionPolicyResponse> {
    return presentCommissionPolicy(await this.policies.createDraft(auth, body));
  }

  @Post(':id/activate')
  @RequirePermissions('policy:manage')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'adminCommissionPolicies.activate',
    summary: 'Activate a draft (retires the current active version)',
    tag: 'admin',
    problems: ['POLICY_NOT_FOUND', 'INVALID_STATE_TRANSITION'],
  })
  @ApiZodResponse(200, CommissionPolicySchema, 'Activated')
  async activate(
    @CurrentAuth() auth: AuthContext,
    @Param(validParam(IdParamSchema)) params: z.infer<typeof IdParamSchema>,
  ): Promise<CommissionPolicyResponse> {
    return presentCommissionPolicy(await this.policies.activate(auth, params.id));
  }

  @Post(':id/retire')
  @RequirePermissions('policy:manage')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'adminCommissionPolicies.retire',
    summary: 'Retire a policy version',
    tag: 'admin',
    problems: ['POLICY_NOT_FOUND'],
  })
  @ApiZodResponse(200, CommissionPolicySchema, 'Retired')
  async retire(
    @CurrentAuth() auth: AuthContext,
    @Param(validParam(IdParamSchema)) params: z.infer<typeof IdParamSchema>,
  ): Promise<CommissionPolicyResponse> {
    return presentCommissionPolicy(await this.policies.retire(auth, params.id));
  }
}
