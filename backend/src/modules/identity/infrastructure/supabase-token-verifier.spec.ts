import { randomUUID } from 'node:crypto';
import { createLocalJWKSet, generateKeyPair, SignJWT } from 'jose';
import { TestTokens, TEST_AUDIENCE, TEST_ISSUER } from '../../../../test/support/test-tokens';
import { isAppError } from '../../../shared/errors/app-error';
import { normalisePhone, SupabaseTokenVerifier } from './supabase-token-verifier';

describe('SupabaseTokenVerifier', () => {
  let tokens: TestTokens;
  let verifier: SupabaseTokenVerifier;
  const userId = randomUUID();

  beforeAll(async () => {
    tokens = await TestTokens.create();
    verifier = new SupabaseTokenVerifier({
      mode: 'jwks',
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
      keys: tokens.keySet(),
    });
  });

  const expectInvalid = async (token: string) => {
    const error: unknown = await verifier.verify(token).catch((e: unknown) => e);
    expect(isAppError(error, 'INVALID_TOKEN')).toBe(true);
  };

  it('accepts a valid token and returns only the proven identity', async () => {
    const identity = await verifier.verify(await tokens.sign(userId, { phone: '249912345678' }));
    expect(identity).toEqual({ userId, phoneE164: '+249912345678', email: null });
  });

  it('rejects an expired token (beyond the 60 s clock tolerance)', async () => {
    await expectInvalid(await tokens.sign(userId, { expiresInSeconds: -120 }));
  });

  it('rejects a wrong issuer', async () => {
    await expectInvalid(await tokens.sign(userId, { issuer: 'https://evil.example/auth/v1' }));
  });

  it('rejects a wrong audience', async () => {
    await expectInvalid(await tokens.sign(userId, { audience: 'anon' }));
  });

  it('rejects tokens whose role is not "authenticated" (e.g. anon or service_role keys)', async () => {
    await expectInvalid(await tokens.sign(userId, { role: 'service_role' }));
    await expectInvalid(await tokens.sign(userId, { role: 'anon' }));
  });

  it('rejects anonymous Supabase users', async () => {
    await expectInvalid(await tokens.sign(userId, { isAnonymous: true }));
  });

  it('rejects a non-UUID subject', async () => {
    await expectInvalid(await tokens.sign('not-a-uuid'));
  });

  it('rejects a token signed by an unknown key', async () => {
    const { privateKey } = await generateKeyPair('ES256');
    const forged = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
      .setSubject(userId)
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setExpirationTime('1h')
      .sign(privateKey);
    await expectInvalid(forged);
  });

  it('rejects alg=none and HS256 tokens in JWKS mode (no algorithm confusion)', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: userId,
        role: 'authenticated',
        iss: TEST_ISSUER,
        aud: TEST_AUDIENCE,
        exp: 9999999999,
      }),
    ).toString('base64url');
    await expectInvalid(`${header}.${payload}.`);

    const hs = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('x'.repeat(32)));
    await expectInvalid(hs);
  });

  it('rejects garbage', async () => {
    await expectInvalid('not.a.jwt');
    await expectInvalid('');
  });

  it('verifies legacy HS256 tokens only in legacy mode', async () => {
    const secret = 's'.repeat(40);
    const legacy = new SupabaseTokenVerifier({
      mode: 'legacy_hs256',
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
      secret,
    });
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret));
    await expect(legacy.verify(token)).resolves.toMatchObject({ userId });
    // An ES256 token must not be accepted by the HS256 verifier.
    await expect(legacy.verify(await tokens.sign(userId))).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
  });

  it('answers 503-class AUTHENTICATION_UNAVAILABLE when keys cannot be fetched', async () => {
    const failing = new SupabaseTokenVerifier({
      mode: 'jwks',
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
      keys: () => Promise.reject(new TypeError('fetch failed')),
    });
    await expect(failing.verify(await tokens.sign(userId))).rejects.toMatchObject({
      code: 'AUTHENTICATION_UNAVAILABLE',
    });
    // A key set that simply lacks the key is a client error, not an outage.
    const empty = new SupabaseTokenVerifier({
      mode: 'jwks',
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
      keys: createLocalJWKSet({ keys: [] }),
    });
    await expect(empty.verify(await tokens.sign(userId))).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
  });
});

describe('normalisePhone', () => {
  it('normalises Supabase phone claims to E.164', () => {
    expect(normalisePhone('249912345678')).toBe('+249912345678');
    expect(normalisePhone('+249912345678')).toBe('+249912345678');
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone(undefined)).toBeNull();
    expect(normalisePhone('0912')).toBeNull();
  });
});
