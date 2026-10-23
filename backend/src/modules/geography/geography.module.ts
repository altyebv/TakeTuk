import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { ServiceAreasService } from './application/service-areas.service';
import { DevFakeRoutingProvider } from './routing/dev-fake-routing.provider';
import { GoogleRoutesProvider } from './routing/google-routes.provider';
import { OsrmRoutingProvider } from './routing/osrm-routing.provider';
import { ROUTING_PROVIDER, type RoutingProvider } from './routing/routing-provider';

@Module({
  providers: [
    ServiceAreasService,
    {
      provide: ROUTING_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): RoutingProvider => {
        // Presence of provider settings is guaranteed by configuration validation.
        switch (config.routing.provider) {
          case 'google':
            return new GoogleRoutesProvider(
              config.routing.googleApiKey ?? '',
              config.routing.timeoutMs,
            );
          case 'osrm':
            return new OsrmRoutingProvider(
              config.routing.osrmBaseUrl ?? '',
              config.routing.osrmSnapRadiusMeters,
              config.routing.timeoutMs,
            );
          case 'dev_fake':
            return new DevFakeRoutingProvider();
        }
      },
    },
  ],
  exports: [ServiceAreasService, ROUTING_PROVIDER],
})
export class GeographyModule {}
