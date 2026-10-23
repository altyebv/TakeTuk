import { z } from 'zod';

/**
 * Shared API value schemas (docs/api/API_CONVENTIONS.md §4).
 * Money is always integer minor units with an explicit currency.
 */

/** Upper bound protecting arithmetic (well below Number.MAX_SAFE_INTEGER); not a business cap. */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000;

export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code');

export const MoneySchema = z.strictObject({
  amountMinor: z.number().int().positive().max(MAX_AMOUNT_MINOR),
  currency: CurrencySchema,
});
export type MoneyInput = z.infer<typeof MoneySchema>;

export const MoneyResponseSchema = z.object({
  amountMinor: z.number().int(),
  currency: z.string(),
});
export type Money = z.infer<typeof MoneyResponseSchema>;

export const CoordinatesSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type Coordinates = z.infer<typeof CoordinatesSchema>;

export const LocationLabelSchema = z.string().trim().min(1).max(200);

export const UuidSchema = z.uuid();
export const IdParamSchema = z.strictObject({ id: UuidSchema });

export const ReasonSchema = z.string().trim().min(3).max(500);

export const money = (amountMinor: number, currency: string): Money => ({ amountMinor, currency });

export const isoDate = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;
