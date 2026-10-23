import { randomUUID } from 'node:crypto';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from 'jose';

export const TEST_SUPABASE_URL = 'http://supabase.test';
export const TEST_ISSUER = `${TEST_SUPABASE_URL}/auth/v1`;
export const TEST_AUDIENCE = 'authenticated';

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

export interface TokenOptions {
  readonly phone?: string;
  readonly expiresInSeconds?: number;
  readonly issuer?: string;
  readonly audience?: string;
  readonly role?: string;
  readonly isAnonymous?: boolean;
  readonly extraClaims?: Record<string, unknown>;
}

/**
 * Signs Supabase-shaped access tokens with a locally generated ES256 key. The application's
 * verifier uses the same code path as production with a local key set instead of remote JWKS.
 */
export class TestTokens {
  private constructor(
    private readonly privateKey: SigningKey,
    readonly jwks: JSONWebKeySet,
  ) {}

  static async create(): Promise<TestTokens> {
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
    const jwk = await exportJWK(publicKey);
    return new TestTokens(privateKey, {
      keys: [{ ...jwk, kid: 'test-key-1', alg: 'ES256', use: 'sig' }],
    });
  }

  keySet(): JWTVerifyGetKey {
    return createLocalJWKSet(this.jwks);
  }

  async sign(userId: string, options: TokenOptions = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      role: options.role ?? 'authenticated',
      is_anonymous: options.isAnonymous ?? false,
      session_id: randomUUID(),
      ...(options.phone ? { phone: options.phone } : {}),
      ...options.extraClaims,
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(options.issuer ?? TEST_ISSUER)
      .setAudience(options.audience ?? TEST_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + (options.expiresInSeconds ?? 3600))
      .sign(this.privateKey);
  }
}
