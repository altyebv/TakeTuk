# ADR-0002: NestJS and TypeScript on Node.js 24 LTS

- Status: Accepted
- Date: 2026-10-23

## Context

The directive mandates NestJS with strict TypeScript for the backend. Concrete versions had to be chosen, and the toolchain state in October 2026 constrained that choice:

- NestJS 12 (released August 2026) ships as ES modules only.
- TypeScript 7.0 (the native Go compiler) is released, but `ts-jest` (peer `typescript <7`) and `typescript-eslint` (peer `typescript <6.1`) do not support it yet.
- Jest 30 can load ESM-only dependencies from CommonJS test code through `require(esm)` only on Node.js ≥ 24.9, and only with `--experimental-vm-modules`.

## Decision

- **Runtime:** Node.js 24 LTS (`>=24.9`), pinned by `.nvmrc` and `engines`.
- **Framework:** NestJS 12, Express adapter.
- **Language:** TypeScript 6.0 with `strict: true` and additional strictness (`noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `exactOptionalPropertyTypes` was considered; see Consequences). The application compiles to CommonJS and loads the ESM-only NestJS packages through Node's stable `require(esm)`, following the official NestJS 12 application template.
- **Tests:** Jest 30 with `ts-jest`, run with `--experimental-vm-modules` (as in the official template). Supertest for HTTP-level tests.
- **Lint and format:** ESLint 10 with `typescript-eslint` (type-aware rules, including `no-explicit-any`, `no-floating-promises` and `no-unsafe-*`), and Prettier.

## Alternatives considered

- **NestJS 11 (CommonJS).** A mature path, but it starts a greenfield project on the previous major version, with a migration already due.
- **TypeScript 7.** Faster compiles, but the test and lint toolchain cannot use it yet. Revisit once `ts-jest` and `typescript-eslint` support it.
- **Vitest.** Natural for ESM, but NestJS's DI relies on decorator metadata, which needs an SWC plugin under Vitest. Jest plus ts-jest is the documented NestJS path.
- **Full ESM application output.** Possible, but it requires `.js` extensions on every relative import and diverges from the official template. It brings no benefit today.

## Rationale

These are the current supported major versions, which follow the framework's own template, and every tool in the chain is compatible. All of this was verified in this environment, where a probe project built, ran and tested successfully.

## Consequences

- Contributors need Node 24 (an LTS release). Node 22 cannot run the test suite.
- `exactOptionalPropertyTypes` is not enabled: it conflicts with several library typings. Revisit later.
- Jest prints an `ExperimentalWarning` for VM modules. This is expected.

## Risks

- `--experimental-vm-modules` is experimental. If Jest changes behaviour, move to Vitest with SWC.
- TypeScript 6 → 7 migration later: low risk, because the codebase avoids compiler API usage outside tooling.
