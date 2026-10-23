import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:latlong2/latlong.dart';
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_ui/taketuk_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../driver_text.dart';
import '../l10n/driver_localizations.dart';
import 'work_controller.dart';

/// Counteroffers start one step above the passenger's offer: 10 SDG. A UI convenience only; the
/// server checks the fare is above the proposal and at least the minimum.
const counterStepMinor = 1000;

/// An approved driver's shift: going online, offers, and the current trip.
class WorkScreen extends StatefulWidget {
  const WorkScreen({
    required this.api,
    required this.profile,
    required this.location,
    required this.mapSettings,
    this.pollInterval = const Duration(seconds: 4),
    this.locationInterval = const Duration(seconds: 15),
    super.key,
  });

  final TaketukApi api;
  final DriverProfile profile;
  final DeviceLocation location;
  final MapSettings mapSettings;
  final Duration pollInterval;
  final Duration locationInterval;

  @override
  State<WorkScreen> createState() => _WorkScreenState();
}

class _WorkScreenState extends State<WorkScreen> {
  late final WorkController _work = WorkController(
    api: widget.api,
    location: widget.location,
    initialProfile: widget.profile,
    pollInterval: widget.pollInterval,
    locationInterval: widget.locationInterval,
  )..start();
  String? _vehicleId;

  @override
  void dispose() {
    _work.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _work,
    builder: (context, _) {
      final ride = _work.ride;
      return ride == null
          ? _shift(context)
          : _TripView(work: _work, ride: ride, mapSettings: widget.mapSettings);
    },
  );

  Widget _shift(BuildContext context) {
    final l10n = DriverLocalizations.of(context);
    final theme = Theme.of(context);
    final vehicles = _work.approvedVehicles;
    final vehicleId = _vehicleId ?? vehicles.firstOrNull?.id;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Icon(
                      Icons.circle,
                      size: 14,
                      color: _work.online
                          ? Colors.green.shade700
                          : theme.disabledColor,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      _work.online ? l10n.online : l10n.offline,
                      style: theme.textTheme.titleMedium,
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                if (_work.online) ...[
                  Text(l10n.onlineHelp),
                  if (!_work.locationAvailable)
                    Text(
                      l10n.locationOff,
                      style: TextStyle(color: theme.colorScheme.error),
                    ),
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: _work.busy ? null : _work.goOffline,
                    child: Text(l10n.goOffline),
                  ),
                ] else if (vehicles.isEmpty)
                  Text(l10n.noApprovedVehicle)
                else ...[
                  if (vehicles.length > 1)
                    DropdownButtonFormField<String>(
                      initialValue: vehicleId,
                      decoration: InputDecoration(
                        labelText: l10n.chooseVehicle,
                      ),
                      items: [
                        for (final v in vehicles)
                          DropdownMenuItem(
                            value: v.id,
                            child: Text(v.plateNumber),
                          ),
                      ],
                      onChanged: (value) => setState(() => _vehicleId = value),
                    ),
                  const SizedBox(height: 8),
                  BusyButton(
                    label: l10n.goOnline,
                    onPressed: vehicleId == null
                        ? null
                        : () => _work.goOnline(vehicleId),
                  ),
                ],
              ],
            ),
          ),
        ),
        if (_work.actionError case final error?)
          Padding(
            padding: const EdgeInsets.all(8),
            child: Text(
              driverErrorMessage(context, error),
              style: TextStyle(color: theme.colorScheme.error),
            ),
          ),
        if (_work.online && _work.offers.isEmpty)
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(l10n.waitingForOffers, textAlign: TextAlign.center),
          ),
        for (final offer in _work.offers) _OfferCard(work: _work, offer: offer),
      ],
    );
  }
}

class _OfferCard extends StatelessWidget {
  const _OfferCard({required this.work, required this.offer});

  final WorkController work;
  final DriverOffer offer;

  Future<void> _propose(BuildContext context) async {
    final amount = await showDialog<int>(
      context: context,
      builder: (_) => _AmountDialog(
        title: DriverLocalizations.of(context).proposeFareTitle,
        help: DriverLocalizations.of(context).proposeFareHelp,
        currency: offer.offeredFare.currency,
        initialMinor: offer.offeredFare.amountMinor + counterStepMinor,
        minimumMinor: offer.offeredFare.amountMinor + 1,
      ),
    );
    if (amount != null) {
      await work.counteroffer(
        offer.offerId,
        amount,
        offer.offeredFare.currency,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = DriverLocalizations.of(context);
    final countered = offer.status == DriverOfferStatus.countered;
    return Card(
      key: Key('offer-${offer.offerId}'),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.offerFrom(
                offer.passenger.displayName,
                formatMoney(context, offer.offeredFare),
              ),
              style: Theme.of(context).textTheme.titleMedium,
            ),
            Text(
              l10n.offerTrip(
                kilometres(context, offer.distanceToPickupMeters),
                kilometres(context, offer.route.distanceMeters),
              ),
            ),
            if (offer.pickup.label case final label?)
              Text('${l10n.pickupPoint}: $label'),
            if (offer.destination.label case final label?)
              Text('${l10n.destinationPoint}: $label'),
            Text(l10n.offerMinimum(formatMoney(context, offer.minimumFare))),
            const SizedBox(height: 8),
            if (countered && offer.counterFare != null)
              Text(
                l10n.offerCountered(formatMoney(context, offer.counterFare!)),
              )
            else
              Wrap(
                alignment: WrapAlignment.end,
                spacing: 8,
                children: [
                  TextButton(
                    onPressed: work.busy
                        ? null
                        : () => work.decline(offer.offerId),
                    child: Text(l10n.declineOffer),
                  ),
                  OutlinedButton(
                    onPressed: work.busy ? null : () => _propose(context),
                    child: Text(l10n.proposeFare),
                  ),
                  FilledButton(
                    onPressed: work.busy
                        ? null
                        : () => work.accept(offer.offerId),
                    child: Text(l10n.acceptOffer),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

class _TripView extends StatelessWidget {
  const _TripView({
    required this.work,
    required this.ride,
    required this.mapSettings,
  });

  final WorkController work;
  final DriverRide ride;
  final MapSettings mapSettings;

  Future<void> _cancel(BuildContext context) async {
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => const _CancelDialog(),
    );
    if (reason != null) await work.cancel(reason);
  }

  Future<void> _otherAmount(BuildContext context, Money fare) async {
    final amount = await showDialog<int>(
      context: context,
      builder: (_) => _AmountDialog(
        title: DriverLocalizations.of(context).collectedOther,
        currency: fare.currency,
        initialMinor: fare.amountMinor,
        minimumMinor: 1,
      ),
    );
    if (amount != null && context.mounted) await _report(context, amount);
  }

  Future<void> _report(BuildContext context, int? collectedMinor) async {
    final messenger = ScaffoldMessenger.of(context);
    final recorded = DriverLocalizations.of(context).paymentRecorded;
    if (await work.reportCash(collectedMinor: collectedMinor)) {
      messenger.showSnackBar(SnackBar(content: Text(recorded)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = DriverLocalizations.of(context);
    final theme = Theme.of(context);
    final pickup = LatLng(ride.pickup.lat, ride.pickup.lng);
    final destination = LatLng(ride.destination.lat, ride.destination.lng);
    final fare = ride.agreedFare;
    final busy = work.busy;
    return ListView(
      children: [
        SizedBox(
          height: 220,
          child: TaketukMap(
            settings: mapSettings,
            initialCenter: ride.status == DriverRideStatus.inProgress
                ? destination
                : pickup,
            markers: [
              tripMarker(
                pickup,
                color: Colors.green.shade700,
                label: l10n.pickupPoint,
              ),
              tripMarker(
                destination,
                color: theme.colorScheme.error,
                label: l10n.destinationPoint,
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(switch (ride.status) {
                DriverRideStatus.driverAssigned => l10n.tripToPickup,
                DriverRideStatus.driverArrived => l10n.tripAtPickup,
                DriverRideStatus.inProgress => l10n.tripInProgress,
                DriverRideStatus.completed => l10n.tripCompleted,
                DriverRideStatus.cancelled => l10n.tripCancelled,
                _ => l10n.statusUnknown,
              }, style: theme.textTheme.headlineSmall),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.person),
                title: Text(ride.passenger.displayName),
                trailing: ride.passenger.phoneE164 == null
                    ? null
                    : IconButton(
                        tooltip: l10n.callPassenger,
                        icon: const Icon(Icons.call),
                        onPressed: () => launchUrl(
                          Uri(scheme: 'tel', path: ride.passenger.phoneE164),
                        ),
                      ),
              ),
              if (ride.pickup.label case final label?)
                Text('${l10n.pickupPoint}: $label'),
              if (ride.destination.label case final label?)
                Text('${l10n.destinationPoint}: $label'),
              if (fare != null)
                Text(
                  formatMoney(context, fare),
                  style: theme.textTheme.titleLarge,
                ),
              if (work.actionError case final error?)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    driverErrorMessage(context, error),
                    style: TextStyle(color: theme.colorScheme.error),
                  ),
                ),
              const SizedBox(height: 16),
              ...switch (ride.status) {
                DriverRideStatus.driverAssigned => [
                  BusyButton(label: l10n.arrived, onPressed: work.arrive),
                ],
                DriverRideStatus.driverArrived => [
                  BusyButton(label: l10n.startTrip, onPressed: work.startTrip),
                ],
                DriverRideStatus.inProgress => [
                  BusyButton(
                    label: l10n.completeTrip,
                    onPressed: work.complete,
                  ),
                ],
                DriverRideStatus.completed when fare != null => [
                  Text(l10n.fareToCollect(formatMoney(context, fare))),
                  const SizedBox(height: 8),
                  BusyButton(
                    label: l10n.collectedFull(formatMoney(context, fare)),
                    onPressed: () => _report(context, fare.amountMinor),
                  ),
                  OutlinedButton(
                    onPressed: busy ? null : () => _otherAmount(context, fare),
                    child: Text(l10n.collectedOther),
                  ),
                  TextButton(
                    onPressed: busy ? null : () => _report(context, null),
                    child: Text(l10n.notCollected),
                  ),
                ],
                DriverRideStatus.cancelled => [
                  FilledButton(
                    onPressed: work.dismissRide,
                    child: Text(l10n.done),
                  ),
                ],
                _ => const <Widget>[],
              },
              if (ride.status == DriverRideStatus.driverAssigned ||
                  ride.status == DriverRideStatus.driverArrived)
                TextButton(
                  onPressed: busy ? null : () => _cancel(context),
                  child: Text(l10n.cancelRide),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// An amount in major units (e.g. SDG) entered as a whole number; pops minor units.
class _AmountDialog extends StatefulWidget {
  const _AmountDialog({
    required this.title,
    required this.currency,
    required this.initialMinor,
    required this.minimumMinor,
    this.help,
  });

  final String title;
  final String? help;
  final String currency;
  final int initialMinor;
  final int minimumMinor;

  @override
  State<_AmountDialog> createState() => _AmountDialogState();
}

class _AmountDialogState extends State<_AmountDialog> {
  late final _amount = TextEditingController(
    text: (widget.initialMinor / 100).ceil().toString(),
  );

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  int? get _minor {
    final major = int.tryParse(_amount.text.trim());
    if (major == null) return null;
    final minor = major * 100;
    return minor >= widget.minimumMinor ? minor : null;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = DriverLocalizations.of(context);
    return AlertDialog(
      title: Text(widget.title),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (widget.help case final help?) Text(help),
          TextField(
            key: const Key('amount'),
            controller: _amount,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: InputDecoration(
              labelText: l10n.amountLabel(widget.currency),
            ),
            onChanged: (_) => setState(() {}),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          onPressed: _minor == null
              ? null
              : () => Navigator.pop(context, _minor),
          child: Text(l10n.send),
        ),
      ],
    );
  }
}

/// The driver must give a reason (at least 3 characters) to cancel.
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
    final l10n = DriverLocalizations.of(context);
    final valid = _reason.text.trim().length >= 3;
    return AlertDialog(
      title: Text(l10n.cancelRide),
      content: TextField(
        key: const Key('cancelReason'),
        controller: _reason,
        maxLength: 500,
        decoration: InputDecoration(
          labelText: l10n.cancelReasonRequired,
          errorText: _reason.text.isNotEmpty && !valid
              ? l10n.errorReasonTooShort
              : null,
        ),
        onChanged: (_) => setState(() {}),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(l10n.keepRide),
        ),
        FilledButton(
          onPressed: valid
              ? () => Navigator.pop(context, _reason.text.trim())
              : null,
          child: Text(l10n.cancelRide),
        ),
      ],
    );
  }
}
