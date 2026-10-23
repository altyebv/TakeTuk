import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Database } from '../../infrastructure/database/database';
import { Public } from '../../shared/auth/access.decorators';
import { ApiEndpoint, ApiZodResponse } from '../../shared/http/openapi';

const LiveSchema = z.object({ status: z.literal('ok') });
const ReadySchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  checks: z.object({ database: z.enum(['ok', 'unavailable']) }),
});

@Controller('health')
export class HealthController {
  constructor(private readonly db: Database) {}

  @Get('live')
  @Public()
  @ApiEndpoint({
    operationId: 'health.live',
    summary: 'Liveness: the process is running',
    tag: 'operations',
  })
  @ApiZodResponse(200, LiveSchema, 'Alive')
  live(): z.infer<typeof LiveSchema> {
    return { status: 'ok' };
  }

  @Get('ready')
  @Public()
  @ApiEndpoint({
    operationId: 'health.ready',
    summary: 'Readiness: dependencies required to serve traffic are reachable',
    tag: 'operations',
  })
  @ApiZodResponse(200, ReadySchema, 'Ready')
  @ApiZodResponse(503, ReadySchema, 'Not ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<z.infer<typeof ReadySchema>> {
    const database = (await this.db.ping()) ? 'ok' : 'unavailable';
    if (database !== 'ok') res.status(503);
    return { status: database, checks: { database } };
  }
}
