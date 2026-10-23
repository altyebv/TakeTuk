import 'dart:async';

import 'package:supabase_flutter/supabase_flutter.dart' hide AuthUser;

import 'auth_gateway.dart';

/// [AuthGateway] over Supabase Auth one-time codes, by SMS or email. Only the publishable key is
/// used: it is designed to be public and has no access to TAKE-TUK data
/// (docs/security/SECURITY.md §4).
///
/// Email codes need the Supabase email templates to include `{{ .Token }}` (OPERATIONS §4).
///
/// The email-code exchange it makes was verified against the live project over HTTP
/// (IMPLEMENTATION_REPORT §11); this class itself has not run against it yet (no device run).
final class SupabaseAuthGateway implements AuthGateway {
  SupabaseAuthGateway(this._auth);

  /// Initializes Supabase once per process. The session is persisted by supabase_flutter.
  static Future<SupabaseAuthGateway> initialize({
    required String url,
    required String publishableKey,
  }) async {
    final supabase = await Supabase.initialize(
      url: url,
      publishableKey: publishableKey,
    );
    return SupabaseAuthGateway(supabase.client.auth);
  }

  final GoTrueClient _auth;

  @override
  AuthUser? get currentUser => _toUser(_auth.currentUser);

  @override
  Stream<AuthUser?> get userChanges => _auth.onAuthStateChange
      .map((state) => _toUser(state.session?.user))
      .distinct((a, b) => a?.id == b?.id);

  @override
  Future<void> requestCode(SignInAddress address) async {
    try {
      await switch (address) {
        PhoneAddress(:final phoneE164) => _auth.signInWithOtp(
          phone: phoneE164,
          shouldCreateUser: true,
        ),
        EmailAddress(:final email) => _auth.signInWithOtp(
          email: email,
          shouldCreateUser: true,
        ),
      };
    } on AuthException catch (error) {
      throw authFailureFrom(error);
    }
  }

  @override
  Future<void> verifyCode({
    required SignInAddress address,
    required String code,
  }) async {
    try {
      await switch (address) {
        PhoneAddress(:final phoneE164) => _auth.verifyOTP(
          phone: phoneE164,
          token: code,
          type: OtpType.sms,
        ),
        // `email` covers both a new user's sign-up code and a returning user's sign-in code.
        EmailAddress(:final email) => _auth.verifyOTP(
          email: email,
          token: code,
          type: OtpType.email,
        ),
      };
    } on AuthException catch (error) {
      throw authFailureFrom(error);
    }
  }

  @override
  Future<String?> accessToken() async {
    final session = _auth.currentSession;
    if (session == null) return null;
    if (session.isExpired) {
      try {
        await _auth.refreshSession();
      } on AuthException {
        // A refresh failure signs the user out (supabase_flutter emits the change); the API
        // call then fails with AUTHENTICATION_REQUIRED and the app returns to sign-in.
        return null;
      }
    }
    return _auth.currentSession?.accessToken;
  }

  @override
  Future<void> signOut() => _auth.signOut();

  static AuthUser? _toUser(User? user) => user == null
      ? null
      : AuthUser(
          id: user.id,
          // Supabase stores phone numbers without the leading '+'.
          phoneE164: switch (user.phone) {
            final phone? when phone.isNotEmpty =>
              phone.startsWith('+') ? phone : '+$phone',
            _ => null,
          },
          email: switch (user.email) {
            final email? when email.isNotEmpty => email,
            _ => null,
          },
        );
}

/// Maps a Supabase Auth error to what the sign-in screens can act on.
AuthFailure authFailureFrom(AuthException error) {
  final kind = switch (error) {
    AuthRetryableFetchException() => AuthFailureKind.network,
    AuthException(code: 'otp_expired' || 'invalid_credentials') =>
      AuthFailureKind.invalidCode,
    AuthException(
      code: 'over_sms_send_rate_limit' ||
          'over_email_send_rate_limit' ||
          'over_request_rate_limit',
    ) ||
    AuthException(statusCode: '429') => AuthFailureKind.rateLimited,
    AuthException(code: 'email_address_not_authorized') =>
      AuthFailureKind.addressNotAllowed,
    AuthException(
      code: 'validation_failed' ||
          'phone_not_confirmed' ||
          'email_address_invalid',
    ) ||
    AuthException(statusCode: '422') => AuthFailureKind.invalidAddress,
    _ => AuthFailureKind.unavailable,
  };
  return AuthFailure(kind, error);
}
