import { type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../errors/app-error';

/**
 * Validates untrusted input against a Zod schema (ADR-0014). TypeScript types are not runtime
 * validation: every body, query and path parameter goes through one of these pipes.
 */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(
    private readonly schema: S,
    private readonly location: 'body' | 'query' | 'params' = 'body',
  ) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }
    const prefix = this.location === 'body' ? '' : `${this.location}.`;
    throw new AppError('VALIDATION_FAILED', 'The request is invalid.', {
      errors: result.error.issues.map((issue) => ({
        path: `${prefix}${issue.path.map(String).join('.')}` || this.location,
        message: issue.message,
      })),
    });
  }
}

export const validBody = <S extends z.ZodType>(schema: S) => new ZodValidationPipe(schema, 'body');
export const validQuery = <S extends z.ZodType>(schema: S) =>
  new ZodValidationPipe(schema, 'query');
export const validParam = <S extends z.ZodType>(schema: S) =>
  new ZodValidationPipe(schema, 'params');
