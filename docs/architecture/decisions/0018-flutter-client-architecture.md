# ADR-0018: Flutter client foundation: workspace, generated API client, session and navigation

- Status: Accepted
- Date: 2026-10-23

## Context

ADR-0006 chose two Flutter apps with shared packages. Before any ride screens are built, the foundation they rest on has to be fixed: how the packages are organised, how the apps talk to the API, how sign-in and session state work, and how the apps are configured. These choices are expensive to change once many screens depend on them.

## Decision

- **One pub workspace at the repository root** (Dart pub workspaces) with the members `packages/taketuk_api`, `packages/taketuk_auth`, `packages/taketuk_ui`, `apps/passenger_app` and `apps/driver_app`. There is one resolution and one lockfile, and no extra tooling such as melos.
- **`taketuk_api` is generated from `docs/api/openapi.json`** by a small generator in the package (`tool/generator.dart`):
  - It emits immutable models with checked `fromJson`/`toJson`, an `$unknown` member on every enum (the API may add enum values, API_CONVENTIONS §1), sealed classes for discriminated `oneOf` bodies, one API class per area, and the `ProblemCodes` registry.
  - It supports exactly the schema constructs the backend emits and stops on anything else.
  - Back-office (`admin`) operations are left out of the mobile client.
  - The hand-written transport adds the bearer token, timeouts and JSON. It maps failures to three cases:
    - `ApiProblem`: an RFC 9457 problem; switch on `code`.
    - `ApiUnavailable`: the network, a timeout or a bare 5xx; safe to retry with the same idempotency key.
    - `ApiContractViolation`: a response outside the contract.
- **Contract tests on both sides.** A backend integration test records real responses as fixtures (`packages/taketuk_api/test/fixtures`) and fails when a response's shape drifts from them; the Dart tests decode the same fixtures with the generated client. CI checks that the generated client matches the committed OpenAPI document.
- **`taketuk_auth`** wraps Supabase Auth phone OTP behind an `AuthGateway` interface. It also provides:
  - `SessionController`, a `ChangeNotifier` holding who is signed in and their `GET /v1/me` account;
  - the shared sign-in screens, with Sudanese mobile-number normalisation including Arabic-Indic digits;
  - `ClientConfig`, which validates the build configuration.
- **State and navigation:** `ChangeNotifier` controllers passed through constructors, and `go_router` with a pure redirect function per app driven by the session. No state-management or service-locator library.
- **Localisation:** Arabic is the default and English the alternative, both through `gen-l10n`. Each package owns its strings; generated files are committed and CI checks they are current. Server problem titles are never shown to users: messages come from the app, keyed on `code`.
- **Configuration** comes from `--dart-define-from-file` and contains only public values: the API URL, the Supabase URL and the publishable key. The app refuses to start when:
  - a value is missing;
  - a URL is not https in a release build;
  - the "publishable" key is actually a Supabase secret or `service_role` key.

## Alternatives considered

- **openapi-generator (`dart`/`dart-dio`).** Mature, but its output is large and needs `build_runner`/`built_value`. It names inline schemas generically and does not model "tolerate unknown enum values" the way our conventions require.
- **A hand-written client.** It would drift from the contract silently.
- **Riverpod or Bloc.** Both are reasonable. They add a framework before there is enough state to justify it, and can be adopted later screen by screen.
- **Separate repositories for the apps.** Rejected in favour of a monorepo, so contract changes, regenerated clients and app changes land in one reviewed change.

## Consequences

- A backend change to the contract needs `npm run openapi` and then `dart run tool/generate.dart`. CI fails if either is forgotten.
- The mobile CI workflow builds debug APKs. iOS projects exist but are not built in CI (no macOS runner).
- Sessions are persisted by `supabase_flutter` in the app's private storage, not in an encrypted keystore (OPEN_DECISIONS IDN-5).

## Risks

- **The generator is ours to maintain.** Mitigation: it fails loudly on unsupported constructs, and both directions of the contract are tested.
- **Not verified against a live Supabase project or on devices.** The Supabase gateway is a thin adapter, but phone OTP delivery to Sudanese numbers (IDN-1) and token refresh have only been exercised with fakes.
