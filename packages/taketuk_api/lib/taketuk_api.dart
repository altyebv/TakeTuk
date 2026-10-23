/// Client for the TAKE-TUK backend API (`/v1`).
///
/// The models and operations in `src/generated/` are generated from `docs/api/openapi.json` by
/// `dart run tool/generate.dart`; never edit them by hand. The backend is the source of truth for
/// prices, assignments and state: client values are requests (MANIFESTO §3).
library;

export 'src/errors.dart';
export 'src/generated/api.dart';
export 'src/generated/models.dart';
export 'src/idempotency.dart';
export 'src/transport.dart';
