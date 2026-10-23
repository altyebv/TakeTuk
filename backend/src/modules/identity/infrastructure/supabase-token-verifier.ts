import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error';
import type { VerifiedIdentity } from '../../../shared/auth/auth-context';

/** Port: verifies a bearer token and returns the proven identity (ADR-0004). */
export interface TokenVerifier {
  verify(token: string): Promise<VerifiedIdentity>;
}

export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

export type TokenVerifierOptions =
  | {
      readonly mode: 'jwks';
      readonly issuer: string;
      readonly audience: string;
      /** Remote JWKS in production; a local key set in tests. */
      readonly keys: JWTVerifyGetKey;
    }
  | {
      readonly mode: 'legacy_hs256';
      readonly issuer: string;
      readonly audience: string;
      readonly secret: string;
    };

const CLOCK_TOLERANCE_SECONDS = 60;

/** Claims we rely on. Anything else in the token is ignored. */
const SupabaseClaimsSchema = z.object({
  sub: z.uuid(),
  role: z.literal('authenticated'),
  is_anonymous: z.boolean().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
});

export class SupabaseTokenVerifier implements TokenVerifier {
  private readonly secret: Uint8Array | undefined;

  constructor(private readonly options: TokenVerifierOptions) {
    this.secret =
      options.mode === 'legacy_hs256' ? new TextEncoder().encode(options.secret) : undefined;
  }

  static forJwksUrl(issuer: string, audience: string, jwksUrl: string): SupabaseTokenVerifier {
    return new SupabaseTokenVerifier({
      mode: 'jwks',
      issuer,
      audience,
      keys: createRemoteJWKSet(new URL(jwksUrl), {
        timeoutDuration: 3_000,
        cooldownDuration: 30_000,
      }),
    });
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    let payload: JWTPayload;
    try {
      payload = await this.verifySignatureAndRegisteredClaims(token);
    } catch (error) {
      if (isVerificationInfrastructureFailure(error)) {
        throw new AppError('AUTHENTICATION_UNAVAILABLE', undefined, { cause: error });
      }
      throw new AppError('INVALID_TOKEN', 'The access token is invalid or expired.', {
        cause: error,
      });
    }

    const claims = SupabaseClaimsSchema.safeParse(payload);
    if (!claims.success || claims.data.is_anonymous === true) {
      throw new AppError('INVALID_TOKEN', 'The access token is invalid or expired.');
    }

    return {
      userId: claims.data.sub,
      phoneE164: normalisePhone(claims.data.phone),
      email: claims.data.email && claims.data.email.length > 0 ? claims.data.email : null,
    };
  }

  private async verifySignatureAndRegisteredClaims(token: string): Promise<JWTPayload> {
    const common = {
      issuer: this.options.issuer,
      audience: this.options.audience,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ['exp', 'sub'],
    };
    if (this.options.mode === 'jwks') {
      const { payload } = await jwtVerify(token, this.options.keys, {
        ...common,
        algorithms: ['ES256', 'RS256'],
      });
      return payload;
    }
    if (!this.secret) {
      throw new Error('legacy secret not configured');
    }
    const { payload } = await jwtVerify(token, this.secret, { ...common, algorithms: ['HS256'] });
    return payload;
  }
}

/** Key-fetch failures are not the caller's fault: answer 503 rather than logging users out. */
function isVerificationInfrastructureFailure(error: unknown): boolean {
  if (error instanceof joseErrors.JWKSTimeout || error instanceof joseErrors.JWKSInvalid)
    return true;
  if (error instanceof joseErrors.JOSEError) return false;
  return true;
}

/** Supabase phone claims are E.164 digits without '+'. */
export function normalisePhone(phone: string | undefined): string | null {
  if (!phone) return null;
  const candidate = phone.startsWith('+') ? phone : `+${phone}`;
  return /^\+[1-9][0-9]{6,14}$/.test(candidate) ? candidate : null;
}
