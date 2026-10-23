import { Body, Controller, Put } from '@nestjs/common';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../../../shared/auth/access.decorators';
import type { AuthContext } from '../../../shared/auth/auth-context';
import { ApiEndpoint, ApiZodBody, ApiZodResponse } from '../../../shared/http/openapi';
import { validBody } from '../../../shared/http/zod-validation.pipe';
import { DriverOperationsService } from '../application/driver-operations.service';
import {
  DriverProfileSchema,
  presentDriver,
  type DriverProfileResponse,
} from './driver.presenters';

const AvailabilitySchema = z.strictObject({
  availability: z.enum(['online', 'offline']),
  vehicleId: z.uuid().optional(),
});

const LocationSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(10_000).optional(),
  recordedAt: z.iso.datetime({ offset: true }),
});

const LocationAckSchema = z.object({ receivedAt: z.string() });

@Controller('v1/driver')
export class DriverOperationsController {
  constructor(private readonly operations: DriverOperationsService) {}

  @Put('availability')
  @RequirePermissions('driver:operate')
  @ApiEndpoint({
    operationId: 'drivers.setAvailability',
    summary: 'Go online with an approved vehicle, or go offline',
    tag: 'driver-operations',
    problems: ['DRIVER_NOT_APPROVED', 'VEHICLE_NOT_FOUND', 'VEHICLE_NOT_ELIGIBLE'],
  })
  @ApiZodBody(AvailabilitySchema)
  @ApiZodResponse(200, DriverProfileSchema, 'Updated availability')
  async setAvailability(
    @CurrentAuth() auth: AuthContext,
    @Body(validBody(AvailabilitySchema)) body: z.infer<typeof AvailabilitySchema>,
  ): Promise<DriverProfileResponse> {
    return presentDriver(await this.operations.setAvailability(auth, body));
  }

  @Put('location')
  @RequirePermissions('driver:operate')
  @ApiEndpoint({
    operationId: 'drivers.updateLocation',
    summary: 'Report the current position (only the latest position is kept)',
    tag: 'driver-operations',
    problems: ['DRIVER_NOT_APPROVED'],
  })
  @ApiZodBody(LocationSchema)
  @ApiZodResponse(200, LocationAckSchema, 'Position stored')
  async updateLocation(
    @CurrentAuth() auth: AuthContext,
    @Body(validBody(LocationSchema)) body: z.infer<typeof LocationSchema>,
  ): Promise<z.infer<typeof LocationAckSchema>> {
    const { receivedAt } = await this.operations.updateLocation(auth, body);
    return { receivedAt: receivedAt.toISOString() };
  }
}
