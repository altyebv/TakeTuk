import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:taketuk_api/taketuk_api.dart';

import 'auth_gateway.dart';

enum SessionStatus {
  /// Restoring a persisted session.
  starting,
  signedOut,

  /// Signed in; loading the TAKE-TUK account (`GET /v1/me`).
  loadingAccount,

  /// Signed in with a loaded account. Check [SessionController.me] for registration and roles.
  ready,

  /// Signed in, but the account could not be loaded (see [SessionController.error]).
  accountError,
}

/// The app-wide session: who is signed in, and their TAKE-TUK account. Navigation listens to it.
final class SessionController extends ChangeNotifier {
  SessionController({required this.auth, required this.api});

  final AuthGateway auth;
  final TaketukApi api;

  SessionStatus _status = SessionStatus.starting;
  Me? _me;
  Object? _error;
  StreamSubscription<AuthUser?>? _changes;
  String? _userId;

  SessionStatus get status => _status;

  /// The account from the last successful `GET /v1/me`.
  Me? get me => _me;
  Object? get error => _error;

  Future<void> start() async {
    _changes = auth.userChanges.listen(_onUser);
    await _onUser(auth.currentUser);
  }

  Future<void> _onUser(AuthUser? user) async {
    if (user?.id == _userId && _status != SessionStatus.starting) return;
    _userId = user?.id;
    if (user == null) {
      _set(SessionStatus.signedOut, me: null, error: null);
    } else {
      await reloadAccount();
    }
  }

  /// Loads the account again, for example after registration or an error.
  Future<void> reloadAccount() async {
    _set(SessionStatus.loadingAccount, me: _me, error: null);
    try {
      final me = await api.identity.getMe();
      _set(SessionStatus.ready, me: me, error: null);
    } on ApiProblem catch (problem) {
      if (problem.code == ProblemCodes.authenticationRequired) {
        await signOut();
      } else {
        _set(SessionStatus.accountError, me: null, error: problem);
      }
    } on Object catch (error) {
      _set(SessionStatus.accountError, me: null, error: error);
    }
  }

  /// Uses an account returned by a registration call without another round trip.
  void accountUpdated(Me me) => _set(SessionStatus.ready, me: me, error: null);

  Future<void> signOut() async {
    await auth.signOut();
    _userId = null;
    _set(SessionStatus.signedOut, me: null, error: null);
  }

  void _set(SessionStatus status, {required Me? me, required Object? error}) {
    _status = status;
    _me = me;
    _error = error;
    notifyListeners();
  }

  @override
  void dispose() {
    unawaited(_changes?.cancel());
    super.dispose();
  }
}
