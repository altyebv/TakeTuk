/// Test doubles for apps and packages that depend on taketuk_auth.
library;

import 'dart:async';

import 'src/auth_gateway.dart';

/// An in-memory [AuthGateway]. The accepted code is [validCode].
final class FakeAuthGateway implements AuthGateway {
  FakeAuthGateway({
    AuthUser? signedIn,
    this.validCode = '123456',
    this.userId = 'user-1',
  }) : _user = signedIn;

  final String validCode;
  final String userId;
  final List<SignInAddress> codesRequested = [];
  AuthFailure? nextFailure;
  AuthUser? _user;
  final StreamController<AuthUser?> _changes = StreamController.broadcast();

  @override
  AuthUser? get currentUser => _user;

  @override
  Stream<AuthUser?> get userChanges => _changes.stream;

  @override
  Future<void> requestCode(SignInAddress address) async {
    _throwIfFailing();
    codesRequested.add(address);
  }

  @override
  Future<void> verifyCode({
    required SignInAddress address,
    required String code,
  }) async {
    _throwIfFailing();
    if (code != validCode) throw const AuthFailure(AuthFailureKind.invalidCode);
    _user = switch (address) {
      PhoneAddress(:final phoneE164) => AuthUser(
        id: userId,
        phoneE164: phoneE164,
      ),
      EmailAddress(:final email) => AuthUser(id: userId, email: email),
    };
    _changes.add(_user);
  }

  @override
  Future<String?> accessToken() async =>
      _user == null ? null : 'token-for-${_user!.id}';

  @override
  Future<void> signOut() async {
    _user = null;
    _changes.add(null);
  }

  void _throwIfFailing() {
    if (nextFailure case final failure?) {
      nextFailure = null;
      throw failure;
    }
  }
}
