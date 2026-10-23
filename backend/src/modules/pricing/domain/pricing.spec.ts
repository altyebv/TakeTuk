import { isAppError } from '../../../shared/errors/app-error';
import { calculateMinimumFare } from './minimum-fare';
import { assertCounterofferAcceptable, assertProposalAcceptable } from './negotiation-rules';

const policy = {
  baseFareMinor: 10_000,
  perKmFareMinor: 5_000,
  minimumFareMinor: 20_000,
  roundingIncrementMinor: 500,
};

describe('calculateMinimumFare', () => {
  it('applies base + per-km, rounding the distance part up to whole minor units', () => {
    // 10 000 + ceil(5 000 × 2 500 / 1 000) = 22 500
    expect(calculateMinimumFare(policy, 2_500)).toBe(22_500);
    // 10 000 + ceil(5 000 × 2 501 / 1 000) = 10 000 + 12 505 = 22 505 → rounded up to 23 000
    expect(calculateMinimumFare(policy, 2_501)).toBe(23_000);
  });

  it('never goes below the floor', () => {
    expect(calculateMinimumFare(policy, 0)).toBe(20_000);
    expect(calculateMinimumFare(policy, 1_000)).toBe(20_000);
  });

  it('rounds up to the increment', () => {
    expect(calculateMinimumFare({ ...policy, roundingIncrementMinor: 1 }, 2_501)).toBe(22_505);
    expect(calculateMinimumFare({ ...policy, roundingIncrementMinor: 10_000 }, 2_500)).toBe(30_000);
  });

  it('uses exact integer arithmetic for large values', () => {
    const big = {
      baseFareMinor: 0,
      perKmFareMinor: 999_999_999,
      minimumFareMinor: 1,
      roundingIncrementMinor: 1,
    };
    expect(calculateMinimumFare(big, 3)).toBe(3_000_000); // ceil(2 999 999 997 / 1 000)
    expect(calculateMinimumFare(big, 1_000_000)).toBe(999_999_999_000);
  });

  it('rejects invalid inputs instead of producing a fare', () => {
    expect(() => calculateMinimumFare(policy, -1)).toThrow(RangeError);
    expect(() => calculateMinimumFare(policy, 1.5)).toThrow(RangeError);
    expect(() => calculateMinimumFare({ ...policy, roundingIncrementMinor: 0 }, 1)).toThrow(
      RangeError,
    );
    expect(() => calculateMinimumFare({ ...policy, baseFareMinor: Number.NaN }, 1)).toThrow(
      RangeError,
    );
  });
});

describe('negotiation rules', () => {
  const snapshot = { minimumFareMinor: 22_500, currency: 'SDG' };
  const code = (fn: () => void): string | undefined => {
    try {
      fn();
      return undefined;
    } catch (error) {
      return isAppError(error) ? error.code : 'unexpected';
    }
  };

  it('accepts proposals at or above the minimum', () => {
    expect(
      code(() => {
        assertProposalAcceptable(snapshot, { amountMinor: 22_500, currency: 'SDG' });
      }),
    ).toBeUndefined();
    expect(
      code(() => {
        assertProposalAcceptable(snapshot, { amountMinor: 50_000, currency: 'SDG' });
      }),
    ).toBeUndefined();
  });

  it('rejects proposals below the minimum or in another currency', () => {
    expect(
      code(() => {
        assertProposalAcceptable(snapshot, { amountMinor: 22_499, currency: 'SDG' });
      }),
    ).toBe('FARE_BELOW_MINIMUM');
    expect(
      code(() => {
        assertProposalAcceptable(snapshot, { amountMinor: 50_000, currency: 'USD' });
      }),
    ).toBe('CURRENCY_MISMATCH');
  });

  it('requires counteroffers to meet the minimum and exceed the proposal', () => {
    const counter = { ...snapshot, proposedFareMinor: 25_000 };
    expect(
      code(() => {
        assertCounterofferAcceptable(counter, { amountMinor: 25_001, currency: 'SDG' });
      }),
    ).toBeUndefined();
    expect(
      code(() => {
        assertCounterofferAcceptable(counter, { amountMinor: 25_000, currency: 'SDG' });
      }),
    ).toBe('COUNTEROFFER_NOT_ABOVE_PROPOSAL');
    expect(
      code(() => {
        assertCounterofferAcceptable(counter, { amountMinor: 20_000, currency: 'SDG' });
      }),
    ).toBe('FARE_BELOW_MINIMUM');
    expect(
      code(() => {
        assertCounterofferAcceptable(counter, { amountMinor: 30_000, currency: 'EUR' });
      }),
    ).toBe('CURRENCY_MISMATCH');
  });
});
