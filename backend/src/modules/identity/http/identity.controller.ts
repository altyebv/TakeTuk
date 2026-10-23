import { Body, Controller, Get, HttpCode, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  Authenticated,
  CurrentAuth,
  RequirePermissions,
} from '../../../shared/auth/access.decorators';
import type { AuthContext, RegisteredUser } from '../../../shared/auth/auth-context';
import { ROLES, type Role } from '../../../shared/auth/roles-and-permissions';
import { ApiEndpoint, ApiZodBody, ApiZodResponse } from '../../../shared/http/openapi';
import { validBody } from '../../../shared/http/zod-validation.pipe';
import { IdentityService } from '../application/identity.service';

export const DisplayNameSchema = z.string().trim().min(1).max(100);

const RegisterPassengerSchema = z.strictObject({ displayName: DisplayNameSchema });
const UpdateProfileSchema = z.strictObject({ displayName: DisplayNameSchema });

const MeSchema = z
  .object({
    userId: z.uuid(),
    registered: z.boolean(),
    displayName: z.string().nullable(),
    phoneE164: z.string().nullable(),
    status: z.enum(['active', 'disabled']).nullable(),
    roles: z.array(z.enum(ROLES)),
  })
  .meta({ id: 'Me' });
type MeResponse = z.infer<typeof MeSchema>;

const toMe = (userId: string, user: RegisteredUser | null, roles: readonly Role[]): MeResponse => ({
  userId,
  registered: user !== null,
  displayName: user?.displayName ?? null,
  phoneE164: user?.phoneE164 ?? null,
  status: user?.status ?? null,
  roles: [...roles],
});

@Controller('v1')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Get('me')
  @Authenticated()
  @ApiEndpoint({
    operationId: 'identity.getMe',
    summary: 'The authenticated caller, registration state and roles',
    tag: 'identity',
  })
  @ApiZodResponse(200, MeSchema, 'Current user')
  me(@CurrentAuth() auth: AuthContext): MeResponse {
    return toMe(auth.identity.userId, auth.user, auth.roles);
  }

  @Post('passenger/registration')
  @Authenticated()
  @ApiEndpoint({
    operationId: 'identity.registerPassenger',
    summary: 'Register as a passenger (idempotent)',
    tag: 'identity',
    description:
      'Creates the TAKE-TUK user record if needed and grants the passenger role. 201 when something was created, 200 when already registered.',
    problems: ['ACCOUNT_DISABLED'],
  })
  @ApiZodBody(RegisterPassengerSchema)
  @ApiZodResponse(201, MeSchema, 'Registered')
  @ApiZodResponse(200, MeSchema, 'Already registered')
  async registerPassenger(
    @CurrentAuth() auth: AuthContext,
    @Body(validBody(RegisterPassengerSchema)) body: z.infer<typeof RegisterPassengerSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const result = await this.identity.registerPassenger(auth.identity, body.displayName);
    res.status(result.changed ? 201 : 200);
    return toMe(auth.identity.userId, result.user, result.roles);
  }

  @Patch('me/profile')
  @RequirePermissions()
  @HttpCode(200)
  @ApiEndpoint({
    operationId: 'identity.updateProfile',
    summary: 'Update the display name',
    tag: 'identity',
  })
  @ApiZodBody(UpdateProfileSchema)
  @ApiZodResponse(200, MeSchema, 'Updated profile')
  async updateProfile(
    @CurrentAuth() auth: AuthContext,
    @Body(validBody(UpdateProfileSchema)) body: z.infer<typeof UpdateProfileSchema>,
  ): Promise<MeResponse> {
    const user = await this.identity.updateDisplayName(auth, body.displayName);
    return toMe(auth.identity.userId, user, auth.roles);
  }
}
