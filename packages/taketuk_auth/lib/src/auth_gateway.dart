import 'package:flutter/foundation.dart';

/// The signed-in user as authentication knows it. Roles and registration come from the API.
@immutable
final class AuthUser {
  const AuthUser({required this.id, this.phoneE164});

  /// The Supabase Auth user id, which is also the TAKE-TUK user id.
  final String id;
  final String? phoneE164;
}

enum AuthFailureKind {
  /// The phone number was refused (format, or a number the SMS provider cannot reach).
  invalidPhone,

  /// The code is wrong or expired.
  invalidCode,

  /// Too many codes requested or attempts made.
  rateLimited,

  /// The auth service could not be reached.
  network,

  /// The auth service failed or is misconfigured (for example SMS delivery is down).
  unavailable,
}

final class AuthFailure implements Exception {
  const AuthFailure(this.kind, [this.cause]);

  final AuthFailureKind kind;
  final Object? cause;

  @override
  String toString() => 'AuthFailure($kind)';
}

/// Phone-number sign-in with one-time codes (ADR-0004). The apps use Supabase only through this.
abstract interface class AuthGateway {
  AuthUser? get currentUser;

  /// Emits on sign-in, sign-out and session loss (for example a revoked refresh token).
  Stream<AuthUser?> get userChanges;

  /// Sends a one-time code by SMS. Throws [AuthFailure].
  Future<void> requestCode(String phoneE164);

  /// Signs in with the code. Throws [AuthFailure].
  Future<void> verifyCode({required String phoneE164, required String code});

  /// A valid access token for the API, refreshed when needed, or null when signed out.
  Future<String?> accessToken();

  Future<void> signOut();
}
