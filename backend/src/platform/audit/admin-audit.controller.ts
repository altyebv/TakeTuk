import { Controller, Get } from '@nestjs/common';
import { z } from 'zod';
import { Database } from '../../infrastructure/database/database';
import { RequirePermissions } from '../../shared/auth/access.decorators';
import { ApiEndpoint, ApiZodResponse, ZodQuery } from '../../shared/http/openapi';
import { PageQuerySchema, pageResponseSchema } from '../../shared/pagination';
import { AuditService } from './audit.service';

const AuditQuerySchema = PageQuerySchema.extend({
  entityType: z.string().min(1).max(64).optional(),
  entityId: z.string().min(1).max(100).optional(),
});

const AuditEventSchema = z
  .object({
    id: z.number().int(),
    occurredAt: z.string(),
    actorType: z.enum(['user', 'system']),
    actorUserId: z.string().nullable(),
    actorRole: z.string().nullable(),
    action: z.string(),
    entityType: z.string(),
    entityId: z.string(),
    requestId: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
  })
  .meta({ id: 'AuditEvent' });

@Controller('v1/admin/audit-events')
export class AdminAuditController {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('audit:read')
  @ApiEndpoint({
    operationId: 'audit.listEvents',
    summary: 'List audit events (newest first)',
    tag: 'admin',
  })
  @ApiZodResponse(200, pageResponseSchema(AuditEventSchema), 'Audit events')
  list(@ZodQuery(AuditQuerySchema) query: z.infer<typeof AuditQuerySchema>) {
    return this.audit.list(this.db, query);
  }
}
