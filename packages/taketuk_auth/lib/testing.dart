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
  final List<String> codesRequested = [];
  AuthFailure? nextFailure;
  AuthUser? _user;
  final StreamController<AuthUser?> _changes = StreamController.broadcast();

  @override
  AuthUser? get currentUser => _user;

  @override
  Stream<AuthUser?> get userChanges => _changes.stream;

  @override
  Future<void> requestCode(String phoneE164) async {
    _throwIfFailing();
    codesRequested.add(phoneE164);
  }

  @override
  Future<void> verifyCode({
    required String phoneE164,
    required String code,
  }) async {
    _throwIfFailing();
    if (code != validCode) throw const AuthFailure(AuthFailureKind.invalidCode);
    _user = AuthUser(id: userId, phoneE164: phoneE164);
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
