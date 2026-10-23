import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

/// An approved driver's shift: availability, position reports, offers and the current trip.
///
/// Offers and the trip are polled (OPEN_DECISIONS API-1). Position reports run while online and
/// the app is in the foreground only: dispatch ignores positions older than
/// DRIVER_LOCATION_MAX_AGE_SECONDS, so a driver must keep the app open to receive offers.
final class WorkController extends ChangeNotifier {
  WorkController({
    required this.api,
    required this.location,
    required DriverProfile initialProfile,
    this.pollInterval = const Duration(seconds: 4),
    this.locationInterval = const Duration(seconds: 15),
  }) : _profile = initialProfile;

  final TaketukApi api;
  final DeviceLocation location;
  final Duration pollInterval;
  final Duration locationInterval;

  DriverProfile _profile;
  List<Vehicle> _vehicles = const [];
  List<DriverOffer> _offers = const [];
  DriverRide? _ride;
  bool _locationAvailable = true;
  bool _busy = false;
  bool _refreshing = false;
  bool _refreshAgain = false;
  bool _disposed = false;
  Object? _loadError;
  Object? _actionError;
  Timer? _poll;
  Timer? _positions;

  DriverProfile get profile => _profile;
  bool get online => _profile.availability == DriverProfileAvailability.online;
  List<Vehicle> get approvedVehicles =>
      _vehicles.where((v) => v.status == VehicleStatus.approved).toList();
  List<DriverOffer> get offers => _offers;

  /// The active trip; also a just-completed trip until its cash is reported, and a cancelled one
  /// until the driver dismisses it.
  DriverRide? get ride => _ride;
  bool get locationAvailable => _locationAvailable;
  bool get busy => _busy;
  Object? get loadError => _loadError;
  Object? get actionError => _actionError;

  Future<void> start() async {
    try {
      _vehicles = (await api.drivers.listVehicles()).items;
    } on Object catch (error) {
      _loadError = error;
    }
    await refresh();
    _poll = Timer.periodic(pollInterval, (_) => unawaited(refresh()));
    if (online) _startPositions();
  }

  /// Reloads the trip and offers. A call during a refresh runs again right after it, so a change
  /// such as going online is always reflected.
  Future<void> refresh() async {
    if (_refreshing) {
      _refreshAgain = true;
      return;
    }
    _refreshing = true;
    try {
      final previous = _ride;
      var ride = (await api.driverRides.current()).ride;
      if (ride == null && previous != null && _isActive(previous.status)) {
        // The trip ended elsewhere (for example the passenger cancelled): show how.
        ride = await api.driverRides.get(previous.id);
      }
      if (ride == null && previous != null && _needsAttention(previous)) {
        ride = previous;
      }
      _ride = ride != null && (_isActive(ride.status) || _needsAttention(ride))
          ? ride
          : null;
      _offers = online && _ride == null
          ? (await api.driverOffers.list()).items
          : const [];
      _loadError = null;
    } on Object catch (error) {
      _loadError = error;
    } finally {
      _refreshing = false;
      _notify();
    }
    if (_refreshAgain) {
      _refreshAgain = false;
      await refresh();
    }
  }

  Future<bool> goOnline(String vehicleId) => _act(() async {
    _profile = await api.drivers.setAvailability(
      DriversSetAvailabilityRequest(
        availability: DriversSetAvailabilityRequestAvailability.online,
        vehicleId: vehicleId,
      ),
    );
    _startPositions();
    await refresh();
  });

  Future<bool> goOffline() => _act(() async {
    _profile = await api.drivers.setAvailability(
      const DriversSetAvailabilityRequest(
        availability: DriversSetAvailabilityRequestAvailability.offline,
      ),
    );
    _positions?.cancel();
    _offers = const [];
  });

  Future<bool> accept(String offerId) => _act(() async {
    _ride = await api.driverOffers.accept(offerId);
    _offers = const [];
  });

  Future<bool> decline(String offerId) => _act(() async {
    await api.driverOffers.decline(offerId);
    _offers = _offers.where((o) => o.offerId != offerId).toList();
  });

  Future<bool> counteroffer(String offerId, int amountMinor, String currency) =>
      _act(() async {
        final updated = await api.driverOffers.counteroffer(
          offerId,
          DriverOffersCounterofferRequest(
            amount: MoneyInput(amountMinor: amountMinor, currency: currency),
          ),
        );
        _offers = [
          for (final offer in _offers)
            offer.offerId == offerId ? updated : offer,
        ];
      });

  Future<bool> arrive() =>
      _act(() async => _ride = await api.driverRides.arrive(_ride!.id));

  Future<bool> startTrip() =>
      _act(() async => _ride = await api.driverRides.start(_ride!.id));

  Future<bool> complete() =>
      _act(() async => _ride = await api.driverRides.complete(_ride!.id));

  Future<bool> cancel(String reason) => _act(
    () async => _ride = await api.driverRides.cancel(
      _ride!.id,
      DriverRidesCancelRequest(reason: reason),
    ),
  );

  /// Reports the cash for the completed trip; the trip then leaves the screen.
  Future<bool> reportCash({required int? collectedMinor}) => _act(() async {
    final ride = _ride!;
    final currency = (ride.agreedFare ?? ride.minimumFare).currency;
    await api.finance.reportCashCollection(
      ride.id,
      collectedMinor == null
          ? const FinanceReportCashCollectionRequestNotCollected()
          : FinanceReportCashCollectionRequestCollected(
              amountCollected: MoneyInput(
                amountMinor: collectedMinor,
                currency: currency,
              ),
            ),
    );
    _ride = null;
  });

  /// Clears a cancelled trip from the screen.
  void dismissRide() {
    _ride = null;
    _notify();
    unawaited(refresh());
  }

  Future<bool> _act(Future<void> Function() action) async {
    _busy = true;
    _actionError = null;
    _notify();
    try {
      await action();
      return true;
    } on Object catch (error) {
      _actionError = error;
      unawaited(refresh());
      return false;
    } finally {
      _busy = false;
      _notify();
    }
  }

  void _startPositions() {
    _positions?.cancel();
    unawaited(_reportPosition());
    _positions = Timer.periodic(
      locationInterval,
      (_) => unawaited(_reportPosition()),
    );
  }

  Future<void> _reportPosition() async {
    final here = await location.current();
    _locationAvailable = here != null;
    if (here != null) {
      try {
        await api.drivers.updateLocation(
          DriversUpdateLocationRequest(
            lat: here.latitude,
            lng: here.longitude,
            recordedAt: DateTime.now().toUtc().toIso8601String(),
          ),
        );
      } on Object {
        // The next report retries; dispatch tolerates a missed one.
      }
    }
    _notify();
  }

  static bool _isActive(DriverRideStatus status) => switch (status) {
    DriverRideStatus.driverAssigned ||
    DriverRideStatus.driverArrived ||
    DriverRideStatus.inProgress => true,
    _ => false,
  };

  static bool _needsAttention(DriverRide ride) =>
      ride.status == DriverRideStatus.cancelled ||
      (ride.status == DriverRideStatus.completed &&
          ride.payment?.status == RidePaymentStatus.awaitingCollection);

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _poll?.cancel();
    _positions?.cancel();
    super.dispose();
  }
}
