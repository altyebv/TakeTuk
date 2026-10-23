import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { IdentityService } from './application/identity.service';
import { AccessGuard } from './http/access.guard';
import { IdentityController } from './http/identity.controller';
import { SupabaseTokenVerifier, TOKEN_VERIFIER } from './infrastructure/supabase-token-verifier';
import { UsersRepository } from './infrastructure/users.repository';

@Global()
@Module({
  controllers: [IdentityController],
  providers: [
    UsersRepository,
    IdentityService,
    {
      provide: TOKEN_VERIFIER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.auth.mode === 'jwks'
          ? SupabaseTokenVerifier.forJwksUrl(
              config.auth.issuer,
              config.auth.audience,
              config.auth.jwksUrl,
            )
          : new SupabaseTokenVerifier({
              mode: 'legacy_hs256',
              issuer: config.auth.issuer,
              audience: config.auth.audience,
              secret: config.auth.jwtSecret ?? '',
            }),
    },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [IdentityService],
})
export class IdentityModule {}
