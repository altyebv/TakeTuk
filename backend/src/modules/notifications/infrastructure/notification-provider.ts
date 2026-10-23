import { Logger } from '@nestjs/common';
import { GoogleAuth } from 'google-auth-library';

/**
 * Push notification port. Notifications are best-effort hints, never business state: clients
 * always reconcile through the API (ADR-0010).
 */
export interface PushMessage {
  readonly title: string;
  readonly body: string;
  /** String-only key/values delivered to the app (FCM data payload). */
  readonly data: Readonly<Record<string, string>>;
}

export interface PushResult {
  /** Tokens the provider reported as permanently invalid; their registrations are removed. */
  readonly invalidTokens: readonly string[];
}

export interface NotificationProvider {
  send(tokens: readonly string[], message: PushMessage): Promise<PushResult>;
}

export const NOTIFICATION_PROVIDER = Symbol('NOTIFICATION_PROVIDER');

/** Thrown for transient failures so the outbox retries with backoff. */
export class TransientPushError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientPushError';
  }
}

export type AccessTokenSource = () => Promise<string>;
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Firebase Cloud Messaging HTTP v1 adapter (APNs delivery for iOS is configured in the Firebase
 * project). Implemented against the documented `projects.messages.send` API; NOT yet verified
 * against a live Firebase project.
 */
const FCM_SCOPES = ['https://www.googleapis.com/auth/firebase.messaging'];

export class FcmNotificationProvider implements NotificationProvider {
  private readonly logger = new Logger(FcmNotificationProvider.name);

  constructor(
    private readonly projectId: string,
    private readonly accessToken: AccessTokenSource,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly timeoutMs = 5_000,
  ) {}

  static fromServiceAccountFile(projectId: string, keyFile: string): FcmNotificationProvider {
    return FcmNotificationProvider.withAuth(
      projectId,
      new GoogleAuth({ keyFile, scopes: FCM_SCOPES }),
    );
  }

  static fromServiceAccount(
    projectId: string,
    credentials: { readonly client_email: string; readonly private_key: string },
  ): FcmNotificationProvider {
    return FcmNotificationProvider.withAuth(
      projectId,
      new GoogleAuth({ credentials: { ...credentials }, scopes: FCM_SCOPES }),
    );
  }

  private static withAuth(projectId: string, auth: GoogleAuth): FcmNotificationProvider {
    return new FcmNotificationProvider(projectId, async () => {
      const token = await auth.getAccessToken();
      if (!token) throw new TransientPushError('could not obtain an FCM access token');
      return token;
    });
  }

  async send(tokens: readonly string[], message: PushMessage): Promise<PushResult> {
    if (tokens.length === 0) return { invalidTokens: [] };
    const bearer = await this.accessToken();
    const invalidTokens: string[] = [];
    const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/messages:send`;

    for (const token of tokens) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(buildFcmMessage(token, message)),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        throw new TransientPushError(
          `FCM request failed: ${error instanceof Error ? error.name : 'error'}`,
        );
      }
      if (response.ok) continue;
      if (response.status === 404 || response.status === 400) {
        // UNREGISTERED / INVALID_ARGUMENT for a token: drop it, do not retry.
        invalidTokens.push(token);
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        throw new TransientPushError(`FCM responded with HTTP ${response.status}`);
      }
      // 401/403: credentials or project misconfiguration — retrying will not help soon, but the
      // outbox's bounded retries plus the error log make it visible.
      this.logger.error(`FCM rejected the request with HTTP ${response.status}`);
      throw new TransientPushError(`FCM responded with HTTP ${response.status}`);
    }
    return { invalidTokens };
  }
}

export function buildFcmMessage(token: string, message: PushMessage): Record<string, unknown> {
  return {
    message: {
      token,
      notification: { title: message.title, body: message.body },
      data: message.data,
      android: { priority: 'high' },
      apns: { headers: { 'apns-priority': '10' } },
    },
  };
}

/**
 * DEVELOPMENT AND TEST ONLY: records messages in memory and logs them at debug level.
 * Refused by configuration in production.
 */
export class LogNotificationProvider implements NotificationProvider {
  private readonly logger = new Logger(LogNotificationProvider.name);
  readonly sent: Array<{ tokens: readonly string[]; message: PushMessage }> = [];
  /** Test hook: make the next N sends fail transiently. */
  failNext = 0;

  send(tokens: readonly string[], message: PushMessage): Promise<PushResult> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      return Promise.reject(new TransientPushError('simulated push failure'));
    }
    this.sent.push({ tokens, message });
    this.logger.debug(`push to ${tokens.length} device(s): ${message.title}`);
    return Promise.resolve({ invalidTokens: [] });
  }
}
