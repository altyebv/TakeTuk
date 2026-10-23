# Client applications

| Directory | Stack | State |
|---|---|---|
| `passenger_app/` | Flutter | **Foundation (phase 9):** sign-in by SMS code, passenger registration, home placeholder. Ride screens follow in phase 10 |
| `driver_app/` | Flutter | **Foundation (phase 9):** sign-in by SMS code, driver applicant registration, review status. Onboarding, availability, offers and trips follow in phase 10 |
| `admin_web/` | React + TypeScript | Planned (phase 11) |
| `merchant_web/` | React + TypeScript | Planned (marketplace phase) |

Both Flutter apps build on the shared packages in [`../packages`](../packages):

| Package | Contents |
|---|---|
| `taketuk_api` | API client **generated** from [`docs/api/openapi.json`](../docs/api/openapi.json), plus transport, errors and idempotency keys |
| `taketuk_auth` | Supabase Auth phone sign-in behind `AuthGateway`, `SessionController`, shared sign-in screens, build-configuration checks |
| `taketuk_ui` | Theme, Arabic/RTL defaults, shared localized error messages, money formatting |

Architecture: [ADR-0006](../docs/architecture/decisions/0006-flutter-mobile.md) and [ADR-0018](../docs/architecture/decisions/0018-flutter-client-architecture.md). The apps call only the TAKE-TUK API for business operations, and Supabase only to sign in (ADR-0007).

## Setup

Flutter 3.47 (Dart 3.13). The repository root is a pub workspace, so resolve dependencies once there:

```bash
flutter pub get
```

## Configuration

Each app reads its configuration at build time from a JSON file passed with `--dart-define-from-file`. Copy `config/example.json` to `config/local.json` (git-ignored) and fill it in:

| Key | Meaning |
|---|---|
| `API_BASE_URL` | TAKE-TUK API, e.g. `http://10.0.2.2:3000` for a backend on the host from the Android emulator |
| `SUPABASE_URL` | Supabase project URL (`http://10.0.2.2:54321` for the local Supabase CLI stack) |
| `SUPABASE_PUBLISHABLE_KEY` | The **publishable** key only. The app refuses to start with a secret or `service_role` key |
| `SERVICE_AREA_CODE` | Driver app only: the area new drivers apply for (default `wad_madani`) |

Release builds require https URLs. Debug builds also accept plain http, for a local stack.

```bash
cd apps/passenger_app
flutter run --dart-define-from-file=config/local.json
```

With the local Supabase CLI stack (`supabase start`), the test numbers in `supabase/config.toml` (`0900000001` to `0900000003`) are configured with the fixed code `123456`, so no SMS provider should be needed. This is **not yet verified**: the Supabase CLI stack has not been run.

## Checks

These are what CI runs (`.github/workflows/mobile.yml`):

```bash
dart format --output=none --set-exit-if-changed packages apps
(cd packages/taketuk_api && dart analyze --fatal-infos && dart test)
for d in packages/taketuk_ui packages/taketuk_auth apps/passenger_app apps/driver_app; do
  (cd $d && flutter analyze --fatal-infos && flutter test)
done
```

## Regenerating code

- **API client**, after the backend contract changes:
  ```bash
  (cd backend && npm run openapi)
  (cd packages/taketuk_api && dart run tool/generate.dart)
  ```
- **Contract fixtures**, after a response shape changes: `cd backend && RECORD_CLIENT_FIXTURES=1 npm run test:integration`.
- **Localizations**, after editing an `.arb` file: run `flutter gen-l10n` in that package or app.

The generated files are committed. CI fails when any of them is out of date.

## Verification status

- **Verified (tests run here):**
  - analysis and formatting clean;
  - 47 tests covering:
    - the generated client against recorded backend responses;
    - transport errors;
    - unknown enum values;
    - phone normalisation;
    - session state;
    - the sign-in and registration flows of both apps, in Arabic and English.
- **Not verified:**
  - an Android build (no Android SDK in the build environment; CI builds debug APKs);
  - a run on a device;
  - sign-in against a live Supabase project;
  - SMS delivery to Sudanese numbers (OPEN_DECISIONS IDN-1);
  - iOS builds.
