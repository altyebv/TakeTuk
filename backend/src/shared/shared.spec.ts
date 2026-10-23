import { Logger } from '@nestjs/common';
import { canonicalJson, fingerprint } from '../platform/idempotency';
import { outboxBackoffSeconds } from '../platform/outbox';
import { AppError } from './errors/app-error';
import { toProblem } from './http/problem-details.filter';
import { decodeCursor, encodeCursor, toPage } from './pagination';

const logger = new Logger('test');
beforeAll(() => {
  Logger.overrideLogger(false);
});

describe('problem details mapping', () => {
  it('renders AppErrors with their stable code and HTTP status', () => {
    const { problem } = toProblem(
      new AppError('FARE_BELOW_MINIMUM', 'too low', { extensions: { minimumFare: 1 } }),
      logger,
    );
    expect(problem).toMatchObject({
      status: 422,
      code: 'FARE_BELOW_MINIMUM',
      detail: 'too low',
      minimumFare: 1,
      type: 'https://docs.taketuk.app/problems/fare-below-minimum',
    });
  });

  it('never leaks internal error messages', () => {
    const { problem } = toProblem(new Error('password=hunter2 at db.example'), logger);
    expect(problem).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(problem)).not.toContain('hunter2');
  });

  it('maps database outages and the transition backstop', () => {
    expect(
      toProblem(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }), logger).problem.code,
    ).toBe('DATABASE_UNAVAILABLE');
    expect(toProblem(Object.assign(new Error('x'), { code: '57014' }), logger).problem.status).toBe(
      503,
    );
    expect(toProblem(Object.assign(new Error('x'), { code: 'TK001' }), logger).problem.code).toBe(
      'INVALID_STATE_TRANSITION',
    );
  });

  it('passes Retry-After for rate limits', () => {
    expect(
      toProblem(new AppError('RATE_LIMITED', undefined, { retryAfterSeconds: 60 }), logger)
        .retryAfter,
    ).toBe(60);
  });
});

describe('idempotency fingerprints', () => {
  it('ignore key order and undefined fields', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' }, z: undefined })).toBe(
      '{"a":{"c":"x","d":[1,2]},"b":1}',
    );
    expect(fingerprint({ quoteId: 'q', proposedFare: { currency: 'SDG', amountMinor: 1 } })).toBe(
      fingerprint({ proposedFare: { amountMinor: 1, currency: 'SDG' }, quoteId: 'q' }),
    );
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });
});

describe('outbox backoff', () => {
  it('grows exponentially and is capped', () => {
    expect([1, 2, 3, 4, 5].map(outboxBackoffSeconds)).toEqual([2, 4, 8, 16, 32]);
    expect(outboxBackoffSeconds(20)).toBe(300);
  });
});

describe('cursor pagination', () => {
  it('round-trips exact keys and rejects tampering', () => {
    const cursor = encodeCursor({ sortKey: '2026-10-23 01:02:03.123456+00', id: 'abc-1' });
    expect(decodeCursor(cursor)).toEqual({ sortKey: '2026-10-23 01:02:03.123456+00', id: 'abc-1' });
    expect(() => decodeCursor('not-base64-json')).toThrow(AppError);
    expect(() =>
      decodeCursor(Buffer.from(JSON.stringify({ k: "x'; drop", id: '1' })).toString('base64url')),
    ).toThrow(AppError);
  });

  it('builds pages from limit + 1 rows', () => {
    const rows = [1, 2, 3].map((n) => ({ n }));
    const page = toPage(
      rows,
      2,
      (r) => r.n,
      (r) => ({ sortKey: String(r.n), id: String(r.n) }),
    );
    expect(page.items).toEqual([1, 2]);
    expect(decodeCursor(page.nextCursor!)).toEqual({ sortKey: '2', id: '2' });
    expect(
      toPage(
        rows,
        3,
        (r) => r.n,
        (r) => ({ sortKey: '', id: String(r.n) }),
      ).nextCursor,
    ).toBeNull();
  });
});
