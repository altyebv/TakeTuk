import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../../../shared/auth/access.decorators';
import type { AuthContext } from '../../../shared/auth/auth-context';
import { ApiEndpoint, ApiZodBody, ApiZodResponse } from '../../../shared/http/openapi';
import { validBody, validParam, validQuery } from '../../../shared/http/zod-validation.pipe';
import { POLICY_STATUSES } from '../../../shared/policy-lifecycle';
import {
  CoordinatesSchema,
  CurrencySchema,
  IdParamSchema,
  isoDate,
  LocationLabelSchema,
  MAX_AMOUNT_MINOR,
  MoneyResponseSchema,
} from '../../../shared/schemas';
import { FarePolicyService } from '../application/fare-policy.service';
import { QuoteService } from '../application/quote.service';
import type { FarePolicy, FareQuote } from '../domain/fare-policy';

const CodeSchema = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);

const CreateQuoteSchema = z.strictObject({
  serviceTypeCode: CodeSchema.default('passenger_transport'),
  pickup: CoordinatesSchema,
  pickupLabel: LocationLabelSchema.optional(),
  destination: CoordinatesSchema,
  destinationLabel: LocationLabelSchema.optional(),
});

const QuoteSchema = z
  .object({
    id: z.uuid(),
    serviceTypeCode: z.string(),
    pickup: z.object({ lat: z.number(), lng: z.number(), label: z.string().nullable() }),
    destination: z.object({ lat: z.number(), lng: z.number(), label: z.string().nullable() }),
    route: z.object({
      distanceMeters: z.number().int(),
      durationSeconds: z.number().int().nullable(),
      provider: z.string(),
      estimatedAt: z.string(),
    }),
    minimumFare: MoneyResponseSchema,
    farePolicy: z.object({ id: z.uuid(), version: z.number().int() }),
    expiresAt: z.string(),
  })
  .meta({ id: 'FareQuote' });
type QuoteResponse = z.infer<typeof QuoteSchema>;

const presentQuote = (q: FareQuote): QuoteResponse => ({
  id: q.id,
  serviceTypeCode: q.serviceTypeCode,
  pickup: { ...q.pickup, label: q.pickupLabel },
  destination: { ...q.destination, label: q.destinationLabel },
  route: {
    distanceMeters: q.routeDistanceMeters,
    durationSeconds: q.routeDurationSeconds,
    provider: q.routeProvider,
    estimatedAt: q.routeEstimatedAt.toISOString(),
  },
  minimumFare: { amountMinor: q.minimumFareMinor, currency: q.currency },
  farePolicy: { id: q.farePolicyId, version: q.farePolicyVersion },
  expiresAt: q.expiresAt.toISOString(),
});

@Controller('v1/fare-quotes')
export class FareQuotesController {
  constructor(private readonly quotes: QuoteService) {}

  @Post()
  @RequirePermissions('ride:request')
  @ApiEndpoint({
    operationId: 'pricing.createQuote',
    summary: 'Quote a trip: road distance and minimum permitted fare',
    tag: 'rides',
    description:
      'The quote is single-use, owned by the caller, and valid until `expiresAt`. Create the ride from it with a proposed fare of at least `minimumFare`.',
    problems: [
      'OUTSIDE_SERVICE_AREA',
      'SERVICE_NOT_AVAILABLE',
      'PICKUP_EQUALS_DESTINATION',
      'NO_ROUTE_FOUND',
      'ROUTING_UNAVAILABLE',
      'PRICING_NOT_CONFIGURED',
      'RATE_LIMITED',
    ],
  })
  @ApiZodBody(CreateQuoteSchema)
  @ApiZodResponse(201, QuoteSchema, 'Quote created')
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(validBody(CreateQuoteSchema)) body: z.infer<typeof CreateQuoteSchema>,
  ): Promise<QuoteResponse> {
    return presentQuote(await this.quotes.createQuote(auth, body));
  }
}

const FarePolicySchema = z
  .object({
    id: z.uuid(),
    serviceAreaCode: z.string(),
    serviceTypeCode: z.string(),
    version: z.number().int(),
    status: z.enum(POLICY_STATUSES),
    currency: z.string(),
    baseFareMinor: z.number().int(),
    perKmFareMinor: z.number().int(),
    minimumFareMinor: z.number().int(),
    roundingIncrementMinor: z.number().int(),
    notes: z.string().nullable(),
    createdAt: z.string(),
    activatedAt: z.string().nullable(),
    retiredAt: z.string().nullable(),
  })
  .meta({ id: 'FarePolicy' });
type FarePolicyResponse = z.infer<typeof FarePolicySchema>;

const presentPolicy = (p: FarePolicy): FarePolicyResponse => ({
  id: p.id,
  serviceAreaCode: p.serviceAreaCode,
  serviceTypeCode: p.serviceTypeCode,
  version: p.version,
  status: p.status,
  currency: p.currency,
  baseFareMinor: p.baseFareMinor,
  perKmFareMinor: p.perKmFareMinor,
  minimumFareMinor: p.minimumFareMinor,
  roundingIncrementMinor: p.roundingIncrementMinor,
  notes: p.notes,
  createdAt: p.createdAt.toISOString(),
  activatedAt: isoDate(p.activatedAt),
  retiredAt: isoDate(p.retiredAt),
});

const amount = (min: number) => z.number().int().min(min).max(MAX_AMOUNT_MINOR);

const CreateFarePolicySchema = z.strictObject({
  serviceAreaCode: CodeSchema,
  serviceTypeCode: CodeSchema,
  currency: CurrencySchema,
  baseFareMinor: amount(0),
  perKmFareMinor: amount(0),
  minimumFareMinor: amount(1),
  roundingIncrementMinor: amount(1),
  notes: z.string().trim().min(1).max(1000).optional(),
});

const ListPoliciesQuerySchema = z.strictObject({
  serviceAreaCode: CodeSchema.optional(),
  serviceTypeCode: CodeSchema.optional(),
  status: z.enum(POLICY_STATUSES).optional(),
});

@Controller('v1/admin/fare-policies')
export class AdminFarePoliciesController {
  constructor(private readonly policies: FarePolicyService) {}

  @Get()
  @RequirePermissions('policy:manage')
  @ApiEndpoint({
    operationId: 'adminFarePolicies.list',
    summary: 'List fare policy versions',
    tag: 'admin',
  })
  @ApiZodResponse(200, z.object({ items: z.array(FarePolicySchema) }), 'Policies')
  async list(
    @Query(validQuery(ListPoliciesQuerySchema)) query: z.infer<typeof ListPoliciesQuerySchema>,
  ): Promise<{ items: FarePolicyResponse[] }> {
    return { items: (await this.policies.list(query)).map(presentPolicy) };
  }

  @Post()
  @RequirePermissions('policy:manage')
  @ApiEndpoint({
    operationId: 'adminFarePolicies.create',
    summary: 'Create a draft fare policy version',
    tag: 'admin',
    problems: ['SERVICE_AREA_NOT_FOUND'],
  })
  @ApiZodBody(CreateFarePolicySchema)
  @ApiZodResponse(201, FarePolicySchema, 'Draft created')
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(validBody(CreateFarePolicySchema)) body: z.infer<typeof CreateFarePolicySchema>,
  ): Promise<FarePolicyResponse> {
    return presentPolicy(await this.policies.createDraft(auth, body));
  }

  @Post(':id/activate')
  @RequirePermissions('policy:manage')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'adminFarePolicies.activate',
    summary: 'Activate a draft (retires the current active version)',
    tag: 'admin',
    problems: ['POLICY_NOT_FOUND', 'INVALID_STATE_TRANSITION'],
  })
  @ApiZodResponse(200, FarePolicySchema, 'Activated')
  async activate(
    @CurrentAuth() auth: AuthContext,
    @Param(validParam(IdParamSchema)) params: z.infer<typeof IdParamSchema>,
  ): Promise<FarePolicyResponse> {
    return presentPolicy(await this.policies.activate(auth, params.id));
  }

  @Post(':id/retire')
  @RequirePermissions('policy:manage')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'adminFarePolicies.retire',
    summary: 'Retire a policy version (new quotes then fail until another is active)',
    tag: 'admin',
    problems: ['POLICY_NOT_FOUND'],
  })
  @ApiZodResponse(200, FarePolicySchema, 'Retired')
  async retire(
    @CurrentAuth() auth: AuthContext,
    @Param(validParam(IdParamSchema)) params: z.infer<typeof IdParamSchema>,
  ): Promise<FarePolicyResponse> {
    return presentPolicy(await this.policies.retire(auth, params.id));
  }
}
