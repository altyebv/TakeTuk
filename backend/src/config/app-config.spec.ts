import { ConfigurationError, loadConfig } from './app-config';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  SUPABASE_URL: 'http://127.0.0.1:54321',
};

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://u:p@db.example:5432/postgres?sslmode=verify-full',
  SUPABASE_URL: 'https://project.supabase.co',
  ROUTING_PROVIDER: 'google',
  GOOGLE_MAPS_API_KEY: 'server-key-placeholder',
  STORAGE_PROVIDER: 'supabase',
  SUPABASE_SECRET_KEY: 'secret-key-placeholder-0000',
  NOTIFICATION_PROVIDER: 'fcm',
  FCM_PROJECT_ID: 'taketuk',
  FCM_SERVICE_ACCOUNT_FILE: '/secrets/fcm.json',
};

const issuesOf = (env: Record<string, string>): string[] => {
  try {
    loadConfig(env);
    return [];
  } catch (error) {
    if (error instanceof ConfigurationError) return [...error.issues];
    throw error;
  }
};

describe('loadConfig', () => {
  it('derives the Supabase issuer and JWKS URL', () => {
    const config = loadConfig({ ...base, SUPABASE_URL: 'https://abc.supabase.co/' });
    expect(config.auth.issuer).toBe('https://abc.supabase.co/auth/v1');
    expect(config.auth.jwksUrl).toBe('https://abc.supabase.co/auth/v1/.well-known/jwks.json');
    expect(config.auth.mode).toBe('jwks');
  });

  it('applies documented development defaults for dispatch thresholds', () => {
    const config = loadConfig(base);
    expect(config.dispatch).toEqual({
      rideSearchTimeoutSeconds: 300,
      offerResponseTimeoutSeconds: 45,
      counterofferResponseTimeoutSeconds: 60,
      radiusMeters: 3000,
      batchSize: 5,
      locationMaxAgeSeconds: 120,
      retryIntervalSeconds: 10,
    });
  });

  it('requires a database URL and a Supabase URL', () => {
    expect(issuesOf({})).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^DATABASE_URL/),
        expect.stringMatching(/^SUPABASE_URL/),
      ]),
    );
  });

  it('treats empty strings as unset', () => {
    expect(issuesOf({ ...base, DATABASE_URL: '' })).toEqual([
      expect.stringMatching(/^DATABASE_URL/),
    ]);
  });

  it('allows only one JWT verification mode at a time', () => {
    expect(issuesOf({ ...base, AUTH_JWT_MODE: 'legacy_hs256' })).toEqual([
      expect.stringMatching(/^AUTH_JWT_SECRET/),
    ]);
    expect(issuesOf({ ...base, AUTH_JWT_SECRET: 'x'.repeat(40) })).toEqual([
      expect.stringMatching(/^AUTH_JWT_SECRET/),
    ]);
  });

  it('accepts a complete production configuration', () => {
    expect(issuesOf(production)).toEqual([]);
  });

  it('refuses development substitutes and insecure settings in production', () => {
    const issues = issuesOf({
      ...production,
      ROUTING_PROVIDER: 'dev_fake',
      STORAGE_PROVIDER: 'in_memory',
      NOTIFICATION_PROVIDER: 'log',
      DATABASE_URL: 'postgres://u:p@db.example:5432/postgres?sslmode=require',
      SUPABASE_URL: 'http://project.supabase.co',
      API_DOCS_ENABLED: 'true',
    });
    expect(issues.map((i) => i.split(':')[0])).toEqual(
      expect.arrayContaining([
        'ROUTING_PROVIDER',
        'STORAGE_PROVIDER',
        'NOTIFICATION_PROVIDER',
        'DATABASE_URL',
        'SUPABASE_URL',
        'API_DOCS_ENABLED',
      ]),
    );
  });

  it('requires provider credentials when a real provider is selected', () => {
    expect(issuesOf({ ...base, ROUTING_PROVIDER: 'google' })).toEqual([
      expect.stringMatching(/^GOOGLE_MAPS_API_KEY/),
    ]);
    expect(issuesOf({ ...base, STORAGE_PROVIDER: 'supabase' })).toEqual([
      expect.stringMatching(/^SUPABASE_SECRET_KEY/),
    ]);
    expect(issuesOf({ ...base, NOTIFICATION_PROVIDER: 'fcm' })).toEqual([
      expect.stringMatching(/^FCM_PROJECT_ID/),
      expect.stringMatching(/^FCM_SERVICE_ACCOUNT_JSON: set exactly one/),
    ]);
  });

  describe('FCM service-account key from the environment', () => {
    // A structurally valid but fake key: only the shape is checked here.
    const key = {
      type: 'service_account',
      project_id: 'taketuk',
      client_email: 'push@taketuk.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nFAKEKEY\n-----END PRIVATE KEY-----\n',
    };
    const fcm = { ...base, NOTIFICATION_PROVIDER: 'fcm', FCM_PROJECT_ID: 'taketuk' };

    it('accepts the key JSON or its base64 encoding', () => {
      for (const value of [
        JSON.stringify(key),
        Buffer.from(JSON.stringify(key)).toString('base64'),
      ]) {
        const config = loadConfig({ ...fcm, FCM_SERVICE_ACCOUNT_JSON: value });
        expect(config.notifications.fcmServiceAccount).toEqual({
          client_email: key.client_email,
          private_key: key.private_key,
        });
        expect(config.notifications.fcmServiceAccountFile).toBeUndefined();
      }
    });

    it('requires exactly one credential source', () => {
      expect(
        issuesOf({
          ...fcm,
          FCM_SERVICE_ACCOUNT_JSON: JSON.stringify(key),
          FCM_SERVICE_ACCOUNT_FILE: '/secrets/fcm.json',
        }),
      ).toEqual([expect.stringMatching(/^FCM_SERVICE_ACCOUNT_JSON: set exactly one/)]);
    });

    it('rejects malformed keys without echoing them', () => {
      for (const value of [
        'not-a-key',
        JSON.stringify({ ...key, type: 'authorized_user' }),
        JSON.stringify({ ...key, private_key: 'secret-but-wrong' }),
      ]) {
        const issues = issuesOf({ ...fcm, FCM_SERVICE_ACCOUNT_JSON: value });
        expect(issues).toEqual([expect.stringMatching(/^FCM_SERVICE_ACCOUNT_JSON: must be/)]);
        expect(issues.join(' ')).not.toContain('secret-but-wrong');
        expect(issues.join(' ')).not.toContain('FAKEKEY');
      }
    });
  });

  it('configures OSRM routing with a bounded snap radius', () => {
    expect(issuesOf({ ...base, ROUTING_PROVIDER: 'osrm' })).toEqual([
      expect.stringMatching(/^OSRM_BASE_URL/),
    ]);
    const config = loadConfig({
      ...base,
      ROUTING_PROVIDER: 'osrm',
      OSRM_BASE_URL: 'http://127.0.0.1:5000',
    });
    expect(config.routing).toMatchObject({
      provider: 'osrm',
      osrmBaseUrl: 'http://127.0.0.1:5000',
      osrmSnapRadiusMeters: 500,
    });
    expect(issuesOf({ ...base, OSRM_SNAP_RADIUS_METERS: '0' })).toEqual([
      expect.stringMatching(/^OSRM_SNAP_RADIUS_METERS/),
    ]);
  });

  it('requires https for OSRM in production unless a private network is declared', () => {
    const osrm = {
      ...production,
      ROUTING_PROVIDER: 'osrm',
      GOOGLE_MAPS_API_KEY: '',
      OSRM_BASE_URL: 'http://osrm.internal:5000',
    };
    expect(issuesOf(osrm)).toEqual([expect.stringMatching(/^OSRM_BASE_URL: must use https/)]);
    expect(issuesOf({ ...osrm, OSRM_ALLOW_HTTP: 'true' })).toEqual([]);
    expect(issuesOf({ ...osrm, OSRM_BASE_URL: 'https://osrm.example' })).toEqual([]);
  });

  it('rejects out-of-range thresholds', () => {
    expect(issuesOf({ ...base, DISPATCH_BATCH_SIZE: '0' })).toEqual([
      expect.stringMatching(/^DISPATCH_BATCH_SIZE/),
    ]);
    expect(issuesOf({ ...base, PORT: 'abc' })).toEqual([expect.stringMatching(/^PORT/)]);
  });
});
