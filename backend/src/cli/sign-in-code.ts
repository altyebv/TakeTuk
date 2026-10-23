/**
 * DEVELOPMENT ONLY: a sign-in code for a test account, issued through the Supabase Auth admin
 * API, so testers need no SMS or email delivery (OPEN_DECISIONS IDN-6). No message is sent. The
 * account is created on first use. Only `@example.com` addresses are accepted, a domain reserved
 * for testing, so the command can never sign in as a real person. Refused in production.
 */

export const TEST_EMAIL_DOMAIN = '@example.com';

export interface SignInCodeInput {
  readonly supabaseUrl: string;
  readonly secretKey: string;
  readonly email: string;
  readonly nodeEnv: string | undefined;
  readonly fetchImpl?: typeof fetch;
}

export interface SignInCode {
  readonly email: string;
  readonly code: string;
  /** True when this call created the account. */
  readonly created: boolean;
}

export async function issueSignInCode(input: SignInCodeInput): Promise<SignInCode> {
  if (input.nodeEnv === 'production') {
    throw new Error('sign-in-code is refused when NODE_ENV=production');
  }
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@example\.com$/.test(email)) {
    throw new Error(`sign-in-code only accepts test addresses ending in ${TEST_EMAIL_DOMAIN}`);
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const auth = `${input.supabaseUrl.replace(/\/$/, '')}/auth/v1`;
  const headers = {
    apikey: input.secretKey,
    Authorization: `Bearer ${input.secretKey}`,
    'content-type': 'application/json',
  };
  const post = async (path: string, body: object) => {
    const response = await fetchImpl(`${auth}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      // Not JSON: reported by status below.
    }
    return { status: response.status, json };
  };
  // Never echo the response body: it can hold tokens and links.
  const failure = (step: string, result: { status: number; json: Record<string, unknown> }) =>
    new Error(
      `Supabase refused to ${step} (HTTP ${result.status}${
        typeof result.json.error_code === 'string' ? `, ${result.json.error_code}` : ''
      }). Check SUPABASE_URL and SUPABASE_SECRET_KEY.`,
    );

  const created = await post('/admin/users', { email, email_confirm: true });
  const exists = created.status === 422 && created.json.error_code === 'email_exists';
  if (created.status !== 200 && !exists) throw failure('create the test account', created);

  const link = await post('/admin/generate_link', { type: 'magiclink', email });
  const properties = link.json.properties as Record<string, unknown> | undefined;
  const code = link.json.email_otp ?? properties?.email_otp;
  if (link.status !== 200 || typeof code !== 'string') throw failure('issue a code', link);
  return { email, code, created: !exists };
}
