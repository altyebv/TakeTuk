import 'package:flutter/foundation.dart';

/// The signed-in user as authentication knows it. Roles and registration come from the API.
@immutable
final class AuthUser {
  const AuthUser({required this.id, this.phoneE164, this.email});

  /// The Supabase Auth user id, which is also the TAKE-TUK user id.
  final String id;
  final String? phoneE164;
  final String? email;
}

/// Where a one-time sign-in code is sent.
@immutable
sealed class SignInAddress {
  const SignInAddress();

  /// The address as entered and normalized: an E.164 number or a lower-case email address.
  String get value;

  /// For a navigation URL; [SignInAddress.fromQuery] reads it back.
  Map<String, String> toQuery();

  /// The address from [toQuery]'s parameters, or null if they hold none.
  static SignInAddress? fromQuery(Map<String, String> query) =>
      switch ((query['phone'], query['email'])) {
        (final phone?, _) when phone.isNotEmpty => PhoneAddress(phone),
        (_, final email?) when email.isNotEmpty => EmailAddress(email),
        _ => null,
      };

  @override
  bool operator ==(Object other) =>
      other is SignInAddress &&
      other.runtimeType == runtimeType &&
      other.value == value;

  @override
  int get hashCode => Object.hash(runtimeType, value);
}

/// A mobile number in E.164 form; codes go by SMS (ADR-0004).
final class PhoneAddress extends SignInAddress {
  const PhoneAddress(this.phoneE164);

  final String phoneE164;

  @override
  String get value => phoneE164;

  @override
  Map<String, String> toQuery() => {'phone': phoneE164};

  @override
  String toString() => 'PhoneAddress($phoneE164)';
}

/// An email address; codes go by email. A development stopgap while SMS delivery is unavailable
/// (OPEN_DECISIONS IDN-6).
final class EmailAddress extends SignInAddress {
  const EmailAddress(this.email);

  final String email;

  @override
  String get value => email;

  @override
  Map<String, String> toQuery() => {'email': email};

  @override
  String toString() => 'EmailAddress($email)';
}

enum AuthFailureKind {
  /// The address was refused (format, or a number the SMS provider cannot reach).
  invalidAddress,

  /// The auth service will not send codes to this address (for example Supabase's built-in
  /// email service, which only delivers to the project team).
  addressNotAllowed,

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

/// Sign-in with one-time codes (ADR-0004). The apps use Supabase only through this.
abstract interface class AuthGateway {
  AuthUser? get currentUser;

  /// Emits on sign-in, sign-out and session loss (for example a revoked refresh token).
  Stream<AuthUser?> get userChanges;

  /// Sends a one-time code to [address]. Throws [AuthFailure].
  Future<void> requestCode(SignInAddress address);

  /// Signs in with the code. Throws [AuthFailure].
  Future<void> verifyCode({
    required SignInAddress address,
    required String code,
  });

  /// A valid access token for the API, refreshed when needed, or null when signed out.
  Future<String?> accessToken();

  Future<void> signOut();
}
