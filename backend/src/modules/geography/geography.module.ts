import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { ServiceAreasService } from './application/service-areas.service';
import { DevFakeRoutingProvider } from './routing/dev-fake-routing.provider';
import { GoogleRoutesProvider } from './routing/google-routes.provider';
import { ROUTING_PROVIDER, type RoutingProvider } from './routing/routing-provider';

@Module({
  providers: [
    ServiceAreasService,
    {
      provide: ROUTING_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): RoutingProvider => {
        if (config.routing.provider === 'google') {
          // Presence is guaranteed by configuration validation.
          return new GoogleRoutesProvider(
            config.routing.googleApiKey ?? '',
            config.routing.timeoutMs,
          );
        }
        return new DevFakeRoutingProvider();
      },
    },
  ],
  exports: [ServiceAreasService, ROUTING_PROVIDER],
})
export class GeographyModule {}
