import { randomBytes } from 'node:crypto';
import { StorageClient } from '@supabase/storage-js';
import {
  type DocumentStorage,
  SupabaseDocumentStorage,
} from '../../src/modules/drivers/infrastructure/document-storage';

/**
 * Exercises SupabaseDocumentStorage and the project's security posture against the Supabase
 * project in SUPABASE_URL, after the migrations have been applied (`supabase db push`):
 * - the `driver-documents` bucket is private and restricted to the document types;
 * - the `taketuk` schema is not reachable through the Data API with the publishable key;
 * - a document uploads through a signed URL exactly as the driver app sends it, and can be read
 *   back only through a signed view URL.
 * Objects are written under `live-check/` and removed afterwards. Needs SUPABASE_URL,
 * SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY.
 */
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !publishableKey || !secretKey) {
  throw new Error(
    'SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY must be set for the live Supabase check',
  );
}

const bucket = 'driver-documents';
const storage: DocumentStorage = new SupabaseDocumentStorage(supabaseUrl, secretKey);
const admin = new StorageClient(`${supabaseUrl}/storage/v1`, {
  apikey: secretKey,
  Authorization: `Bearer ${secretKey}`,
});
const prefix = `live-check/${randomBytes(4).toString('hex')}`;
const written: string[] = [];

// JPEG magic bytes and noise: Storage checks the declared content type, not the bytes.
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);

/** The driver app's upload: a PUT of the file bytes with the headers the API returned. */
async function uploadLikeTheApp(path: string, contentType: string, body: Buffer) {
  const grant = await storage.createSignedUploadUrl(bucket, path, contentType);
  written.push(path);
  return fetch(grant.url, {
    method: grant.method,
    headers: { 'Content-Type': contentType },
    body: new Uint8Array(body),
  });
}

describe('Supabase project posture (live)', () => {
  it('keeps driver-documents private and limited to document types', async () => {
    const { data, error } = await admin.getBucket(bucket);
    expect(error).toBeNull();
    expect(data).toMatchObject({ public: false, file_size_limit: 10485760 });
    expect([...(data?.allowed_mime_types ?? [])].sort()).toEqual([
      'application/pdf',
      'image/jpeg',
      'image/png',
    ]);
  });

  it('does not expose the taketuk schema through the Data API', async () => {
    const response = await fetch(`${supabaseUrl}/rest/v1/users?select=id`, {
      headers: { apikey: publishableKey, 'Accept-Profile': 'taketuk' },
    });
    expect(response.status).toBe(406);
    expect(((await response.json()) as { code?: string }).code).toBe('PGRST106');
  });
});

describe('SupabaseDocumentStorage against the live project', () => {
  afterAll(async () => {
    if (written.length > 0) {
      const { error } = await admin.from(bucket).remove(written);
      expect(error).toBeNull();
    }
  });

  it('uploads through a signed URL as the driver app does, and serves it only when signed', async () => {
    const path = `${prefix}/licence.jpg`;
    expect(await storage.objectExists(bucket, path)).toBe(false);

    const upload = await uploadLikeTheApp(path, 'image/jpeg', jpeg);
    expect(upload.status).toBe(200);
    expect(await storage.objectExists(bucket, path)).toBe(true);

    const view = await storage.createSignedViewUrl(bucket, path, 60);
    const fetched = await fetch(view.url);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer()).equals(jpeg)).toBe(true);

    // Without a signature, neither the public path nor the publishable key can read it.
    const unsigned = await fetch(`${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`);
    expect(unsigned.ok).toBe(false);
    const anon = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${path}`, {
      headers: { apikey: publishableKey },
    });
    expect(anon.ok).toBe(false);
  });

  it('refuses file types outside the bucket allow-list', async () => {
    const upload = await uploadLikeTheApp(`${prefix}/note.txt`, 'text/plain', Buffer.from('x'));
    expect(upload.ok).toBe(false);
  });

  it('cannot reuse a signed upload URL to overwrite a document', async () => {
    const path = `${prefix}/once.jpg`;
    const grant = await storage.createSignedUploadUrl(bucket, path, 'image/jpeg');
    written.push(path);
    const put = () =>
      fetch(grant.url, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: new Uint8Array(jpeg),
      });
    expect((await put()).status).toBe(200);
    expect((await put()).ok).toBe(false);
  });
});
