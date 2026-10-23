import { isAppError } from '../../../shared/errors/app-error';
import { SupabaseDocumentStorage } from './document-storage';

/** Answers every Storage request with `respond`, recording the method and URL. */
function storageWith(respond: (method: string, url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);
    return Promise.resolve(respond(method, url));
  }) as typeof fetch;
  return {
    calls,
    storage: new SupabaseDocumentStorage('https://project.supabase.co', 'sb_secret_x', fetchImpl),
  };
}

describe('SupabaseDocumentStorage.objectExists', () => {
  it('is true when the HEAD request succeeds', async () => {
    const { storage, calls } = storageWith(() => new Response(null, { status: 200 }));
    await expect(storage.objectExists('driver-documents', 'drivers/u/d.jpg')).resolves.toBe(true);
    expect(calls).toEqual([
      'HEAD https://project.supabase.co/storage/v1/object/driver-documents/drivers/u/d.jpg',
    ]);
  });

  // The live project answers a missing object's HEAD with a bare 400 (no body).
  it.each([400, 404])('is false when Storage answers %i', async (status) => {
    const { storage } = storageWith(() => new Response(null, { status }));
    await expect(storage.objectExists('driver-documents', 'missing.jpg')).resolves.toBe(false);
  });

  it('reports other failures as STORAGE_UNAVAILABLE', async () => {
    for (const respond of [
      () => new Response(null, { status: 500 }),
      () => Promise.reject(new TypeError('fetch failed')),
    ]) {
      const { storage } = storageWith(respond);
      const error: unknown = await storage.objectExists('b', 'p').catch((e: unknown) => e);
      expect(isAppError(error, 'STORAGE_UNAVAILABLE')).toBe(true);
    }
  });
});
