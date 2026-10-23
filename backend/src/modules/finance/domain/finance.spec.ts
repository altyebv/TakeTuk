import { calculateCommission, paymentStateMachine, rideCommissionEntries } from './finance';

describe('calculateCommission', () => {
  it('computes basis points with round-half-up integer arithmetic', () => {
    expect(calculateCommission(25_000, 1_000)).toBe(2_500);
    expect(calculateCommission(12_345, 1_000)).toBe(1_235); // 1 234.5 → 1 235
    expect(calculateCommission(12_344, 1_000)).toBe(1_234); // 1 234.4 → 1 234
    expect(calculateCommission(1, 4_999)).toBe(0); // 0.4999 → 0
    expect(calculateCommission(1, 5_000)).toBe(1); // 0.5 → 1
    expect(calculateCommission(25_000, 0)).toBe(0);
    expect(calculateCommission(25_000, 10_000)).toBe(25_000);
  });

  it('is exact for large amounts', () => {
    expect(calculateCommission(999_999_999_999, 1_234)).toBe(123_400_000_000);
  });

  it('rejects invalid inputs', () => {
    expect(() => calculateCommission(-1, 100)).toThrow(RangeError);
    expect(() => calculateCommission(100, 10_001)).toThrow(RangeError);
    expect(() => calculateCommission(1.5, 100)).toThrow(RangeError);
  });
});

describe('ledger postings', () => {
  it('produces balanced double entries for a ride commission', () => {
    const entries = rideCommissionEntries('driver-1', 'SDG', 2_500);
    expect(entries.reduce((sum, e) => sum + e.amountMinor, 0)).toBe(0);
    expect(entries).toEqual([
      {
        accountType: 'driver_commission_receivable',
        driverId: 'driver-1',
        currency: 'SDG',
        amountMinor: 2_500,
      },
      {
        accountType: 'platform_commission_revenue',
        driverId: null,
        currency: 'SDG',
        amountMinor: -2_500,
      },
    ]);
  });
});

describe('payment state machine', () => {
  it('lets only the system create obligations and only drivers report collection', () => {
    expect(paymentStateMachine.allows('(initial)', 'awaiting_collection', 'system')).toBe(true);
    expect(paymentStateMachine.allows('(initial)', 'awaiting_collection', 'driver')).toBe(false);
    expect(paymentStateMachine.allows('awaiting_collection', 'collected', 'driver')).toBe(true);
    expect(paymentStateMachine.allows('collected', 'reported_unpaid', 'driver')).toBe(false);
  });
});
