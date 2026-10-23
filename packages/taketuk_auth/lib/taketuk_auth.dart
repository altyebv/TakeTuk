/// TAKE-TUK sign-in: Supabase Auth one-time codes (SMS, or email in development builds) behind
/// [AuthGateway], the app session, and the shared sign-in screens (ADR-0004, ADR-0006).
library;

export 'src/auth_gateway.dart';
export 'src/client_config.dart';
export 'src/email.dart';
export 'src/l10n/taketuk_auth_localizations.dart';
export 'src/phone.dart';
export 'src/session_controller.dart';
export 'src/session_screens.dart';
export 'src/sign_in_screens.dart';
export 'src/supabase_auth_gateway.dart'
    show SupabaseAuthGateway, authFailureFrom;
