import 'dart:async';

import 'package:supabase_flutter/supabase_flutter.dart' hide AuthUser;

import 'auth_gateway.dart';

/// [AuthGateway] over Supabase Auth phone OTP. Only the publishable key is used: it is designed
/// to be public and has no access to TAKE-TUK data (docs/security/SECURITY.md §4).
///
/// Not verified against a live Supabase project yet (IMPLEMENTATION_REPORT §4).
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
  Future<void> requestCode(String phoneE164) async {
    try {
      await _auth.signInWithOtp(phone: phoneE164, shouldCreateUser: true);
    } on AuthException catch (error) {
      throw authFailureFrom(error);
    }
  }

  @override
  Future<void> verifyCode({
    required String phoneE164,
    required String code,
  }) async {
    try {
      await _auth.verifyOTP(phone: phoneE164, token: code, type: OtpType.sms);
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
        );
}

/// Maps a Supabase Auth error to what the sign-in screens can act on.
AuthFailure authFailureFrom(AuthException error) {
  final kind = switch (error) {
    AuthRetryableFetchException() => AuthFailureKind.network,
    AuthException(code: 'otp_expired' || 'invalid_credentials') =>
      AuthFailureKind.invalidCode,
    AuthException(
      code: 'over_sms_send_rate_limit' || 'over_request_rate_limit',
    ) ||
    AuthException(statusCode: '429') => AuthFailureKind.rateLimited,
    AuthException(code: 'validation_failed' || 'phone_not_confirmed') ||
    AuthException(statusCode: '422') => AuthFailureKind.invalidPhone,
    _ => AuthFailureKind.unavailable,
  };
  return AuthFailure(kind, error);
}
