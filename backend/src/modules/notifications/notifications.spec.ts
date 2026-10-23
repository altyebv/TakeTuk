import type { OutboxEvent } from '../../platform/outbox';
import { deliveriesFor } from './application/notification-handlers';
import {
  buildFcmMessage,
  FcmNotificationProvider,
  TransientPushError,
  type FetchLike,
} from './infrastructure/notification-provider';

const event = (type: string, payload: Record<string, unknown>): OutboxEvent => ({
  id: 1,
  type,
  aggregateType: 'ride',
  aggregateId: 'r1',
  payload,
  attempts: 0,
});

describe('deliveriesFor', () => {
  it('routes ride events to the right app and user', () => {
    expect(
      deliveriesFor(event('ride.offer_created', { rideId: 'r1', offerId: 'o1', driverId: 'd1' })),
    ).toEqual([
      expect.objectContaining({
        userId: 'd1',
        app: 'driver',
        message: expect.objectContaining({
          data: { type: 'ride.offer_created', rideId: 'r1', offerId: 'o1' },
        }) as unknown,
      }),
    ]);
    const assigned = deliveriesFor(
      event('ride.assigned', { rideId: 'r1', passengerId: 'p1', driverId: 'd1' }),
    );
    expect(assigned.map((d) => [d.userId, d.app])).toEqual([
      ['p1', 'passenger'],
      ['d1', 'driver'],
    ]);
  });

  it('does not notify the party who cancelled', () => {
    const byPassenger = deliveriesFor(
      event('ride.cancelled', {
        rideId: 'r1',
        passengerId: 'p1',
        driverId: 'd1',
        cancelledByRole: 'passenger',
      }),
    );
    expect(byPassenger.map((d) => d.userId)).toEqual(['d1']);
    const byAdmin = deliveriesFor(
      event('ride.cancelled', {
        rideId: 'r1',
        passengerId: 'p1',
        driverId: null,
        cancelledByRole: 'admin',
      }),
    );
    expect(byAdmin.map((d) => d.userId)).toEqual(['p1']);
  });

  it('carries no business decisions — only identifiers to refresh from the API', () => {
    const [delivery] = deliveriesFor(
      event('ride.counteroffer_received', {
        rideId: 'r1',
        offerId: 'o1',
        passengerId: 'p1',
        amountMinor: 30_000,
        currency: 'SDG',
      }),
    );
    expect(Object.keys(delivery!.message.data).sort()).toEqual(['offerId', 'rideId', 'type']);
  });

  it('ignores unknown events', () => {
    expect(deliveriesFor(event('ride.requested', { rideId: 'r1', passengerId: 'p1' }))).toEqual([]);
  });
});

describe('FcmNotificationProvider (documented HTTP v1 format; not verified live)', () => {
  const message = { title: 'Driver assigned', body: 'On the way', data: { rideId: 'r1' } };

  it('sends one authenticated request per token and reports invalid tokens', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const responses = [new Response('{}', { status: 200 }), new Response('{}', { status: 404 })];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(responses.shift()!);
    };
    const provider = new FcmNotificationProvider(
      'taketuk-dev',
      () => Promise.resolve('oauth-token'),
      fetchImpl,
    );
    const result = await provider.send(['tok-a', 'tok-b'], message);
    expect(result.invalidTokens).toEqual(['tok-b']);
    expect(calls[0]!.url).toBe('https://fcm.googleapis.com/v1/projects/taketuk-dev/messages:send');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer oauth-token',
    );
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(buildFcmMessage('tok-a', message));
  });

  it('throws a transient error on 5xx/429 so the outbox retries', async () => {
    const provider = new FcmNotificationProvider(
      'p',
      () => Promise.resolve('t'),
      () => Promise.resolve(new Response('', { status: 503 })),
    );
    await expect(provider.send(['tok'], message)).rejects.toBeInstanceOf(TransientPushError);
  });

  it('does nothing without tokens', async () => {
    const provider = new FcmNotificationProvider('p', () =>
      Promise.reject(new Error('must not be called')),
    );
    await expect(provider.send([], message)).resolves.toEqual({ invalidTokens: [] });
  });
});
