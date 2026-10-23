export { IdentityModule } from './identity.module';
export {
  IdentityService,
  requireRegistered,
  type RegistrationResult,
} from './application/identity.service';
export { DisplayNameSchema } from './http/identity.controller';
export type { UserContact } from './infrastructure/users.repository';
export {
  SupabaseTokenVerifier,
  TOKEN_VERIFIER,
  normalisePhone,
  type TokenVerifier,
  type TokenVerifierOptions,
} from './infrastructure/supabase-token-verifier';
