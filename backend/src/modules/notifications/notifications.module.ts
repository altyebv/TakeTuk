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
      useFactory: ({ notifications }: AppConfig): NotificationProvider => {
        if (notifications.provider !== 'fcm') return new LogNotificationProvider();
        // Configuration validation guarantees the project id and exactly one credential source.
        const projectId = notifications.fcmProjectId ?? '';
        return notifications.fcmServiceAccount
          ? FcmNotificationProvider.fromServiceAccount(projectId, notifications.fcmServiceAccount)
          : FcmNotificationProvider.fromServiceAccountFile(
              projectId,
              notifications.fcmServiceAccountFile ?? '',
            );
      },
    },
  ],
  exports: [NOTIFICATION_PROVIDER],
})
export class NotificationsModule {}
