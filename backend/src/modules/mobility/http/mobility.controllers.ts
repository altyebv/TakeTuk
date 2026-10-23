import { Body, Controller, Get, Headers, HttpCode, Post, Res } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { requireIdempotencyKey } from '../../../platform/idempotency';
import { CurrentAuth, RequirePermissions } from '../../../shared/auth/access.decorators';
import type { AuthContext } from '../../../shared/auth/auth-context';
import {
  ApiEndpoint,
  ApiZodBody,
  ApiZodResponse,
  ZodParams,
  ZodQuery,
} from '../../../shared/http/openapi';
import { validBody } from '../../../shared/http/zod-validation.pipe';
import { PageQuerySchema, pageResponseSchema, type Page } from '../../../shared/pagination';
import { IdParamSchema, MoneySchema, ReasonSchema } from '../../../shared/schemas';
import { DriverOffersService } from '../application/driver-offers.service';
import { RideRequestService } from '../application/ride-request.service';
import {
  AdminRideSchema,
  DriverOfferSchema,
  DriverRideSchema,
  PassengerRideSchema,
  type AdminRideView,
  type DriverOfferView,
  type DriverRideView,
  type PassengerRideView,
} from '../application/ride-views';
import { TripService } from '../application/trip.service';

const CreateRideSchema = z.strictObject({
  quoteId: z.uuid(),
  proposedFare: MoneySchema,
});
const PassengerCancelSchema = z.strictObject({ reason: ReasonSchema.optional() });
const RequiredReasonSchema = z.strictObject({ reason: ReasonSchema });
const CounterofferSchema = z.strictObject({ amount: MoneySchema });
const RideOfferParamsSchema = z.strictObject({ id: z.uuid(), offerId: z.uuid() });

type IdParams = z.infer<typeof IdParamSchema>;

@Controller('v1/rides')
export class PassengerRidesController {
  constructor(private readonly rides: RideRequestService) {}

  @Post()
  @RequirePermissions('ride:request')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'One key per user intent; reuse it on every retry (API_CONVENTIONS §8).',
  })
  @ApiEndpoint({
    operationId: 'rides.create',
    summary: 'Request a ride from a quote with a proposed fare',
    tag: 'rides',
    description:
      'The proposed fare must be at least the quote’s minimum fare. The ride starts `searching`; eligible drivers receive offers automatically. Nothing is confirmed until a fare is agreed.',
    problems: [
      'IDEMPOTENCY_KEY_REQUIRED',
      'IDEMPOTENCY_KEY_REUSED',
      'QUOTE_NOT_FOUND',
      'QUOTE_EXPIRED',
      'QUOTE_ALREADY_USED',
      'FARE_BELOW_MINIMUM',
      'CURRENCY_MISMATCH',
      'RIDE_ALREADY_OPEN',
    ],
  })
  @ApiZodBody(CreateRideSchema)
  @ApiZodResponse(201, PassengerRideSchema, 'Ride created (or replayed)')
  async create(
    @CurrentAuth() auth: AuthContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(validBody(CreateRideSchema)) body: z.infer<typeof CreateRideSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PassengerRideView> {
    const key = requireIdempotencyKey(idempotencyKey);
    const result = await this.rides.createRide(auth, body, key);
    res.status(result.status);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }

  @Get()
  @RequirePermissions('ride:request')
  @ApiEndpoint({
    operationId: 'rides.list',
    summary: 'The caller’s rides, newest first',
    tag: 'rides',
  })
  @ApiZodResponse(200, pageResponseSchema(PassengerRideSchema), 'Rides')
  list(
    @CurrentAuth() auth: AuthContext,
    @ZodQuery(PageQuerySchema) query: z.infer<typeof PageQuerySchema>,
  ): Promise<Page<PassengerRideView>> {
    return this.rides.listRides(auth, query);
  }

  @Get(':id')
  @RequirePermissions('ride:request')
  @ApiEndpoint({
    operationId: 'rides.get',
    summary: 'A ride with negotiation state, assigned driver and payment',
    tag: 'rides',
    problems: ['RIDE_NOT_FOUND'],
  })
  @ApiZodResponse(200, PassengerRideSchema, 'Ride')
  get(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(IdParamSchema) params: IdParams,
  ): Promise<PassengerRideView> {
    return this.rides.getRide(auth, params.id);
  }

  @Post(':id/cancel')
  @RequirePermissions('ride:request')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'rides.cancel',
    summary: 'Cancel a ride (allowed until the trip starts)',
    tag: 'rides',
    problems: ['RIDE_NOT_FOUND', 'INVALID_STATE_TRANSITION'],
  })
  @ApiZodBody(PassengerCancelSchema)
  @ApiZodResponse(200, PassengerRideSchema, 'Cancelled')
  cancel(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(IdParamSchema) params: IdParams,
    @Body(validBody(PassengerCancelSchema)) body: z.infer<typeof PassengerCancelSchema>,
  ): Promise<PassengerRideView> {
    return this.rides.cancel(auth, params.id, body.reason ?? null);
  }

  @Post(':id/offers/:offerId/accept-counteroffer')
  @RequirePermissions('ride:request')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'rides.acceptCounteroffer',
    summary: 'Accept a driver’s counteroffer (confirms the ride at that fare)',
    tag: 'rides',
    problems: [
      'RIDE_NOT_FOUND',
      'OFFER_NOT_FOUND',
      'OFFER_NOT_OPEN',
      'OFFER_EXPIRED',
      'RIDE_NO_LONGER_AVAILABLE',
      'DRIVER_NOT_AVAILABLE',
      'DRIVER_BUSY',
    ],
  })
  @ApiZodResponse(200, PassengerRideSchema, 'Ride assigned')
  acceptCounteroffer(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(RideOfferParamsSchema) params: z.infer<typeof RideOfferParamsSchema>,
  ): Promise<PassengerRideView> {
    return this.rides.acceptCounteroffer(auth, params.id, params.offerId);
  }

  @Post(':id/offers/:offerId/reject-counteroffer')
  @RequirePermissions('ride:request')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'rides.rejectCounteroffer',
    summary: 'Reject a driver’s counteroffer',
    tag: 'rides',
    problems: ['RIDE_NOT_FOUND', 'OFFER_NOT_FOUND', 'OFFER_NOT_OPEN'],
  })
  @ApiZodResponse(200, PassengerRideSchema, 'Counteroffer rejected')
  rejectCounteroffer(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(RideOfferParamsSchema) params: z.infer<typeof RideOfferParamsSchema>,
  ): Promise<PassengerRideView> {
    return this.rides.rejectCounteroffer(auth, params.id, params.offerId);
  }
}

@Controller('v1/driver/offers')
export class DriverOffersController {
  constructor(private readonly offers: DriverOffersService) {}

  @Get()
  @RequirePermissions('driver:operate')
  @ApiEndpoint({
    operationId: 'driverOffers.list',
    summary: 'Open offers addressed to the caller',
    tag: 'driver-operations',
  })
  @ApiZodResponse(200, z.object({ items: z.array(DriverOfferSchema) }), 'Open offers')
  async list(@CurrentAuth() auth: AuthContext): Promise<{ items: DriverOfferView[] }> {
    return { items: await this.offers.listOpen(auth) };
  }

  @Post(':id/accept')
  @RequirePermissions('driver:operate')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'driverOffers.accept',
    summary: 'Accept the passenger’s proposed fare (first valid acceptance wins)',
    tag: 'driver-operations',
    problems: [
      'OFFER_NOT_FOUND',
      'OFFER_NOT_OPEN',
      'OFFER_EXPIRED',
      'RIDE_NO_LONGER_AVAILABLE',
      'DRIVER_NOT_APPROVED',
      'DRIVER_NOT_AVAILABLE',
      'DRIVER_BUSY',
      'VEHICLE_NOT_ELIGIBLE',
    ],
  })
  @ApiZodResponse(200, DriverRideSchema, 'Assigned ride')
  accept(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(IdParamSchema) params: IdParams,
  ): Promise<DriverRideView> {
    return this.offers.accept(auth, params.id);
  }

  @Post(':id/decline')
  @RequirePermissions('driver:operate')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'driverOffers.decline',
    summary: 'Decline an offer',
    tag: 'driver-operations',
    problems: ['OFFER_NOT_FOUND', 'OFFER_NOT_OPEN'],
  })
  @ApiZodResponse(200, DriverOfferSchema, 'Declined')
  decline(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(IdParamSchema) params: IdParams,
  ): Promise<DriverOfferView> {
    return this.offers.decline(auth, params.id);
  }

  @Post(':id/counteroffer')
  @RequirePermissions('driver:operate')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'driverOffers.counteroffer',
    summary: 'Propose a higher fare (at least the minimum fare); the passenger decides',
    tag: 'driver-operations',
    problems: [
      'OFFER_NOT_FOUND',
      'OFFER_NOT_OPEN',
      'OFFER_EXPIRED',
      'FARE_BELOW_MINIMUM',
      'COUNTEROFFER_NOT_ABOVE_PROPOSAL',
      'CURRENCY_MISMATCH',
      'DRIVER_NOT_AVAILABLE',
    ],
  })
  @ApiZodBody(CounterofferSchema)
  @ApiZodResponse(200, DriverOfferSchema, 'Counteroffer submitted')
  counteroffer(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(IdParamSchema) params: IdParams,
    @Body(validBody(CounterofferSchema)) body: z.infer<typeof CounterofferSchema>,
  ): Promise<DriverOfferView> {
    return this.offers.counteroffer(auth, params.id, body.amount);
  }
}

@Controller('v1/driver/rides')
export class DriverRidesController {
  constructor(private readonly trips: TripService) {}

  @Get()
  @RequirePermissions('driver:operate')
  @ApiEndpoint({
    operationId: 'driverRides.list',
    summary: 'Rides assigned to the caller, newest first',
    tag: 'driver-operations',
  })
  @ApiZodResponse(200, pageResponseSchema(DriverRideSchema), 'Rides')
  list(
    @CurrentAuth() auth: AuthContext,
    @ZodQuery(PageQuerySchema) query: z.infer<typeof PageQuerySchema>,
  ): Promise<Page<DriverRideView>> {
    return this.trips.listForDriver(auth, query);
  }

  @Get('current')
  @RequirePermissions('driver:operate')
  @ApiEndpoint({
    operationId: 'driverRides.current',
    summary: 'The caller’s active trip, if any',
    tag: 'driver-operations',
  })
  @ApiZodResponse(200, z.object({ ride: DriverRideSchema.nullable() }), 'Current ride')
  async current(@CurrentAuth() auth: AuthContext): Promise<{ ride: DriverRideView | null }> {
    return { ride: await this.trips.currentForDriver(auth) };
  }

  @Get(':id')
  @RequirePermissions('driver:operate')
  @ApiEndpoint({
    operationId: 'driverRides.get',
    summary: 'A ride assigned to the caller',
    tag: 'driver-operations',
    problems: ['RIDE_NOT_FOUND'],
  })
  @ApiZodResponse(200, DriverRideSchema, 'Ride')
  get(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(IdParamSchema) params: IdParams,
  ): Promise<DriverRideView> {
    return this.trips.getForDriver(auth, params.id);
  }

  @Post(':id/arrive')
  @RequirePermissions('driver:operate')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'driverRides.arrive',
    summary: 'Mark arrival at pickup',
    tag: 'driver-operations',
    problems: ['RIDE_NOT_FOUND', 'INVALID_STATE_TRANSITION'],
  })
  @ApiZodResponse(200, DriverRideSchema, 'Driver arrived')
  arrive(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(IdParamSchema) params: IdParams,
  ): Promise<DriverRideView> {
    return this.trips.driverTransition(auth, params.id, 'arrive');
  }

  @Post(':id/start')
  @RequirePermissions('driver:operate')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'driverRides.start',
    summary: 'Start the trip',
    tag: 'driver-operations',
    problems: ['RIDE_NOT_FOUND', 'INVALID_STATE_TRANSITION'],
  })
  @ApiZodResponse(200, DriverRideSchema, 'Trip in progress')
  start(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(IdParamSchema) params: IdParams,
  ): Promise<DriverRideView> {
    return this.trips.driverTransition(auth, params.id, 'start');
  }

  @Post(':id/complete')
  @RequirePermissions('driver:operate')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'driverRides.complete',
    summary: 'Complete the trip (records the cash obligation and the commission)',
    tag: 'driver-operations',
    problems: ['RIDE_NOT_FOUND', 'INVALID_STATE_TRANSITION'],
  })
  @ApiZodResponse(200, DriverRideSchema, 'Trip completed')
  complete(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(IdParamSchema) params: IdParams,
  ): Promise<DriverRideView> {
    return this.trips.driverTransition(auth, params.id, 'complete');
  }

  @Post(':id/cancel')
  @RequirePermissions('driver:operate')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'driverRides.cancel',
    summary: 'Cancel an assigned ride before the trip starts (reason required)',
    tag: 'driver-operations',
    problems: ['RIDE_NOT_FOUND', 'INVALID_STATE_TRANSITION'],
  })
  @ApiZodBody(RequiredReasonSchema)
  @ApiZodResponse(200, DriverRideSchema, 'Cancelled')
  cancel(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(IdParamSchema) params: IdParams,
    @Body(validBody(RequiredReasonSchema)) body: z.infer<typeof RequiredReasonSchema>,
  ): Promise<DriverRideView> {
    return this.trips.cancelByDriver(auth, params.id, body.reason);
  }
}

@Controller('v1/admin/rides')
export class AdminRidesController {
  constructor(private readonly trips: TripService) {}

  @Get(':id')
  @RequirePermissions('ride:admin')
  @ApiEndpoint({
    operationId: 'adminRides.get',
    summary: 'A ride with offers, fare agreement, assignment terms and payment',
    tag: 'admin',
    problems: ['RIDE_NOT_FOUND'],
  })
  @ApiZodResponse(200, AdminRideSchema, 'Ride')
  get(@ZodParams(IdParamSchema) params: IdParams): Promise<AdminRideView> {
    return this.trips.getForAdmin(params.id);
  }

  @Post(':id/cancel')
  @RequirePermissions('ride:admin')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'adminRides.cancel',
    summary: 'Force-cancel any open ride (reason required; audited)',
    tag: 'admin',
    problems: ['RIDE_NOT_FOUND', 'INVALID_STATE_TRANSITION'],
  })
  @ApiZodBody(RequiredReasonSchema)
  @ApiZodResponse(200, AdminRideSchema, 'Cancelled')
  cancel(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(IdParamSchema) params: IdParams,
    @Body(validBody(RequiredReasonSchema)) body: z.infer<typeof RequiredReasonSchema>,
  ): Promise<AdminRideView> {
    return this.trips.cancelByAdmin(auth, params.id, body.reason);
  }
}
