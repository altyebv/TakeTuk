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

  it('documents a success response for every operation', () => {
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(
        item as Record<string, { responses: Record<string, unknown> }>,
      )) {
        const success = Object.keys(op.responses).filter((code) => code.startsWith('2'));
        expect({ op: `${method} ${path}`, documented: success.length > 0 }).toEqual({
          op: `${method} ${path}`,
          documented: true,
        });
      }
    }
  });

  it('declares every path template variable as a required path parameter', () => {
    for (const [path, item] of Object.entries(doc.paths)) {
      const variables = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      for (const [method, op] of Object.entries(
        item as Record<
          string,
          { parameters?: Array<{ in: string; name: string; required?: boolean }> }
        >,
      )) {
        const declared = (op.parameters ?? [])
          .filter((p) => p.in === 'path' && p.required === true)
          .map((p) => p.name)
          .sort();
        expect({ op: `${method} ${path}`, declared }).toEqual({
          op: `${method} ${path}`,
          declared: variables,
        });
      }
    }
  });

  it('documents query parameters of paginated lists', () => {
    const rides = doc.paths['/v1/rides'] as {
      get: { parameters: Array<{ name: string; in: string }> };
    };
    expect(
      rides.get.parameters
        .filter((p) => p.in === 'query')
        .map((p) => p.name)
        .sort(),
    ).toEqual(['cursor', 'limit']);
  });

  it('lists every problem code an operation documents in the root problem-code registry', () => {
    const registry = new Set(
      (doc as unknown as { 'x-taketuk-problem-codes': Array<{ code: string }> })[
        'x-taketuk-problem-codes'
      ].map((entry) => entry.code),
    );
    expect(registry.has('AUTHENTICATION_REQUIRED')).toBe(true);
    for (const item of Object.values(doc.paths)) {
      for (const op of Object.values(
        item as Record<string, { 'x-taketuk-problem-codes'?: string[] }>,
      )) {
        for (const code of op['x-taketuk-problem-codes'] ?? []) expect(registry).toContain(code);
      }
    }
  });

  it('matches the committed docs/api/openapi.json', () => {
    if (process.env.UPDATE_OPENAPI === '1') {
      writeFileSync(TARGET, json);
    }
    expect(readFileSync(TARGET, 'utf8')).toBe(json);
  });
});
