import { Body, Controller, Delete, HttpCode, Param, Put } from '@nestjs/common';
import { z } from 'zod';
import { Database } from '../../../infrastructure/database/database';
import { CurrentAuth, RequirePermissions } from '../../../shared/auth/access.decorators';
import type { AuthContext } from '../../../shared/auth/auth-context';
import { AppError } from '../../../shared/errors/app-error';
import { ApiEndpoint, ApiZodBody, ApiZodResponse } from '../../../shared/http/openapi';
import { validBody, validParam } from '../../../shared/http/zod-validation.pipe';
import { requireRegistered } from '../../identity';
import { DeviceRegistrationsRepository } from '../infrastructure/device-registrations.repository';

const InstallationParamsSchema = z.strictObject({ installationId: z.uuid() });
const RegisterDeviceSchema = z.strictObject({
  app: z.enum(['passenger', 'driver']),
  platform: z.enum(['android', 'ios']),
  pushToken: z.string().min(10).max(4096),
});
const DeviceSchema = z.object({
  installationId: z.uuid(),
  app: z.enum(['passenger', 'driver']),
  platform: z.enum(['android', 'ios']),
});

@Controller('v1/me/devices')
export class DevicesController {
  constructor(
    private readonly db: Database,
    private readonly devices: DeviceRegistrationsRepository,
  ) {}

  @Put(':installationId')
  @RequirePermissions()
  @ApiEndpoint({
    operationId: 'notifications.registerDevice',
    summary: 'Register or refresh this installation’s push token (idempotent)',
    tag: 'identity',
    problems: ['PERMISSION_DENIED'],
  })
  @ApiZodBody(RegisterDeviceSchema)
  @ApiZodResponse(200, DeviceSchema, 'Registered')
  async register(
    @CurrentAuth() auth: AuthContext,
    @Param(validParam(InstallationParamsSchema)) params: z.infer<typeof InstallationParamsSchema>,
    @Body(validBody(RegisterDeviceSchema)) body: z.infer<typeof RegisterDeviceSchema>,
  ): Promise<z.infer<typeof DeviceSchema>> {
    const user = requireRegistered(auth);
    // Only the app matching a held role may register: a passenger cannot receive driver offers.
    if (!auth.roles.includes(body.app)) {
      throw new AppError(
        'PERMISSION_DENIED',
        `Registering the ${body.app} app requires the ${body.app} role.`,
      );
    }
    await this.db.transaction((tx) =>
      this.devices.upsert(tx, { installationId: params.installationId, userId: user.id, ...body }),
    );
    return { installationId: params.installationId, app: body.app, platform: body.platform };
  }

  @Delete(':installationId')
  @RequirePermissions()
  @HttpCode(204)
  @ApiEndpoint({
    operationId: 'notifications.removeDevice',
    summary: 'Remove this installation (e.g. on sign-out)',
    tag: 'identity',
  })
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param(validParam(InstallationParamsSchema)) params: z.infer<typeof InstallationParamsSchema>,
  ): Promise<void> {
    await this.devices.remove(this.db, params.installationId, requireRegistered(auth).id);
  }
}
