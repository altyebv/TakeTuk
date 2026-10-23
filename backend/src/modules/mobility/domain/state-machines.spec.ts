import { isAppError } from '../../../shared/errors/app-error';
import { agreedFareFor, assignmentStateMachine, offerStateMachine } from './offer';
import { RIDE_STATUSES, rideStateMachine, type RideActor, type RideStatus } from './ride';

const ACTORS: RideActor[] = ['passenger', 'driver', 'admin', 'system'];

/** Every (from, to, actor) the ride machine allows; anything else must be rejected. */
const ALLOWED: ReadonlyArray<[RideStatus | '(initial)', RideStatus, RideActor]> = [
  ['(initial)', 'searching', 'passenger'],
  ['searching', 'driver_assigned', 'system'],
  ['searching', 'cancelled', 'passenger'],
  ['searching', 'cancelled', 'admin'],
  ['searching', 'expired', 'system'],
  ['driver_assigned', 'driver_arrived', 'driver'],
  ['driver_assigned', 'cancelled', 'passenger'],
  ['driver_assigned', 'cancelled', 'driver'],
  ['driver_assigned', 'cancelled', 'admin'],
  ['driver_arrived', 'in_progress', 'driver'],
  ['driver_arrived', 'cancelled', 'passenger'],
  ['driver_arrived', 'cancelled', 'driver'],
  ['driver_arrived', 'cancelled', 'admin'],
  ['in_progress', 'completed', 'driver'],
  ['in_progress', 'cancelled', 'admin'],
];

describe('ride state machine', () => {
  it('allows exactly the documented transitions and actors (exhaustive)', () => {
    const allowed = new Set(ALLOWED.map(([f, t, a]) => `${f}|${t}|${a}`));
    for (const from of ['(initial)' as const, ...RIDE_STATUSES]) {
      for (const to of RIDE_STATUSES) {
        for (const actor of ACTORS) {
          expect({
            t: `${from}|${to}|${actor}`,
            ok: rideStateMachine.allows(from, to, actor),
          }).toEqual({
            t: `${from}|${to}|${actor}`,
            ok: allowed.has(`${from}|${to}|${actor}`),
          });
        }
      }
    }
  });

  it('never lets a passenger mark a trip arrived, started or completed', () => {
    expect(rideStateMachine.allows('driver_assigned', 'driver_arrived', 'passenger')).toBe(false);
    expect(rideStateMachine.allows('driver_arrived', 'in_progress', 'passenger')).toBe(false);
    expect(rideStateMachine.allows('in_progress', 'completed', 'passenger')).toBe(false);
  });

  it('keeps terminal states terminal', () => {
    for (const terminal of ['completed', 'cancelled', 'expired'] as const) {
      for (const to of RIDE_STATUSES) {
        expect(rideStateMachine.isDefined(terminal, to)).toBe(false);
      }
    }
  });

  it('throws INVALID_STATE_TRANSITION with the current status', () => {
    try {
      rideStateMachine.assert('in_progress', 'cancelled', 'passenger');
      throw new Error('expected rejection');
    } catch (error) {
      expect(isAppError(error, 'INVALID_STATE_TRANSITION')).toBe(true);
      expect((error as { extensions: unknown }).extensions).toEqual({
        currentStatus: 'in_progress',
      });
    }
  });
});

describe('offer (negotiation) state machine', () => {
  it('lets drivers respond to pending offers and passengers decide on counteroffers', () => {
    expect(offerStateMachine.allows('pending', 'accepted', 'driver')).toBe(true);
    expect(offerStateMachine.allows('pending', 'countered', 'driver')).toBe(true);
    expect(offerStateMachine.allows('pending', 'declined', 'driver')).toBe(true);
    expect(offerStateMachine.allows('countered', 'counter_accepted', 'passenger')).toBe(true);
    expect(offerStateMachine.allows('countered', 'counter_rejected', 'passenger')).toBe(true);
  });

  it('forbids self-dealing: drivers cannot accept their own counteroffer, passengers cannot accept for drivers', () => {
    expect(offerStateMachine.allows('countered', 'counter_accepted', 'driver')).toBe(false);
    expect(offerStateMachine.allows('pending', 'accepted', 'passenger')).toBe(false);
    expect(offerStateMachine.allows('countered', 'accepted', 'driver')).toBe(false);
  });

  it('only the system creates, expires and withdraws offers', () => {
    expect(offerStateMachine.allows('(initial)', 'pending', 'system')).toBe(true);
    expect(offerStateMachine.allows('(initial)', 'pending', 'driver')).toBe(false);
    expect(offerStateMachine.allows('pending', 'expired', 'driver')).toBe(false);
    expect(offerStateMachine.allows('countered', 'withdrawn', 'system')).toBe(true);
  });
});

describe('assignment state machine and agreed fare', () => {
  it('has a single active phase', () => {
    expect(assignmentStateMachine.pairs()).toEqual([
      ['(initial)', 'active'],
      ['active', 'completed'],
      ['active', 'cancelled'],
    ]);
  });

  it('settles on the proposal or the counteroffer depending on the basis', () => {
    expect(
      agreedFareFor('driver_accepted_passenger_proposal', {
        offeredFareMinor: 25_000,
        counterFareMinor: null,
      }),
    ).toBe(25_000);
    expect(
      agreedFareFor('passenger_accepted_driver_counteroffer', {
        offeredFareMinor: 25_000,
        counterFareMinor: 30_000,
      }),
    ).toBe(30_000);
    expect(() =>
      agreedFareFor('passenger_accepted_driver_counteroffer', {
        offeredFareMinor: 1,
        counterFareMinor: null,
      }),
    ).toThrow();
  });
});
