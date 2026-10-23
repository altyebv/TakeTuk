import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
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
import { IdParamSchema } from '../../../shared/schemas';
import { DriverReviewService, type DriverDecision } from '../application/driver-review.service';
import { DRIVER_STATUSES } from '../domain/driver';
import {
  DriverDocumentSchema,
  DriverProfileSchema,
  presentDocument,
  presentDriver,
  presentVehicle,
  VehicleSchema,
  type DriverProfileResponse,
  type VehicleResponse,
} from './driver.presenters';

const ListDriversQuerySchema = PageQuerySchema.extend({
  status: z.enum(DRIVER_STATUSES).optional(),
});
const DecisionBodySchema = z.strictObject({ note: z.string().trim().min(3).max(1000).optional() });
const DocumentParamsSchema = z.strictObject({ id: z.uuid(), documentId: z.uuid() });

const DriverReviewSchema = z.object({
  driver: DriverProfileSchema,
  vehicles: z.array(VehicleSchema),
  documents: z.array(DriverDocumentSchema),
});
const ViewUrlSchema = z.object({ url: z.string(), expiresAt: z.string() });

type DecisionBody = z.infer<typeof DecisionBodySchema>;
type IdParams = z.infer<typeof IdParamSchema>;

@Controller('v1/admin')
export class AdminDriversController {
  constructor(private readonly review: DriverReviewService) {}

  @Get('drivers')
  @RequirePermissions('driver:review')
  @ApiEndpoint({
    operationId: 'adminDrivers.list',
    summary: 'List drivers, optionally by status',
    tag: 'admin',
  })
  @ApiZodResponse(200, pageResponseSchema(DriverProfileSchema), 'Drivers')
  async list(
    @ZodQuery(ListDriversQuerySchema) query: z.infer<typeof ListDriversQuerySchema>,
  ): Promise<Page<DriverProfileResponse>> {
    const page = await this.review.list(query);
    return { items: page.items.map(presentDriver), nextCursor: page.nextCursor };
  }

  @Get('drivers/:id')
  @RequirePermissions('driver:review')
  @ApiEndpoint({
    operationId: 'adminDrivers.get',
    summary: 'A driver with vehicles and document metadata',
    tag: 'admin',
    problems: ['DRIVER_NOT_FOUND'],
  })
  @ApiZodResponse(200, DriverReviewSchema, 'Driver for review')
  async get(
    @ZodParams(IdParamSchema) params: IdParams,
  ): Promise<z.infer<typeof DriverReviewSchema>> {
    const view = await this.review.getForReview(params.id);
    return {
      driver: presentDriver(view.driver),
      vehicles: view.vehicles.map(presentVehicle),
      documents: view.documents.map(presentDocument),
    };
  }

  @Post('drivers/:id/approve')
  @RequirePermissions('driver:review')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'adminDrivers.approve',
    summary: 'Approve a driver pending review',
    tag: 'admin',
    problems: ['DRIVER_NOT_FOUND', 'INVALID_STATE_TRANSITION', 'SELF_REVIEW_FORBIDDEN'],
  })
  @ApiZodBody(DecisionBodySchema)
  @ApiZodResponse(200, DriverProfileSchema, 'Approved')
  approve(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(IdParamSchema) p: IdParams,
    @Body(validBody(DecisionBodySchema)) b: DecisionBody,
  ) {
    return this.decideDriver(auth, p.id, 'approve', b);
  }

  @Post('drivers/:id/reject')
  @RequirePermissions('driver:review')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'adminDrivers.reject',
    summary: 'Reject a driver pending review (note required)',
    tag: 'admin',
    problems: ['DRIVER_NOT_FOUND', 'INVALID_STATE_TRANSITION', 'SELF_REVIEW_FORBIDDEN'],
  })
  @ApiZodBody(DecisionBodySchema)
  @ApiZodResponse(200, DriverProfileSchema, 'Rejected')
  reject(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(IdParamSchema) p: IdParams,
    @Body(validBody(DecisionBodySchema)) b: DecisionBody,
  ) {
    return this.decideDriver(auth, p.id, 'reject', b);
  }

  @Post('drivers/:id/suspend')
  @RequirePermissions('driver:suspend')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'adminDrivers.suspend',
    summary: 'Suspend an approved driver (reason required; forces offline)',
    tag: 'admin',
    problems: ['DRIVER_NOT_FOUND', 'INVALID_STATE_TRANSITION', 'SELF_REVIEW_FORBIDDEN'],
  })
  @ApiZodBody(DecisionBodySchema)
  @ApiZodResponse(200, DriverProfileSchema, 'Suspended')
  suspend(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(IdParamSchema) p: IdParams,
    @Body(validBody(DecisionBodySchema)) b: DecisionBody,
  ) {
    return this.decideDriver(auth, p.id, 'suspend', b);
  }

  @Post('drivers/:id/reinstate')
  @RequirePermissions('driver:suspend')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'adminDrivers.reinstate',
    summary: 'Reinstate a suspended driver',
    tag: 'admin',
    problems: ['DRIVER_NOT_FOUND', 'INVALID_STATE_TRANSITION', 'SELF_REVIEW_FORBIDDEN'],
  })
  @ApiZodBody(DecisionBodySchema)
  @ApiZodResponse(200, DriverProfileSchema, 'Reinstated')
  reinstate(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(IdParamSchema) p: IdParams,
    @Body(validBody(DecisionBodySchema)) b: DecisionBody,
  ) {
    return this.decideDriver(auth, p.id, 'reinstate', b);
  }

  @Get('drivers/:id/documents/:documentId/view-url')
  @RequirePermissions('driver_document:view')
  @ApiEndpoint({
    operationId: 'adminDrivers.documentViewUrl',
    summary: 'Short-lived signed URL to view a driver document (audited)',
    tag: 'admin',
    problems: ['DOCUMENT_NOT_FOUND', 'STORAGE_UNAVAILABLE'],
  })
  @ApiZodResponse(200, ViewUrlSchema, 'Signed view URL')
  async documentViewUrl(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(DocumentParamsSchema) params: z.infer<typeof DocumentParamsSchema>,
  ): Promise<z.infer<typeof ViewUrlSchema>> {
    const signed = await this.review.documentViewUrl(auth, params.id, params.documentId);
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  @Post('vehicles/:id/approve')
  @RequirePermissions('vehicle:review')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'adminVehicles.approve',
    summary: 'Approve a vehicle',
    tag: 'admin',
    problems: ['VEHICLE_NOT_FOUND', 'INVALID_STATE_TRANSITION', 'SELF_REVIEW_FORBIDDEN'],
  })
  @ApiZodBody(DecisionBodySchema)
  @ApiZodResponse(200, VehicleSchema, 'Approved')
  approveVehicle(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(IdParamSchema) p: IdParams,
    @Body(validBody(DecisionBodySchema)) b: DecisionBody,
  ) {
    return this.decideVehicle(auth, p.id, 'approve', b);
  }

  @Post('vehicles/:id/reject')
  @RequirePermissions('vehicle:review')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'adminVehicles.reject',
    summary: 'Reject a vehicle (note required)',
    tag: 'admin',
    problems: ['VEHICLE_NOT_FOUND', 'INVALID_STATE_TRANSITION', 'SELF_REVIEW_FORBIDDEN'],
  })
  @ApiZodBody(DecisionBodySchema)
  @ApiZodResponse(200, VehicleSchema, 'Rejected')
  rejectVehicle(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(IdParamSchema) p: IdParams,
    @Body(validBody(DecisionBodySchema)) b: DecisionBody,
  ) {
    return this.decideVehicle(auth, p.id, 'reject', b);
  }

  @Post('vehicles/:id/suspend')
  @RequirePermissions('vehicle:review')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'adminVehicles.suspend',
    summary: 'Suspend a vehicle (reason required)',
    tag: 'admin',
    problems: ['VEHICLE_NOT_FOUND', 'INVALID_STATE_TRANSITION', 'SELF_REVIEW_FORBIDDEN'],
  })
  @ApiZodBody(DecisionBodySchema)
  @ApiZodResponse(200, VehicleSchema, 'Suspended')
  suspendVehicle(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(IdParamSchema) p: IdParams,
    @Body(validBody(DecisionBodySchema)) b: DecisionBody,
  ) {
    return this.decideVehicle(auth, p.id, 'suspend', b);
  }

  @Post('vehicles/:id/reinstate')
  @RequirePermissions('vehicle:review')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'adminVehicles.reinstate',
    summary: 'Reinstate a suspended vehicle',
    tag: 'admin',
    problems: ['VEHICLE_NOT_FOUND', 'INVALID_STATE_TRANSITION', 'SELF_REVIEW_FORBIDDEN'],
  })
  @ApiZodBody(DecisionBodySchema)
  @ApiZodResponse(200, VehicleSchema, 'Reinstated')
  reinstateVehicle(
    @CurrentAuth() auth: AuthContext,
    @ZodParams(IdParamSchema) p: IdParams,
    @Body(validBody(DecisionBodySchema)) b: DecisionBody,
  ) {
    return this.decideVehicle(auth, p.id, 'reinstate', b);
  }

  private async decideDriver(
    auth: AuthContext,
    id: string,
    decision: DriverDecision,
    body: DecisionBody,
  ): Promise<DriverProfileResponse> {
    return presentDriver(await this.review.decideDriver(auth, id, decision, body.note ?? null));
  }

  private async decideVehicle(
    auth: AuthContext,
    id: string,
    decision: DriverDecision,
    body: DecisionBody,
  ): Promise<VehicleResponse> {
    return presentVehicle(await this.review.decideVehicle(auth, id, decision, body.note ?? null));
  }
}
