import { randomBytes } from 'node:crypto';
import { SupabaseTokenVerifier } from '../../src/modules/identity';
import { isAppError } from '../../src/shared/errors/app-error';

/**
 * Exercises SupabaseTokenVerifier against the Supabase project in SUPABASE_URL. A throwaway
 * user signs in with an email one-time code exactly as the apps do (`POST /auth/v1/verify`,
 * type `email`, publishable key only); the admin API issues the code, so no email is sent. The
 * user is deleted afterwards. Needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and
 * SUPABASE_SECRET_KEY, and an Auth project using asymmetric signing keys (AUTH_JWT_MODE=jwks).
 */
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !publishableKey || !secretKey) {
  throw new Error(
    'SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY must be set for the live Supabase check',
  );
}

const issuer = `${supabaseUrl}/auth/v1`;
const verifier = SupabaseTokenVerifier.forJwksUrl(
  issuer,
  'authenticated',
  `${issuer}/.well-known/jwks.json`,
);
const admin = {
  apikey: secretKey,
  Authorization: `Bearer ${secretKey}`,
  'content-type': 'application/json',
};

/** The fields of Supabase Auth responses this check reads. */
interface AuthBody {
  id?: string;
  email_otp?: string;
  properties?: { email_otp?: string };
  access_token?: string;
  error_code?: string;
  code?: string;
}

async function auth(path: string, init: RequestInit): Promise<{ status: number; body: AuthBody }> {
  const response = await fetch(`${issuer}${path}`, init);
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as AuthBody) : {} };
}

const signIn = (email: string, token: string) =>
  auth('/verify', {
    method: 'POST',
    headers: { apikey: publishableKey, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'email', email, token }),
  });

describe('SupabaseTokenVerifier against the live Supabase project', () => {
  const email = `taketuk-live-${randomBytes(4).toString('hex')}@example.com`;
  let userId: string | undefined;
  let code: string;

  beforeAll(async () => {
    const created = await auth('/admin/users', {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ email, email_confirm: true }),
    });
    expect(created.status).toBe(200);
    userId = created.body.id;
    expect(userId).toBeDefined();
    const link = await auth('/admin/generate_link', {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ type: 'magiclink', email }),
    });
    expect(link.status).toBe(200);
    code = link.body.email_otp ?? link.body.properties?.email_otp ?? '';
    expect(code).toMatch(/^\d{6,10}$/);
  });

  afterAll(async () => {
    if (userId) {
      const deleted = await auth(`/admin/users/${userId}`, { method: 'DELETE', headers: admin });
      expect(deleted.status).toBe(200);
    }
  });

  it('answers a wrong code with otp_expired, which the apps show as a wrong code', async () => {
    const wrong = await signIn(email, code === '00000000' ? '11111111' : '00000000');
    expect(wrong.status).toBe(403);
    expect(wrong.body.error_code ?? wrong.body.code).toBe('otp_expired');
  });

  it('verifies the token issued for an email sign-in', async () => {
    const session = await signIn(email, code);
    expect(session.status).toBe(200);
    const token = session.body.access_token ?? '';
    expect(JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString()).alg).toBe('ES256');

    await expect(verifier.verify(token)).resolves.toEqual({ userId, phoneE164: null, email });

    const tampered =
      token.slice(0, -2) + (token.slice(-2, -1) === 'A' ? 'B' : 'A') + token.slice(-1);
    const error: unknown = await verifier.verify(tampered).catch((e: unknown) => e);
    expect(isAppError(error, 'INVALID_TOKEN')).toBe(true);
  });
});
