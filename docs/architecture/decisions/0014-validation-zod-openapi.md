# ADR-0014: Runtime validation with Zod; OpenAPI from the same schemas

- Status: Accepted
- Date: 2026-10-23

## Context

The directive requires runtime validation of untrusted input with one consistent, maintained approach, and an OpenAPI specification for the implemented endpoints. TypeScript types alone do not validate anything at runtime.

## Decision

- Every request body, query and path parameter is validated with a **Zod 4** schema through a small `ZodValidationPipe`. Object schemas are strict: unknown keys are rejected. Types are inferred from the schemas.
- Environment configuration is validated with Zod at startup. The process refuses to start with an invalid configuration.
- OpenAPI 3.0 is produced by `@nestjs/swagger` from controller metadata. Request and response schemas are generated from the same Zod schemas (`z.toJSONSchema(…, { target: 'openapi-3.0' })`). `npm run openapi` writes `docs/api/openapi.json`, and a test fails if the committed file is out of date.

## Alternatives considered

- **class-validator and class-transformer.** The traditional NestJS approach, but it needs duplicated decorators for validation and documentation, its implicit transformations can surprise, and its maintenance cadence has been uneven.
- **nestjs-zod.** A community package that would add another dependency for roughly 40 lines of glue code that we own.

## Rationale

One schema drives validation, types and documentation, so they cannot drift apart.

## Consequences

- Controllers attach schemas explicitly with small decorators (`@ZodBody`, `@ApiZodBody`, `@ApiZodResponse`).

## Risks

- Zod's OpenAPI target may not express every construct. Schemas stay simple: objects, enums, numbers and strings.
