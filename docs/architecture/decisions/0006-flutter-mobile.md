# ADR-0006: Flutter for passenger and driver apps

- Status: Accepted (implementation not started)
- Date: 2026-10-23

## Context

Passengers and drivers use Android devices, often low-end, plus some iOS. The directive mandates Flutter and Dart, with separate passenger and driver apps sharing common packages.

## Decision

- Two Flutter applications, `apps/passenger_app` and `apps/driver_app`. Their workflows, permissions (background location for drivers) and release cadences differ, so they are not merged into one universal UI.
- Shared Dart packages under `packages/`:
  - `taketuk_api`: an API client generated from or kept in sync with `docs/api/openapi.json`, including idempotency-key handling and problem-details parsing,
  - `taketuk_auth`: Supabase Auth integration and token refresh,
  - `taketuk_ui`: design primitives and RTL/Arabic support,
  - `taketuk_core`: domain-independent utilities.
- Apps call only the TAKE-TUK backend for business operations. They use Supabase directly only for authentication, and for uploads to pre-signed storage URLs issued by the backend.

## Alternatives considered

- **One app with role switching.** Simpler distribution, but it couples the driver's background-location permission prompts and workflows to passengers.
- **Native Android/iOS.** Double the effort.
- **React Native.** Contradicts the directive. Flutter also performs well on low-end Android.

## Rationale

Separate apps keep each workflow focused, and shared packages avoid duplicating the client foundation.

## Consequences

- The backend API is the contract. Breaking changes require a new API version (API_CONVENTIONS).

## Risks

- **Not started.** No Flutter SDK was available in the environment that produced the first backend increment, so no mobile code was written rather than code that could not be verified.
