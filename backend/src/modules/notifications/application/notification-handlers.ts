import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { Database } from '../../../infrastructure/database/database';
import { OutboxHandlerRegistry, type OutboxEvent } from '../../../platform/outbox';
import {
  DeviceRegistrationsRepository,
  type ClientApp,
} from '../infrastructure/device-registrations.repository';
import {
  NOTIFICATION_PROVIDER,
  type NotificationProvider,
  type PushMessage,
} from '../infrastructure/notification-provider';

interface Delivery {
  readonly userId: string;
  readonly app: ClientApp;
  readonly message: PushMessage;
}

const RidePayload = z.object({
  rideId: z.string(),
  passengerId: z.string().optional(),
  driverId: z.string().nullable().optional(),
  offerId: z.string().optional(),
  cancelledByRole: z.string().optional(),
  withdrawnDriverIds: z.array(z.string()).optional(),
});
const DriverPayload = z.object({ driverId: z.string() });

const msg = (title: string, body: string, data: Record<string, string>): PushMessage => ({
  title,
  body,
  data,
});

/**
 * Turns domain events into push notifications. Content is presentation only: no business decision
 * is made here, and every message tells the app to refresh state from the API.
 * Copy is English placeholder text; localisation (Arabic first) is planned.
 */
export function deliveriesFor(event: OutboxEvent): Delivery[] {
  const type = event.type;
  if (type.startsWith('driver.')) {
    const { driverId } = DriverPayload.parse(event.payload);
    const status = type.slice('driver.'.length);
    return [
      {
        userId: driverId,
        app: 'driver',
        message: msg('Account update', `Your driver account was ${status}.`, { type, driverId }),
      },
    ];
  }

  const p = RidePayload.parse(event.payload);
  const data = { type, rideId: p.rideId, ...(p.offerId ? { offerId: p.offerId } : {}) };
  const toPassenger = (title: string, body: string): Delivery[] =>
    p.passengerId
      ? [{ userId: p.passengerId, app: 'passenger', message: msg(title, body, data) }]
      : [];
  const toDriver = (title: string, body: string): Delivery[] =>
    p.driverId ? [{ userId: p.driverId, app: 'driver', message: msg(title, body, data) }] : [];

  switch (type) {
    case 'ride.offer_created':
      return toDriver('New ride request', 'A passenger near you requested a ride.');
    case 'ride.counteroffer_received':
      return toPassenger('Counteroffer received', 'A driver proposed a different fare.');
    case 'ride.counteroffer_rejected':
      return toDriver('Counteroffer declined', 'The passenger declined your fare.');
    case 'ride.assigned':
      return [
        ...toPassenger('Driver assigned', 'Your driver is on the way.'),
        ...toDriver('Ride confirmed', 'Head to the pickup point.'),
      ];
    case 'ride.driver_arrived':
      return toPassenger('Driver arrived', 'Your driver is at the pickup point.');
    case 'ride.started':
      return toPassenger('Trip started', 'Have a safe trip.');
    case 'ride.completed':
      return toPassenger('Trip completed', 'Thank you for riding with TAKE-TUK.');
    case 'ride.expired':
      return toPassenger('No driver found', 'No driver accepted in time. You can request again.');
    case 'ride.cancelled':
      return [
        ...(p.cancelledByRole !== 'passenger'
          ? toPassenger('Ride cancelled', 'Your ride was cancelled.')
          : []),
        ...(p.cancelledByRole !== 'driver'
          ? toDriver('Ride cancelled', 'The ride was cancelled.')
          : []),
      ];
    default:
      return [];
  }
}

export const NOTIFIED_EVENT_TYPES = [
  'ride.offer_created',
  'ride.counteroffer_received',
  'ride.counteroffer_rejected',
  'ride.assigned',
  'ride.driver_arrived',
  'ride.started',
  'ride.completed',
  'ride.expired',
  'ride.cancelled',
  'driver.approved',
  'driver.rejected',
  'driver.suspended',
  'driver.reinstated',
] as const;

@Injectable()
export class NotificationHandlers implements OnModuleInit {
  constructor(
    private readonly registry: OutboxHandlerRegistry,
    private readonly db: Database,
    private readonly devices: DeviceRegistrationsRepository,
    @Inject(NOTIFICATION_PROVIDER) private readonly provider: NotificationProvider,
  ) {}

  onModuleInit(): void {
    for (const type of NOTIFIED_EVENT_TYPES) {
      this.registry.register(type, (event) => this.deliver(event));
    }
  }

  /** At-least-once: a retry after a partial failure may notify some devices twice. */
  async deliver(event: OutboxEvent): Promise<void> {
    for (const delivery of deliveriesFor(event)) {
      const tokens = await this.devices.tokensFor(this.db, delivery.userId, delivery.app);
      if (tokens.length === 0) continue;
      const result = await this.provider.send(tokens, delivery.message);
      await this.devices.removeTokens(this.db, result.invalidTokens);
    }
  }
}
