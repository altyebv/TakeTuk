# ADR-0004: Supabase Auth for identity

- Status: Accepted
- Date: 2026-10-23

## Context

Passengers and drivers need to sign up and sign in from mobile apps, and staff from web apps. The directive mandates Supabase Auth. The backend must verify tokens securely and must not trust identity or roles from request bodies.

## Decision

- Clients authenticate directly with Supabase Auth (phone OTP expected for passengers and drivers; IDN-1) and send the access token to the backend as `Authorization: Bearer <jwt>`.
- The backend verifies every token with `jose`:
  - **Preferred: asymmetric signing keys.** Keys come from the project's JWKS endpoint (`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`), cached by `jose`'s remote key set. Algorithms are restricted to `ES256` and `RS256`.
  - **Legacy: shared secret** (`HS256` only), for projects that have not migrated to signing keys. Only one mode is active at a time, chosen by configuration, so algorithm confusion is impossible.
  - Required claims: valid signature, `iss` equal to `<SUPABASE_URL>/auth/v1`, `aud` equal to `authenticated`, unexpired `exp` (60 s clock tolerance), `sub` (UUID), and `role = authenticated`. Tokens with `is_anonymous = true` are rejected.
- **Authorization data lives in TAKE-TUK's database** (`user_roles`), not in JWT claims. The token proves identity only. Roles map to permissions in code.
- A TAKE-TUK user record is created only through explicit registration endpoints.

## Alternatives considered

- **Verifying tokens by calling Supabase `GET /auth/v1/user` on each request.** Simple, but it adds latency and a hard runtime dependency on every request.
- **Roles in `app_metadata` claims.** Would need the Supabase admin API to change roles, and a role change would wait until the token refreshes. It also splits the authority between two systems.
- **Custom auth.** Prohibited by the directive and unnecessary.

## Rationale

Local verification against JWKS is fast and standard, and it supports key rotation. Keeping roles in our database makes them authoritative, auditable and immediately effective.

## Consequences

- A revoked Supabase session remains valid at the backend until its token expires (Supabase default: 1 hour). TAKE-TUK can still block a user immediately by setting `users.status = disabled`.
- Tests sign tokens with a locally generated ES256 key and supply its JWKS directly. This is the same code path, with a local key source.

## Risks

- Misconfigured issuer or audience: mitigated by startup configuration validation and tests for wrong-issuer and wrong-audience tokens.
- Verification against a live Supabase project has **not** been performed in this environment.
