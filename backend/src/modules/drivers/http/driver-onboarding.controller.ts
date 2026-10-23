import { Body, Controller, Get, HttpCode, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  Authenticated,
  CurrentAuth,
  RequirePermissions,
} from '../../../shared/auth/access.decorators';
import type { AuthContext } from '../../../shared/auth/auth-context';
import { ApiEndpoint, ApiZodBody, ApiZodResponse } from '../../../shared/http/openapi';
import { validBody, validParam } from '../../../shared/http/zod-validation.pipe';
import { IdParamSchema } from '../../../shared/schemas';
import { DisplayNameSchema } from '../../identity';
import { DriverOnboardingService } from '../application/driver-onboarding.service';
import { DOCUMENT_CONTENT_TYPES, DOCUMENT_TYPES } from '../domain/driver';
import {
  DriverDocumentSchema,
  DriverProfileSchema,
  presentDocument,
  presentDriver,
  presentVehicle,
  VehicleSchema,
  type DriverDocumentResponse,
  type DriverProfileResponse,
  type VehicleResponse,
} from './driver.presenters';

const LegalNameSchema = z.string().trim().min(2).max(200);
const LicenseNumberSchema = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .refine((v) => !/\p{Cc}/u.test(v), 'must not contain control characters');

const RegisterDriverSchema = z.strictObject({
  displayName: DisplayNameSchema,
  fullLegalName: LegalNameSchema,
  drivingLicenseNumber: LicenseNumberSchema,
  serviceAreaCode: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
});

const UpdateDriverProfileSchema = z
  .strictObject({
    fullLegalName: LegalNameSchema.optional(),
    drivingLicenseNumber: LicenseNumberSchema.optional(),
  })
  .refine(
    (v) => v.fullLegalName !== undefined || v.drivingLicenseNumber !== undefined,
    'nothing to update',
  );

const RegisterVehicleSchema = z.strictObject({
  vehicleTypeCode: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  plateNumber: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .refine((v) => !/\p{Cc}/u.test(v), 'must not contain control characters'),
  description: z.string().trim().min(1).max(200).optional(),
});

const UploadRequestSchema = z.strictObject({
  documentType: z.enum(DOCUMENT_TYPES),
  contentType: z.enum(DOCUMENT_CONTENT_TYPES),
  vehicleId: z.uuid().optional(),
});

const UploadResponseSchema = z.object({
  document: DriverDocumentSchema,
  upload: z.object({
    url: z.string(),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string()),
    expiresInSeconds: z.number().int(),
  }),
});

const ListOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

@Controller('v1/driver')
export class DriverOnboardingController {
  constructor(private readonly onboarding: DriverOnboardingService) {}

  @Post('registration')
  @Authenticated()
  @ApiEndpoint({
    operationId: 'drivers.register',
    summary: 'Register as a driver applicant (idempotent for identical details)',
    tag: 'driver-onboarding',
    problems: ['SERVICE_AREA_NOT_FOUND', 'ALREADY_REGISTERED', 'ACCOUNT_DISABLED'],
  })
  @ApiZodBody(RegisterDriverSchema)
  @ApiZodResponse(201, DriverProfileSchema, 'Driver profile created')
  @ApiZodResponse(200, DriverProfileSchema, 'Already registered with identical details')
  async register(
    @CurrentAuth() auth: AuthContext,
    @Body(validBody(RegisterDriverSchema)) body: z.infer<typeof RegisterDriverSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DriverProfileResponse> {
    const { driver, created } = await this.onboarding.register(auth, body);
    res.status(created ? 201 : 200);
    return presentDriver(driver);
  }

  @Get('profile')
  @RequirePermissions('driver:self')
  @ApiEndpoint({
    operationId: 'drivers.getProfile',
    summary: 'The caller’s driver profile',
    tag: 'driver-onboarding',
  })
  @ApiZodResponse(200, DriverProfileSchema, 'Driver profile')
  async profile(@CurrentAuth() auth: AuthContext): Promise<DriverProfileResponse> {
    return presentDriver(await this.onboarding.getProfile(auth));
  }

  @Patch('profile')
  @RequirePermissions('driver:self')
  @ApiEndpoint({
    operationId: 'drivers.updateProfile',
    summary: 'Edit profile details (only as applicant or after rejection)',
    tag: 'driver-onboarding',
    problems: ['PROFILE_NOT_EDITABLE'],
  })
  @ApiZodBody(UpdateDriverProfileSchema)
  @ApiZodResponse(200, DriverProfileSchema, 'Updated profile')
  async updateProfile(
    @CurrentAuth() auth: AuthContext,
    @Body(validBody(UpdateDriverProfileSchema)) body: z.infer<typeof UpdateDriverProfileSchema>,
  ): Promise<DriverProfileResponse> {
    return presentDriver(await this.onboarding.updateProfile(auth, body));
  }

  @Post('vehicles')
  @RequirePermissions('driver:self')
  @ApiEndpoint({
    operationId: 'drivers.registerVehicle',
    summary: 'Register a vehicle for review',
    tag: 'driver-onboarding',
    problems: ['VEHICLE_NOT_ELIGIBLE', 'VEHICLE_ALREADY_REGISTERED', 'PROFILE_NOT_EDITABLE'],
  })
  @ApiZodBody(RegisterVehicleSchema)
  @ApiZodResponse(201, VehicleSchema, 'Vehicle registered (pending review)')
  async registerVehicle(
    @CurrentAuth() auth: AuthContext,
    @Body(validBody(RegisterVehicleSchema)) body: z.infer<typeof RegisterVehicleSchema>,
  ): Promise<VehicleResponse> {
    const vehicle = await this.onboarding.registerVehicle(auth, {
      vehicleTypeCode: body.vehicleTypeCode,
      plateNumber: body.plateNumber,
      description: body.description ?? null,
    });
    return presentVehicle(vehicle);
  }

  @Get('vehicles')
  @RequirePermissions('driver:self')
  @ApiEndpoint({
    operationId: 'drivers.listVehicles',
    summary: 'The caller’s vehicles',
    tag: 'driver-onboarding',
  })
  @ApiZodResponse(200, ListOf(VehicleSchema), 'Vehicles')
  async vehicles(@CurrentAuth() auth: AuthContext): Promise<{ items: VehicleResponse[] }> {
    return { items: (await this.onboarding.listVehicles(auth)).map(presentVehicle) };
  }

  @Post('documents/upload-requests')
  @RequirePermissions('driver:self')
  @ApiEndpoint({
    operationId: 'drivers.requestDocumentUpload',
    summary: 'Get a short-lived signed URL to upload a verification document',
    tag: 'driver-onboarding',
    description:
      'Upload the file with an HTTP PUT to `upload.url`, then call the confirm endpoint.',
    problems: ['VEHICLE_NOT_FOUND', 'STORAGE_UNAVAILABLE'],
  })
  @ApiZodBody(UploadRequestSchema)
  @ApiZodResponse(201, UploadResponseSchema, 'Upload slot issued')
  async requestUpload(
    @CurrentAuth() auth: AuthContext,
    @Body(validBody(UploadRequestSchema)) body: z.infer<typeof UploadRequestSchema>,
  ): Promise<z.infer<typeof UploadResponseSchema>> {
    const { document, upload } = await this.onboarding.requestDocumentUpload(auth, body);
    return {
      document: presentDocument(document),
      upload: {
        url: upload.url,
        method: upload.method,
        headers: { 'Content-Type': document.contentType },
        expiresInSeconds: upload.expiresInSeconds,
      },
    };
  }

  @Post('documents/:id/confirm')
  @RequirePermissions('driver:self')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'drivers.confirmDocumentUpload',
    summary: 'Confirm an uploaded document (idempotent)',
    tag: 'driver-onboarding',
    problems: ['DOCUMENT_NOT_FOUND', 'DOCUMENT_NOT_UPLOADED', 'STORAGE_UNAVAILABLE'],
  })
  @ApiZodResponse(200, DriverDocumentSchema, 'Document confirmed')
  async confirmUpload(
    @CurrentAuth() auth: AuthContext,
    @Param(validParam(IdParamSchema)) params: z.infer<typeof IdParamSchema>,
  ): Promise<DriverDocumentResponse> {
    return presentDocument(await this.onboarding.confirmDocumentUpload(auth, params.id));
  }

  @Get('documents')
  @RequirePermissions('driver:self')
  @ApiEndpoint({
    operationId: 'drivers.listDocuments',
    summary: 'The caller’s documents (metadata only)',
    tag: 'driver-onboarding',
  })
  @ApiZodResponse(200, ListOf(DriverDocumentSchema), 'Documents')
  async documents(@CurrentAuth() auth: AuthContext): Promise<{ items: DriverDocumentResponse[] }> {
    return { items: (await this.onboarding.listDocuments(auth)).map(presentDocument) };
  }

  @Post('verification/submit')
  @RequirePermissions('driver:self')
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'drivers.submitForReview',
    summary: 'Submit the profile, vehicle and documents for review',
    tag: 'driver-onboarding',
    problems: ['VERIFICATION_REQUIREMENTS_NOT_MET', 'INVALID_STATE_TRANSITION'],
  })
  @ApiZodResponse(200, DriverProfileSchema, 'Submitted (pending review)')
  async submit(@CurrentAuth() auth: AuthContext): Promise<DriverProfileResponse> {
    return presentDriver(await this.onboarding.submitForReview(auth));
  }
}
