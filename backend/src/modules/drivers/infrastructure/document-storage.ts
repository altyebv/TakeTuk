import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { StorageClient } from '@supabase/storage-js';
import { AppError } from '../../../shared/errors/app-error';

/**
 * Private document storage port (SECURITY.md §6). The backend chooses every object path;
 * clients only ever receive short-lived signed URLs.
 */
export interface SignedUpload {
  readonly url: string;
  readonly method: 'PUT';
  /** Supabase signed upload URLs are valid for two hours. */
  readonly expiresInSeconds: number;
}

export interface DocumentStorage {
  createSignedUploadUrl(bucket: string, path: string, contentType: string): Promise<SignedUpload>;
  objectExists(bucket: string, path: string): Promise<boolean>;
  createSignedViewUrl(
    bucket: string,
    path: string,
    ttlSeconds: number,
  ): Promise<{ url: string; expiresAt: Date }>;
}

export const DOCUMENT_STORAGE = Symbol('DOCUMENT_STORAGE');

const SUPABASE_SIGNED_UPLOAD_TTL_SECONDS = 2 * 60 * 60;

/**
 * Supabase Storage adapter using the official storage-js client with the server-side secret key.
 * Verified against the live project by `npm run test:live -- supabase-storage`.
 */
export class SupabaseDocumentStorage implements DocumentStorage {
  private readonly logger = new Logger(SupabaseDocumentStorage.name);
  private readonly client: StorageClient;

  constructor(supabaseUrl: string, secretKey: string, fetchImpl?: typeof fetch) {
    // New-style secret keys (sb_secret_...) are not JWTs and go only in the apikey header;
    // legacy service_role keys are JWTs and are also sent as a bearer token.
    const headers: Record<string, string> = secretKey.startsWith('sb_secret_')
      ? { apikey: secretKey }
      : { apikey: secretKey, Authorization: `Bearer ${secretKey}` };
    this.client = new StorageClient(`${supabaseUrl}/storage/v1`, headers, fetchImpl);
  }

  async createSignedUploadUrl(bucket: string, path: string): Promise<SignedUpload> {
    const { data, error } = await this.client.from(bucket).createSignedUploadUrl(path);
    if (error) {
      this.logger.warn(`createSignedUploadUrl failed: ${error.message}`);
      throw new AppError('STORAGE_UNAVAILABLE', undefined, { cause: error });
    }
    return {
      url: data.signedUrl,
      method: 'PUT',
      expiresInSeconds: SUPABASE_SIGNED_UPLOAD_TTL_SECONDS,
    };
  }

  async objectExists(bucket: string, path: string): Promise<boolean> {
    try {
      // storage-js answers a missing object (Storage replies 400 or 404 to the HEAD request) with
      // data=false, and throws for every other failure.
      const { data } = await this.client.from(bucket).exists(path);
      return data;
    } catch (error) {
      this.logger.warn(`exists failed: ${error instanceof Error ? error.message : 'unknown'}`);
      throw new AppError('STORAGE_UNAVAILABLE', undefined, { cause: error });
    }
  }

  async createSignedViewUrl(
    bucket: string,
    path: string,
    ttlSeconds: number,
  ): Promise<{ url: string; expiresAt: Date }> {
    const { data, error } = await this.client.from(bucket).createSignedUrl(path, ttlSeconds);
    if (error) {
      this.logger.warn(`createSignedUrl failed: ${error.message}`);
      throw new AppError('STORAGE_UNAVAILABLE', undefined, { cause: error });
    }
    return { url: data.signedUrl, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }
}

/**
 * DEVELOPMENT AND TEST ONLY: in-memory stand-in. `markUploaded` simulates the client's direct
 * upload to the signed URL. Refused by configuration in production.
 */
export class InMemoryDocumentStorage implements DocumentStorage {
  private readonly objects = new Set<string>();
  failing = false;

  createSignedUploadUrl(bucket: string, path: string): Promise<SignedUpload> {
    this.assertAvailable();
    return Promise.resolve({
      url: `memory://${bucket}/${path}?token=${randomUUID()}`,
      method: 'PUT',
      expiresInSeconds: SUPABASE_SIGNED_UPLOAD_TTL_SECONDS,
    });
  }

  objectExists(bucket: string, path: string): Promise<boolean> {
    this.assertAvailable();
    return Promise.resolve(this.objects.has(`${bucket}/${path}`));
  }

  createSignedViewUrl(
    bucket: string,
    path: string,
    ttlSeconds: number,
  ): Promise<{ url: string; expiresAt: Date }> {
    this.assertAvailable();
    return Promise.resolve({
      url: `memory://${bucket}/${path}?view=${randomUUID()}`,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    });
  }

  markUploaded(bucket: string, path: string): void {
    this.objects.add(`${bucket}/${path}`);
  }

  private assertAvailable(): void {
    if (this.failing) throw new AppError('STORAGE_UNAVAILABLE');
  }
}
