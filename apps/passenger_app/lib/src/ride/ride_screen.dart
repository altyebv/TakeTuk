import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_ui/taketuk_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/passenger_localizations.dart';
import 'ride_controller.dart';
import 'ride_text.dart';

/// One ride from request to arrival: searching and counteroffers, the assigned driver, the trip,
/// and the cash fare due at the end.
class RideScreen extends StatefulWidget {
  const RideScreen({
    required this.api,
    required this.rideId,
    required this.mapSettings,
    required this.onNewRide,
    this.pollInterval = const Duration(seconds: 4),
    super.key,
  });

  final TaketukApi api;
  final String rideId;
  final MapSettings mapSettings;
  final VoidCallback onNewRide;
  final Duration pollInterval;

  @override
  State<RideScreen> createState() => _RideScreenState();
}

class _RideScreenState extends State<RideScreen> {
  late final RideController _controller = RideController(
    api: widget.api,
    rideId: widget.rideId,
    pollInterval: widget.pollInterval,
  )..start();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _confirmCancel() async {
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => const _CancelDialog(),
    );
    if (reason != null) await _controller.cancel(reason);
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _controller,
    builder: (context, _) {
      final l10n = PassengerLocalizations.of(context);
      final ride = _controller.ride;
      return Scaffold(
        appBar: AppBar(title: Text(l10n.appName)),
        body: ride == null
            ? Center(
                child: _controller.loadError == null
                    ? const CircularProgressIndicator()
                    : Padding(
                        padding: const EdgeInsets.all(24),
                        child: ErrorMessage(_controller.loadError!),
                      ),
              )
            : Column(
                children: [
                  SizedBox(height: 220, child: _routeMap(ride)),
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.all(16),
                      children: [
                        ..._details(l10n, ride),
                        if (_controller.actionError case final error?)
                          _errorText(rideErrorMessage(context, error)),
                        if (canCancelRide(ride.status)) ...[
                          const SizedBox(height: 16),
                          OutlinedButton(
                            onPressed: _controller.busy ? null : _confirmCancel,
                            child: Text(l10n.cancelRide),
                          ),
                        ],
                        if (!isOpenRide(ride.status)) ...[
                          const SizedBox(height: 16),
                          FilledButton(
                            onPressed: widget.onNewRide,
                            child: Text(l10n.newRide),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
      );
    },
  );

  Widget _routeMap(PassengerRide ride) {
    final pickup = LatLng(ride.pickup.lat, ride.pickup.lng);
    final destination = LatLng(ride.destination.lat, ride.destination.lng);
    final l10n = PassengerLocalizations.of(context);
    return TaketukMap(
      settings: widget.mapSettings,
      initialCenter: LatLng(
        (pickup.latitude + destination.latitude) / 2,
        (pickup.longitude + destination.longitude) / 2,
      ),
      markers: [
        tripMarker(pickup, color: Colors.green.shade700, label: l10n.setPickup),
        tripMarker(
          destination,
          color: Theme.of(context).colorScheme.error,
          label: l10n.setDestination,
        ),
      ],
    );
  }

  List<Widget> _details(PassengerLocalizations l10n, PassengerRide ride) {
    final title = Theme.of(context).textTheme.headlineSmall;
    final driver = ride.driver;
    return switch (ride.status) {
      PassengerRideStatus.searching => [
        Text(l10n.searchingTitle, style: title),
        const SizedBox(height: 8),
        const LinearProgressIndicator(),
        const SizedBox(height: 8),
        Text(l10n.driversNotified(ride.negotiation.driversNotified)),
        Text(l10n.yourOffer(formatMoney(context, ride.proposedFare))),
        ..._counteroffers(l10n, ride),
      ],
      PassengerRideStatus.driverAssigned ||
      PassengerRideStatus.driverArrived ||
      PassengerRideStatus.inProgress => [
        Text(switch (ride.status) {
          PassengerRideStatus.driverAssigned => l10n.statusAssigned(
            driver?.displayName ?? '',
          ),
          PassengerRideStatus.driverArrived => l10n.statusArrived,
          _ => l10n.statusInProgress,
        }, style: title),
        const SizedBox(height: 8),
        if (driver != null) _driverCard(l10n, driver),
        if (ride.agreedFare case final fare?)
          Text(l10n.agreedFare(formatMoney(context, fare))),
      ],
      PassengerRideStatus.completed => [
        Text(l10n.statusCompleted, style: title),
        if (ride.agreedFare case final fare?)
          Text(
            l10n.payCash(formatMoney(context, fare)),
            style: Theme.of(context).textTheme.titleLarge,
          ),
      ],
      PassengerRideStatus.cancelled => [
        Text(l10n.statusCancelled, style: title),
      ],
      PassengerRideStatus.expired => [Text(l10n.statusExpired, style: title)],
      PassengerRideStatus.$unknown => [Text(l10n.statusUnknown)],
    };
  }

  List<Widget> _counteroffers(PassengerLocalizations l10n, PassengerRide ride) {
    // `countered` is an open counteroffer waiting for the passenger.
    final open = ride.negotiation.counteroffers
        .where((offer) => offer.status == CounterofferStatus.countered)
        .toList();
    if (open.isEmpty) return const [];
    return [
      const SizedBox(height: 16),
      Text(
        l10n.counteroffersTitle,
        style: Theme.of(context).textTheme.titleMedium,
      ),
      for (final offer in open)
        Card(
          key: Key('counteroffer-${offer.offerId}'),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  l10n.counteroffer(
                    offer.driverDisplayName,
                    formatMoney(context, offer.amount),
                  ),
                ),
                Text(vehicleTypeName(l10n, offer.vehicleTypeCode)),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(
                      onPressed: _controller.busy
                          ? null
                          : () => _controller.rejectCounteroffer(offer.offerId),
                      child: Text(l10n.rejectOffer),
                    ),
                    FilledButton(
                      onPressed: _controller.busy
                          ? null
                          : () => _controller.acceptCounteroffer(offer.offerId),
                      child: Text(l10n.acceptOffer),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
    ];
  }

  Widget _driverCard(PassengerLocalizations l10n, PassengerRideDriver driver) =>
      Card(
        child: ListTile(
          leading: const Icon(Icons.electric_rickshaw),
          title: Text(driver.displayName),
          subtitle: driver.vehicle == null
              ? null
              : Text(
                  l10n.vehicle(
                    vehicleTypeName(l10n, driver.vehicle!.vehicleTypeCode),
                    driver.vehicle!.plateNumber,
                  ),
                ),
          trailing: driver.phoneE164 == null
              ? null
              : IconButton(
                  tooltip: l10n.callDriver,
                  icon: const Icon(Icons.call),
                  onPressed: () =>
                      launchUrl(Uri(scheme: 'tel', path: driver.phoneE164)),
                ),
        ),
      );

  Widget _errorText(String text) => Padding(
    padding: const EdgeInsets.only(top: 8),
    child: Text(
      text,
      style: TextStyle(color: Theme.of(context).colorScheme.error),
    ),
  );
}

/// Asks for confirmation and an optional reason. Pops the reason (possibly empty) to cancel, or
/// null to keep the ride. It owns its text controller, which must outlive the closing animation.
class _CancelDialog extends StatefulWidget {
  const _CancelDialog();

  @override
  State<_CancelDialog> createState() => _CancelDialogState();
}

class _CancelDialogState extends State<_CancelDialog> {
  final _reason = TextEditingController();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = PassengerLocalizations.of(context);
    return AlertDialog(
      title: Text(l10n.cancelRideQuestion),
      content: TextField(
        key: const Key('cancelReason'),
        controller: _reason,
        maxLength: 500,
        decoration: InputDecoration(labelText: l10n.cancelReasonLabel),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(l10n.keepRide),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, _reason.text),
          child: Text(l10n.cancelRide),
        ),
      ],
    );
  }
}
