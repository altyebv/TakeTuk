import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { NotificationHandlers } from './application/notification-handlers';
import { DevicesController } from './http/devices.controller';
import { DeviceRegistrationsRepository } from './infrastructure/device-registrations.repository';
import {
  FcmNotificationProvider,
  LogNotificationProvider,
  NOTIFICATION_PROVIDER,
  type NotificationProvider,
} from './infrastructure/notification-provider';

@Module({
  controllers: [DevicesController],
  providers: [
    DeviceRegistrationsRepository,
    NotificationHandlers,
    {
      provide: NOTIFICATION_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): NotificationProvider =>
        config.notifications.provider === 'fcm'
          ? FcmNotificationProvider.fromServiceAccountFile(
              config.notifications.fcmProjectId ?? '',
              config.notifications.fcmServiceAccountFile ?? '',
            )
          : new LogNotificationProvider(),
    },
  ],
  exports: [NOTIFICATION_PROVIDER],
})
export class NotificationsModule {}
