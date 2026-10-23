import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp, createLogger } from '../../src/bootstrap';
import { loadConfig, type AppConfig } from '../../src/config/app-config';
import { SupabaseTokenVerifier, TOKEN_VERIFIER } from '../../src/modules/identity';
import type { TestDatabase } from './test-database';
import { TEST_AUDIENCE, TEST_ISSUER, TEST_SUPABASE_URL, type TestTokens } from './test-tokens';

export interface ProviderOverride {
  readonly token: unknown;
  readonly value: unknown;
}

export interface TestApp {
  readonly app: INestApplication;
  readonly config: AppConfig;
  http(): ReturnType<typeof request>;
  /** Resolves a provider by class. */
  get<T>(type: abstract new (...args: never[]) => T): T;
  /** Resolves a provider registered under a symbol token. */
  getToken(token: symbol): unknown;
  close(): Promise<void>;
}

export async function createTestApp(
  db: TestDatabase,
  tokens: TestTokens,
  options: { env?: Record<string, string>; overrides?: readonly ProviderOverride[] } = {},
): Promise<TestApp> {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    LOG_FORMAT: 'text',
    DATABASE_URL: db.apiUrl,
    DATABASE_POOL_MAX: '10',
    SUPABASE_URL: TEST_SUPABASE_URL,
    WORKERS_ENABLED: 'false',
    ROUTING_PROVIDER: 'dev_fake',
    STORAGE_PROVIDER: 'in_memory',
    NOTIFICATION_PROVIDER: 'log',
    ...options.env,
  });

  let builder = Test.createTestingModule({ imports: [AppModule.register(config)] })
    .overrideProvider(TOKEN_VERIFIER)
    .useValue(
      new SupabaseTokenVerifier({
        mode: 'jwks',
        issuer: TEST_ISSUER,
        audience: TEST_AUDIENCE,
        keys: tokens.keySet(),
      }),
    );
  for (const override of options.overrides ?? []) {
    builder = builder.overrideProvider(override.token).useValue(override.value);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: createLogger(config),
  });
  configureApp(app, config);
  await app.init();

  return {
    app,
    config,
    http: () => request(app.getHttpServer()),
    get: <T>(type: abstract new (...args: never[]) => T): T =>
      moduleRef.get(type as never, { strict: false }),
    getToken: (token: symbol): unknown => moduleRef.get(token, { strict: false }),
    close: () => app.close(),
  };
}
