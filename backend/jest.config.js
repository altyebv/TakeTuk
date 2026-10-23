/**
 * Two projects:
 *  - unit:        pure tests (domain rules, adapters with mocked transports, architecture rules)
 *  - integration: tests against a real PostgreSQL + PostGIS database (see test/support).
 * Type checking is done by `npm run typecheck`; ts-jest transpiles only (isolatedModules).
 * @type {import('jest').Config}
 */
const transform = { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] };

module.exports = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      rootDir: __dirname,
      testMatch: [
        '<rootDir>/src/**/*.spec.ts',
        '<rootDir>/test/architecture/**/*.spec.ts',
        '<rootDir>/test/unit/**/*.spec.ts',
      ],
      transform,
      moduleFileExtensions: ['ts', 'js', 'json'],
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      rootDir: __dirname,
      testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
      transform,
      moduleFileExtensions: ['ts', 'js', 'json'],
      globalSetup: '<rootDir>/test/support/global-setup.ts',
      testTimeout: 60000,
    },
  ],
};
