# Client applications

| Directory | Stack | State |
|---|---|---|
| `passenger_app/` | Flutter | Sign-in by SMS code and registration (phase 9). **Ride flow (phase 10):** pickup and destination on a map, minimum fare, proposed fare, request, searching with drivers' counteroffers, assigned driver, trip status, cash fare, cancellation and ride history |
| `driver_app/` | Flutter | Sign-in by SMS code and applicant registration (phase 9). **Phase 10:** onboarding (document photos uploaded to signed URLs, vehicle, submission, reviewer's note), going online with an approved vehicle, position reports, offers (accept, decline, propose a higher fare), the trip (arrive, start, complete, cancel with a reason), cash reporting and earnings |
| `admin_web/` | React + TypeScript | Planned (phase 11) |
| `merchant_web/` | React + TypeScript | Planned (marketplace phase) |

Both Flutter apps build on the shared packages in [`../packages`](../packages):

| Package | Contents |
|---|---|
| `taketuk_api` | API client **generated** from [`docs/api/openapi.json`](../docs/api/openapi.json), plus transport, errors and idempotency keys |
| `taketuk_auth` | Supabase Auth sign-in with one-time codes (SMS, or email in development builds) behind `AuthGateway`, `SessionController`, shared sign-in screens, build-configuration checks |
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
| `SIGN_IN_METHOD` | `phone` (default: a code by SMS) or `email` (a code by email). Email is a stopgap while SMS is unavailable (OPEN_DECISIONS IDN-6): **development builds only**, and the Supabase email templates must contain `{{ .Token }}` (OPERATIONS §4). Email accounts have no phone number, so the call buttons stay hidden |
| `SERVICE_AREA_CODE` | Driver app only: the area new drivers apply for (default `wad_madani`) |
| `MAP_TILE_URL` | Map tiles, an https template with `{z}/{x}/{y}`. Debug builds default to the public OpenStreetMap server, which suits development only; **release builds require a provider** (OPEN_DECISIONS MAP-6) |
| `MAP_ATTRIBUTION` | Shown on every map (default `© OpenStreetMap contributors`) |

Release builds require https URLs. Debug builds also accept plain http, for a local stack.

```bash
cd apps/passenger_app
flutter run --dart-define-from-file=config/local.json
```

With the local Supabase CLI stack (`supabase start`), the test numbers in `supabase/config.toml` (`0900000001` to `0900000003`) are configured with the fixed code `123456`, so no SMS provider should be needed. With `SIGN_IN_METHOD=email`, codes appear in the local mail viewer at `http://127.0.0.1:54324`. Neither is **verified yet**: the Supabase CLI stack has not been run.

With a hosted project and `SIGN_IN_METHOD=email`, the code arrives by email (8 digits on the current project). Supabase's built-in email service only delivers to members of the project's organization; others need custom SMTP.

**Test accounts** need no email at all:
1. In `backend/`, run `npm run cli -- sign-in-code --email passenger@example.com` (or `driver@example.com`). It prints a code.
2. In the app, enter the address and tap **I already have a code**. That button appears in development builds only.
3. Enter the printed code.

See OPERATIONS §2c.

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

- **Verified:** debug APKs of both apps build in CI (`mobile` workflow). Tests run here:
  - analysis and formatting clean;
  - 72 tests covering:
    - the generated client against recorded backend responses;
    - transport errors and unknown enum values;
    - phone normalisation and session state;
    - sign-in by SMS code and by email code, and registration, in both apps, in Arabic and English;
    - the passenger ride flow (quote, offer, retry-safe request, counteroffers, trip, cancellation, history);
    - the driver flow (document uploads, vehicle, submission, going online, offers, counteroffers, trip, cash reporting, earnings).
- **Known limits:**
  - Ride and offer updates arrive by polling (every 4 s), not push (OPEN_DECISIONS API-1).
  - Drivers report their position only while the app is open, so they must keep it open to receive offers (DRV-6).
- **Verified against the live Supabase project, without the apps:** the email-code exchange the apps make (publishable key only) and the backend's verification of the issued token (`npm run test:live -- supabase` in `backend/`).
- **Not verified:**
  - a run on a device;
  - sign-in from the apps against the live Supabase project;
  - SMS delivery to Sudanese numbers (OPEN_DECISIONS IDN-1);
  - iOS builds.
