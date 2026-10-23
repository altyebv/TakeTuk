import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:taketuk_api/taketuk_api.dart';

import 'ride_text.dart';

/// Follows one ride by polling `GET /v1/rides/{id}` until it ends (OPEN_DECISIONS API-1:
/// polling plus push), and runs the passenger's actions on it. The server is the source of
/// truth: every action's response replaces the local copy.
final class RideController extends ChangeNotifier {
  RideController({
    required this.api,
    required this.rideId,
    this.pollInterval = const Duration(seconds: 4),
  });

  final TaketukApi api;
  final String rideId;
  final Duration pollInterval;

  PassengerRide? _ride;
  Object? _loadError;
  Object? _actionError;
  bool _busy = false;
  bool _loading = false;
  bool _disposed = false;
  Timer? _timer;

  PassengerRide? get ride => _ride;

  /// The last refresh failed (the previous state is still shown).
  Object? get loadError => _loadError;

  /// The last action failed, for example a counteroffer that expired meanwhile.
  Object? get actionError => _actionError;
  bool get busy => _busy;

  void start() {
    unawaited(refresh());
    _timer = Timer.periodic(pollInterval, (_) => unawaited(refresh()));
  }

  Future<void> refresh() async {
    if (_loading) return;
    _loading = true;
    try {
      _apply(await api.rides.get(rideId));
      _loadError = null;
    } on Object catch (error) {
      _loadError = error;
    } finally {
      _loading = false;
    }
    _notify();
  }

  Future<void> acceptCounteroffer(String offerId) =>
      _act(() => api.rides.acceptCounteroffer(rideId, offerId));

  Future<void> rejectCounteroffer(String offerId) =>
      _act(() => api.rides.rejectCounteroffer(rideId, offerId));

  Future<void> cancel(String reason) => _act(
    () => api.rides.cancel(
      rideId,
      // The API requires at least 3 characters when a reason is given.
      RidesCancelRequest(
        reason: reason.trim().length >= 3 ? reason.trim() : null,
      ),
    ),
  );

  Future<void> _act(Future<PassengerRide> Function() action) async {
    _busy = true;
    _actionError = null;
    _notify();
    try {
      _apply(await action());
    } on Object catch (error) {
      _actionError = error;
      unawaited(refresh());
    } finally {
      _busy = false;
      _notify();
    }
  }

  void _apply(PassengerRide ride) {
    _ride = ride;
    if (!isOpenRide(ride.status)) _timer?.cancel();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    super.dispose();
  }
}
