import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { buildOpenApiDocument } from '../../src/bootstrap';
import { loadConfig } from '../../src/config/app-config';

/**
 * docs/api/openapi.json is generated from the code (ADR-0014). `npm run openapi` regenerates it;
 * this test fails when the committed file is stale. No database connection is opened.
 */
const TARGET = resolve(__dirname, '../../../docs/api/openapi.json');

describe('openapi document', () => {
  let json: string;
  let doc: ReturnType<typeof buildOpenApiDocument>;

  beforeAll(async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
      SUPABASE_URL: 'http://supabase.example',
      WORKERS_ENABLED: 'false',
      LOG_LEVEL: 'error',
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register(config)],
    }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    doc = buildOpenApiDocument(app);
    json = `${JSON.stringify(doc, null, 2)}\n`;
    await app.close();
  });

  it('declares an access rule on every operation (deny by default)', () => {
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(item as Record<string, { security?: unknown[] }>)) {
        const secured = Array.isArray(op.security) && op.security.length > 0;
        expect({ op: `${method} ${path}`, secured }).toEqual({
          op: `${method} ${path}`,
          secured: !path.startsWith('/health'),
        });
      }
    }
  });

  it('gives every operation a unique operationId', () => {
    const ids = Object.values(doc.paths).flatMap((item) =>
      Object.values(item as Record<string, { operationId?: string }>).map((op) => op.operationId),
    );
    expect(ids.every((id) => typeof id === 'string' && id.includes('.'))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('matches the committed docs/api/openapi.json', () => {
    if (process.env.UPDATE_OPENAPI === '1') {
      writeFileSync(TARGET, json);
    }
    expect(readFileSync(TARGET, 'utf8')).toBe(json);
  });
});
