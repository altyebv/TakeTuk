import { Controller, Get } from '@nestjs/common';
import { z } from 'zod';
import { Database } from '../../../infrastructure/database/database';
import { RequirePermissions } from '../../../shared/auth/access.decorators';
import { ApiEndpoint, ApiZodResponse } from '../../../shared/http/openapi';
import { FleetService } from '../application/fleet.service';

const VehicleTypesSchema = z.object({
  items: z.array(
    z.object({
      code: z.string(),
      displayName: z.string(),
      passengerCapable: z.boolean(),
      compatibleServiceTypes: z.array(z.string()),
    }),
  ),
});

@Controller('v1/fleet')
export class FleetController {
  constructor(
    private readonly db: Database,
    private readonly fleet: FleetService,
  ) {}

  @Get('vehicle-types')
  @RequirePermissions()
  @ApiEndpoint({
    operationId: 'fleet.listVehicleTypes',
    summary: 'Vehicle types and the services each is compatible with',
    tag: 'fleet',
  })
  @ApiZodResponse(200, VehicleTypesSchema, 'Vehicle types')
  async vehicleTypes(): Promise<z.infer<typeof VehicleTypesSchema>> {
    const items = await this.fleet.listVehicleTypes(this.db);
    return {
      items: items.map((t) => ({ ...t, compatibleServiceTypes: [...t.compatibleServiceTypes] })),
    };
  }
}
