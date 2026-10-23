import { issueSignInCode } from './sign-in-code';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Supabase Auth admin API stand-in: answers by path, recording each request. */
function adminApi(answers: Record<string, Response>) {
  const calls: Array<{ path: string; body: unknown; apikey: string | undefined }> = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    calls.push({
      path,
      body: JSON.parse(init?.body as string) as unknown,
      apikey: (init?.headers as Record<string, string>).apikey,
    });
    return Promise.resolve(answers[path] ?? json(404, {}));
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const base = {
  supabaseUrl: 'https://project.supabase.co/',
  secretKey: 'sb_secret_x',
  nodeEnv: 'development',
};

describe('issueSignInCode', () => {
  it('creates the test account on first use and returns its code', async () => {
    const api = adminApi({
      '/auth/v1/admin/users': json(200, { id: 'u1' }),
      '/auth/v1/admin/generate_link': json(200, { email_otp: '12345678' }),
    });
    const result = await issueSignInCode({
      ...base,
      email: ' Passenger@Example.com ',
      fetchImpl: api.fetchImpl,
    });
    expect(result).toEqual({ email: 'passenger@example.com', code: '12345678', created: true });
    expect(api.calls).toEqual([
      {
        path: '/auth/v1/admin/users',
        body: { email: 'passenger@example.com', email_confirm: true },
        apikey: 'sb_secret_x',
      },
      {
        path: '/auth/v1/admin/generate_link',
        body: { type: 'magiclink', email: 'passenger@example.com' },
        apikey: 'sb_secret_x',
      },
    ]);
  });

  it('reuses an existing account', async () => {
    const api = adminApi({
      '/auth/v1/admin/users': json(422, { error_code: 'email_exists' }),
      '/auth/v1/admin/generate_link': json(200, { properties: { email_otp: '87654321' } }),
    });
    await expect(
      issueSignInCode({ ...base, email: 'driver@example.com', fetchImpl: api.fetchImpl }),
    ).resolves.toEqual({ email: 'driver@example.com', code: '87654321', created: false });
  });

  it('refuses production and addresses outside example.com, without calling Supabase', async () => {
    const api = adminApi({});
    await expect(
      issueSignInCode({
        ...base,
        nodeEnv: 'production',
        email: 'a@example.com',
        fetchImpl: api.fetchImpl,
      }),
    ).rejects.toThrow('refused when NODE_ENV=production');
    for (const email of ['someone@gmail.com', 'a@example.com.evil.sd', 'a@sub.example.com', '']) {
      await expect(issueSignInCode({ ...base, email, fetchImpl: api.fetchImpl })).rejects.toThrow(
        'only accepts test addresses',
      );
    }
    expect(api.calls).toEqual([]);
  });

  it('reports refusals by status without echoing the response', async () => {
    const api = adminApi({
      '/auth/v1/admin/users': json(401, { msg: 'Invalid API key', access_token: 'secret-token' }),
    });
    const error: unknown = await issueSignInCode({
      ...base,
      email: 'a@example.com',
      fetchImpl: api.fetchImpl,
    }).catch((e: unknown) => e);
    expect(String(error)).toContain('HTTP 401');
    expect(String(error)).not.toContain('secret-token');
  });
});
