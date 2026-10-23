/**
 * Minimum permitted fare (ADR-0011). All arithmetic is integer (BigInt) in minor units:
 *
 *   minimum = roundUp( max(floor, base + ceil(perKm × distance_m / 1000)), increment )
 *
 * The parameters come from a versioned fare policy; no price is hard-coded anywhere.
 */
export interface FarePolicyParameters {
  readonly baseFareMinor: number;
  readonly perKmFareMinor: number;
  readonly minimumFareMinor: number;
  readonly roundingIncrementMinor: number;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function assertNonNegativeSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer, got ${value}`);
  }
}

export function calculateMinimumFare(policy: FarePolicyParameters, distanceMeters: number): number {
  assertNonNegativeSafeInteger('distanceMeters', distanceMeters);
  assertNonNegativeSafeInteger('baseFareMinor', policy.baseFareMinor);
  assertNonNegativeSafeInteger('perKmFareMinor', policy.perKmFareMinor);
  assertNonNegativeSafeInteger('minimumFareMinor', policy.minimumFareMinor);
  if (!Number.isSafeInteger(policy.roundingIncrementMinor) || policy.roundingIncrementMinor <= 0) {
    throw new RangeError('roundingIncrementMinor must be a positive safe integer');
  }

  const distancePart = ceilDiv(BigInt(policy.perKmFareMinor) * BigInt(distanceMeters), 1000n);
  const raw = BigInt(policy.baseFareMinor) + distancePart;
  const floor = BigInt(policy.minimumFareMinor);
  const atLeastFloor = raw > floor ? raw : floor;
  const increment = BigInt(policy.roundingIncrementMinor);
  const rounded = ceilDiv(atLeastFloor, increment) * increment;

  const result = Number(rounded);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError('minimum fare exceeds the safe integer range');
  }
  return result;
}
