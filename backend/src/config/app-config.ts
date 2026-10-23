import { z } from 'zod';

/**
 * Environment configuration, validated at startup. The process refuses to start with an
 * invalid configuration (MANIFESTO §3.8). Defaults are development defaults; operational
 * thresholds are documented in docs/operations/OPERATIONS.md and OPEN_DECISIONS DSP-1.
 */

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const integer = (defaultValue: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(defaultValue);

const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// or postgresql:// connection string');

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: integer(3000, 1, 65535),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    LOG_FORMAT: z.enum(['json', 'text']).default('json'),
    TRUST_PROXY: booleanString.default(false),
    API_DOCS_ENABLED: booleanString.default(false),

    DATABASE_URL: postgresUrl,
    DATABASE_POOL_MAX: integer(10, 1, 100),
    DATABASE_STATEMENT_TIMEOUT_MS: integer(10_000, 100, 600_000),

    SUPABASE_URL: z.url(),
    AUTH_JWT_MODE: z.enum(['jwks', 'legacy_hs256']).default('jwks'),
    AUTH_JWT_SECRET: z.string().min(32).optional(),
    AUTH_JWT_AUDIENCE: z.string().min(1).default('authenticated'),
    AUTH_JWKS_URL: z.url().optional(),

    STORAGE_PROVIDER: z.enum(['supabase', 'in_memory']).default('in_memory'),
    SUPABASE_SECRET_KEY: z.string().min(20).optional(),
    STORAGE_DRIVER_DOCUMENTS_BUCKET: z.string().min(1).default('driver-documents'),
    STORAGE_VIEW_URL_TTL_SECONDS: integer(300, 30, 3600),

    ROUTING_PROVIDER: z.enum(['google', 'osrm', 'dev_fake']).default('dev_fake'),
    GOOGLE_MAPS_API_KEY: z.string().min(10).optional(),
    OSRM_BASE_URL: z.url().optional(),
    OSRM_SNAP_RADIUS_METERS: integer(500, 10, 5000),
    OSRM_ALLOW_HTTP: booleanString.default(false),
    ROUTING_TIMEOUT_MS: integer(5000, 500, 30_000),

    NOTIFICATION_PROVIDER: z.enum(['fcm', 'log']).default('log'),
    FCM_PROJECT_ID: z.string().min(1).optional(),
    FCM_SERVICE_ACCOUNT_FILE: z.string().min(1).optional(),
    FCM_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),

    WORKERS_ENABLED: booleanString.default(true),
    DISPATCH_TICK_MS: integer(2000, 200, 60_000),
    OUTBOX_TICK_MS: integer(1000, 200, 60_000),
    MAINTENANCE_TICK_MS: integer(300_000, 10_000, 86_400_000),

    QUOTE_TTL_SECONDS: integer(600, 60, 3600),
    QUOTE_RATE_LIMIT_PER_MINUTE: integer(10, 1, 1000),
    RIDE_SEARCH_TIMEOUT_SECONDS: integer(300, 30, 3600),
    OFFER_RESPONSE_TIMEOUT_SECONDS: integer(45, 5, 600),
    COUNTEROFFER_RESPONSE_TIMEOUT_SECONDS: integer(60, 5, 600),
    DISPATCH_RADIUS_METERS: integer(3000, 100, 50_000),
    DISPATCH_BATCH_SIZE: integer(5, 1, 50),
    DRIVER_LOCATION_MAX_AGE_SECONDS: integer(120, 10, 3600),
    DISPATCH_RETRY_INTERVAL_SECONDS: integer(10, 1, 600),
    OUTBOX_MAX_ATTEMPTS: integer(8, 1, 50),
    OUTBOX_BATCH_SIZE: integer(20, 1, 500),
    IDEMPOTENCY_TTL_HOURS: integer(24, 1, 168),
  })
  .superRefine((env, ctx) => {
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };

    if (env.AUTH_JWT_MODE === 'legacy_hs256' && !env.AUTH_JWT_SECRET) {
      issue('AUTH_JWT_SECRET', 'required when AUTH_JWT_MODE=legacy_hs256');
    }
    if (env.AUTH_JWT_MODE === 'jwks' && env.AUTH_JWT_SECRET) {
      issue(
        'AUTH_JWT_SECRET',
        'must not be set when AUTH_JWT_MODE=jwks (one verification mode only)',
      );
    }
    if (env.STORAGE_PROVIDER === 'supabase' && !env.SUPABASE_SECRET_KEY) {
      issue('SUPABASE_SECRET_KEY', 'required when STORAGE_PROVIDER=supabase');
    }
    if (env.ROUTING_PROVIDER === 'google' && !env.GOOGLE_MAPS_API_KEY) {
      issue('GOOGLE_MAPS_API_KEY', 'required when ROUTING_PROVIDER=google');
    }
    if (env.ROUTING_PROVIDER === 'osrm' && !env.OSRM_BASE_URL) {
      issue('OSRM_BASE_URL', 'required when ROUTING_PROVIDER=osrm');
    }
    if (env.NOTIFICATION_PROVIDER === 'fcm') {
      if (!env.FCM_PROJECT_ID) {
        issue('FCM_PROJECT_ID', 'required when NOTIFICATION_PROVIDER=fcm');
      }
      if (!env.FCM_SERVICE_ACCOUNT_FILE === !env.FCM_SERVICE_ACCOUNT_JSON) {
        issue(
          'FCM_SERVICE_ACCOUNT_JSON',
          'set exactly one of FCM_SERVICE_ACCOUNT_FILE and FCM_SERVICE_ACCOUNT_JSON when NOTIFICATION_PROVIDER=fcm',
        );
      }
    }
    if (env.FCM_SERVICE_ACCOUNT_JSON && !parseServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON)) {
      // The value is a credential: never echo it.
      issue(
        'FCM_SERVICE_ACCOUNT_JSON',
        'must be a Google service-account key (JSON, or that JSON base64-encoded)',
      );
    }

    if (env.NODE_ENV === 'production') {
      if (env.ROUTING_PROVIDER === 'dev_fake') {
        issue('ROUTING_PROVIDER', 'dev_fake is not allowed in production');
      }
      if (env.STORAGE_PROVIDER === 'in_memory') {
        issue('STORAGE_PROVIDER', 'in_memory is not allowed in production');
      }
      if (env.NOTIFICATION_PROVIDER === 'log') {
        issue('NOTIFICATION_PROVIDER', 'log is not allowed in production');
      }
      if (!/[?&]sslmode=verify-(full|ca)\b/.test(env.DATABASE_URL)) {
        issue('DATABASE_URL', 'production connections must use sslmode=verify-full or verify-ca');
      }
      if (!env.SUPABASE_URL.startsWith('https://')) {
        issue('SUPABASE_URL', 'must use https in production');
      }
      // Route requests carry trip coordinates (personal data). Plain HTTP only over a private
      // network that is itself encrypted, declared explicitly (docs/security/SECURITY.md).
      if (
        env.ROUTING_PROVIDER === 'osrm' &&
        env.OSRM_BASE_URL?.startsWith('http://') &&
        !env.OSRM_ALLOW_HTTP
      ) {
        issue('OSRM_BASE_URL', 'must use https in production unless OSRM_ALLOW_HTTP=true');
      }
      if (env.API_DOCS_ENABLED) {
        issue('API_DOCS_ENABLED', 'interactive API docs are disabled in production');
      }
    }
  });

export type Environment = z.input<typeof environmentSchema>;

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly log: {
    readonly level: 'debug' | 'info' | 'warn' | 'error';
    readonly format: 'json' | 'text';
  };
  readonly http: { readonly trustProxy: boolean; readonly apiDocsEnabled: boolean };
  readonly database: {
    readonly url: string;
    readonly poolMax: number;
    readonly statementTimeoutMs: number;
  };
  readonly auth: {
    readonly mode: 'jwks' | 'legacy_hs256';
    readonly issuer: string;
    readonly audience: string;
    readonly jwksUrl: string;
    readonly jwtSecret: string | undefined;
  };
  readonly storage: {
    readonly provider: 'supabase' | 'in_memory';
    readonly supabaseUrl: string;
    readonly secretKey: string | undefined;
    readonly driverDocumentsBucket: string;
    readonly viewUrlTtlSeconds: number;
  };
  readonly routing: {
    readonly provider: 'google' | 'osrm' | 'dev_fake';
    readonly googleApiKey: string | undefined;
    readonly osrmBaseUrl: string | undefined;
    readonly osrmSnapRadiusMeters: number;
    readonly timeoutMs: number;
  };
  readonly notifications: {
    readonly provider: 'fcm' | 'log';
    readonly fcmProjectId: string | undefined;
    readonly fcmServiceAccountFile: string | undefined;
    /** Parsed from FCM_SERVICE_ACCOUNT_JSON. A credential: never log it. */
    readonly fcmServiceAccount: ServiceAccountKey | undefined;
  };
  readonly workers: {
    readonly enabled: boolean;
    readonly dispatchTickMs: number;
    readonly outboxTickMs: number;
    readonly maintenanceTickMs: number;
  };
  readonly pricing: {
    readonly quoteTtlSeconds: number;
    readonly quoteRateLimitPerMinute: number;
  };
  readonly dispatch: DispatchSettings;
  readonly outbox: { readonly maxAttempts: number; readonly batchSize: number };
  readonly idempotency: { readonly ttlHours: number };
}

export interface DispatchSettings {
  readonly rideSearchTimeoutSeconds: number;
  readonly offerResponseTimeoutSeconds: number;
  readonly counterofferResponseTimeoutSeconds: number;
  readonly radiusMeters: number;
  readonly batchSize: number;
  readonly locationMaxAgeSeconds: number;
  readonly retryIntervalSeconds: number;
}

export class ConfigurationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigurationError';
  }
}

export function loadConfig(source: Record<string, string | undefined>): AppConfig {
  // Treat empty strings as unset so `FOO=` in an env file does not bypass "required" checks.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const parsed = environmentSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new ConfigurationError(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const env = parsed.data;
  const supabaseUrl = env.SUPABASE_URL.replace(/\/+$/, '');
  const issuer = `${supabaseUrl}/auth/v1`;

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    log: { level: env.LOG_LEVEL, format: env.LOG_FORMAT },
    http: { trustProxy: env.TRUST_PROXY, apiDocsEnabled: env.API_DOCS_ENABLED },
    database: {
      url: env.DATABASE_URL,
      poolMax: env.DATABASE_POOL_MAX,
      statementTimeoutMs: env.DATABASE_STATEMENT_TIMEOUT_MS,
    },
    auth: {
      mode: env.AUTH_JWT_MODE,
      issuer,
      audience: env.AUTH_JWT_AUDIENCE,
      jwksUrl: env.AUTH_JWKS_URL ?? `${issuer}/.well-known/jwks.json`,
      jwtSecret: env.AUTH_JWT_SECRET,
    },
    storage: {
      provider: env.STORAGE_PROVIDER,
      supabaseUrl,
      secretKey: env.SUPABASE_SECRET_KEY,
      driverDocumentsBucket: env.STORAGE_DRIVER_DOCUMENTS_BUCKET,
      viewUrlTtlSeconds: env.STORAGE_VIEW_URL_TTL_SECONDS,
    },
    routing: {
      provider: env.ROUTING_PROVIDER,
      googleApiKey: env.GOOGLE_MAPS_API_KEY,
      osrmBaseUrl: env.OSRM_BASE_URL,
      osrmSnapRadiusMeters: env.OSRM_SNAP_RADIUS_METERS,
      timeoutMs: env.ROUTING_TIMEOUT_MS,
    },
    notifications: {
      provider: env.NOTIFICATION_PROVIDER,
      fcmProjectId: env.FCM_PROJECT_ID,
      fcmServiceAccountFile: env.FCM_SERVICE_ACCOUNT_FILE,
      fcmServiceAccount: env.FCM_SERVICE_ACCOUNT_JSON
        ? parseServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON)
        : undefined,
    },
    workers: {
      enabled: env.WORKERS_ENABLED,
      dispatchTickMs: env.DISPATCH_TICK_MS,
      outboxTickMs: env.OUTBOX_TICK_MS,
      maintenanceTickMs: env.MAINTENANCE_TICK_MS,
    },
    pricing: {
      quoteTtlSeconds: env.QUOTE_TTL_SECONDS,
      quoteRateLimitPerMinute: env.QUOTE_RATE_LIMIT_PER_MINUTE,
    },
    dispatch: {
      rideSearchTimeoutSeconds: env.RIDE_SEARCH_TIMEOUT_SECONDS,
      offerResponseTimeoutSeconds: env.OFFER_RESPONSE_TIMEOUT_SECONDS,
      counterofferResponseTimeoutSeconds: env.COUNTEROFFER_RESPONSE_TIMEOUT_SECONDS,
      radiusMeters: env.DISPATCH_RADIUS_METERS,
      batchSize: env.DISPATCH_BATCH_SIZE,
      locationMaxAgeSeconds: env.DRIVER_LOCATION_MAX_AGE_SECONDS,
      retryIntervalSeconds: env.DISPATCH_RETRY_INTERVAL_SECONDS,
    },
    outbox: { maxAttempts: env.OUTBOX_MAX_ATTEMPTS, batchSize: env.OUTBOX_BATCH_SIZE },
    idempotency: { ttlHours: env.IDEMPOTENCY_TTL_HOURS },
  };
}

/** The fields of a Google service-account key that FCM authentication needs. */
export interface ServiceAccountKey {
  readonly client_email: string;
  readonly private_key: string;
}

const ServiceAccountSchema = z.looseObject({
  type: z.literal('service_account'),
  client_email: z.string().min(3),
  private_key: z.string().startsWith('-----BEGIN PRIVATE KEY-----'),
});

/**
 * Accepts the key file's JSON or its base64 encoding, which survives environment-variable
 * editors that cannot hold multi-line or quoted values (`base64 -w0 key.json`).
 */
export function parseServiceAccount(value: string): ServiceAccountKey | undefined {
  const trimmed = value.trim();
  const json = trimmed.startsWith('{') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8');
  try {
    const parsed = ServiceAccountSchema.safeParse(JSON.parse(json));
    return parsed.success
      ? { client_email: parsed.data.client_email, private_key: parsed.data.private_key }
      : undefined;
  } catch {
    return undefined;
  }
}

export const APP_CONFIG = Symbol('APP_CONFIG');
