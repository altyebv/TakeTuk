/**
 * Live provider checks, run on demand only (`npm run test:live`), never as part of `npm test`.
 * Each spec states which external service it needs and refuses to run without it.
 * @type {import('jest').Config}
 */
module.exports = {
  displayName: 'live',
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['<rootDir>/test/live/**/*.live-spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 30000,
};
