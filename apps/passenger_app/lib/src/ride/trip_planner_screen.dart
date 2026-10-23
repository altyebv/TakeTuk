import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

import '../l10n/passenger_localizations.dart';
import 'ride_text.dart';

/// Offer adjustments are in steps of 10 SDG. This is a UI convenience only: the server enforces
/// the minimum fare and accepts any amount at or above it.
const fareStepMinor = 1000;

enum _Point { pickup, destination }

/// Home: choose pickup and destination on the map, see the minimum fare, propose a fare and
/// request the ride (STATE_MACHINES §1–2). Resumes an open ride instead when there is one.
class TripPlannerScreen extends StatefulWidget {
  const TripPlannerScreen({
    required this.api,
    required this.mapSettings,
    required this.location,
    required this.onRide,
    required this.onHistory,
    required this.onSignOut,
    super.key,
  });

  final TaketukApi api;
  final MapSettings mapSettings;
  final DeviceLocation location;

  /// Called with the id of a created or still-open ride.
  final void Function(String rideId) onRide;
  final VoidCallback onHistory;
  final VoidCallback onSignOut;

  @override
  State<TripPlannerScreen> createState() => _TripPlannerScreenState();
}

class _TripPlannerScreenState extends State<TripPlannerScreen> {
  final _map = MapController();
  final _pickupName = TextEditingController();
  final _destinationName = TextEditingController();
  LatLng? _pickup;
  LatLng? _destination;
  _Point _choosing = _Point.pickup;
  FareQuote? _quote;
  int _offerMinor = 0;

  /// One key per request intent: kept across retries of the same offer, so a retried request
  /// can never create a second ride (API_CONVENTIONS §8). A new offer is a new intent.
  String? _requestKey;
  Object? _error;
  bool _locationUnavailable = false;

  @override
  void initState() {
    super.initState();
    unawaited(_resumeOpenRide());
  }

  @override
  void dispose() {
    _map.dispose();
    _pickupName.dispose();
    _destinationName.dispose();
    super.dispose();
  }

  Future<void> _resumeOpenRide() async {
    try {
      final page = await widget.api.rides.list(limit: 5);
      final open = page.items.where((ride) => isOpenRide(ride.status));
      if (open.isNotEmpty && mounted) widget.onRide(open.first.id);
    } on Object {
      // The planner stays usable; creating a ride reports RIDE_ALREADY_OPEN if one exists.
    }
  }

  void _invalidateQuote() {
    _quote = null;
    _requestKey = null;
    _error = null;
  }

  void _place(LatLng point) => setState(() {
    if (_choosing == _Point.pickup) {
      _pickup = point;
      if (_destination == null) _choosing = _Point.destination;
    } else {
      _destination = point;
    }
    _invalidateQuote();
  });

  Future<void> _useMyLocation() async {
    final here = await widget.location.current();
    if (!mounted) return;
    setState(() {
      _locationUnavailable = here == null;
      if (here != null) {
        _pickup = here;
        _choosing = _Point.destination;
        _invalidateQuote();
      }
    });
    if (here != null) _map.move(here, 16);
  }

  Future<void> _seePrice() async {
    final pickup = _pickup!;
    final destination = _destination!;
    setState(() => _error = null);
    String? label(TextEditingController c) =>
        c.text.trim().isEmpty ? null : c.text.trim();
    try {
      final quote = await widget.api.pricing.createQuote(
        PricingCreateQuoteRequest(
          pickup: Coordinates(lat: pickup.latitude, lng: pickup.longitude),
          destination: Coordinates(
            lat: destination.latitude,
            lng: destination.longitude,
          ),
          pickupLabel: label(_pickupName),
          destinationLabel: label(_destinationName),
        ),
      );
      if (!mounted) return;
      setState(() {
        _quote = quote;
        _offerMinor = quote.minimumFare.amountMinor;
        _requestKey = null;
      });
    } on Object catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  void _adjustOffer(int delta) => setState(() {
    _offerMinor = math.max(
      _quote!.minimumFare.amountMinor,
      _offerMinor + delta,
    );
    _requestKey = null;
    _error = null;
  });

  Future<void> _request() async {
    final quote = _quote!;
    final key = _requestKey ??= newIdempotencyKey();
    setState(() => _error = null);
    try {
      final ride = await widget.api.rides.create(
        RidesCreateRequest(
          quoteId: quote.id,
          proposedFare: MoneyInput(
            amountMinor: _offerMinor,
            currency: quote.minimumFare.currency,
          ),
        ),
        idempotencyKey: key,
      );
      widget.onRide(ride.id);
    } on ApiProblem catch (problem) {
      if (problem.code == ProblemCodes.rideAlreadyOpen) {
        await _resumeOpenRide();
        return;
      }
      if (!mounted) return;
      setState(() {
        // A quote that expired or was used must be fetched again.
        if (const {
          ProblemCodes.quoteExpired,
          ProblemCodes.quoteAlreadyUsed,
          ProblemCodes.quoteNotFound,
        }.contains(problem.code)) {
          _quote = null;
          _requestKey = null;
        }
        _error = problem;
      });
    } on Object catch (error) {
      // Network failures keep the key: retrying sends the same intent.
      if (mounted) setState(() => _error = error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = PassengerLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.appName),
        actions: [
          IconButton(
            tooltip: l10n.myRides,
            icon: const Icon(Icons.history),
            onPressed: widget.onHistory,
          ),
          IconButton(
            tooltip: l10n.signOut,
            icon: const Icon(Icons.logout),
            onPressed: widget.onSignOut,
          ),
        ],
      ),
      body: LayoutBuilder(
        builder: (context, constraints) => Stack(
          children: [
            Positioned.fill(
              child: TaketukMap(
                key: const Key('tripMap'),
                settings: widget.mapSettings,
                controller: _map,
                onTap: _quote == null ? _place : null,
                markers: [
                  if (_pickup case final pickup?)
                    tripMarker(
                      pickup,
                      key: const Key('pickupMarker'),
                      color: Colors.green.shade700,
                      label: l10n.setPickup,
                    ),
                  if (_destination case final destination?)
                    tripMarker(
                      destination,
                      key: const Key('destinationMarker'),
                      color: scheme.error,
                      label: l10n.setDestination,
                    ),
                ],
              ),
            ),
            Align(
              alignment: Alignment.bottomCenter,
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  maxHeight: constraints.maxHeight * 0.6,
                ),
                child: Material(
                  elevation: 8,
                  color: scheme.surface,
                  borderRadius: const BorderRadius.vertical(
                    top: Radius.circular(16),
                  ),
                  child: SafeArea(
                    top: false,
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.all(16),
                      child: _quote == null
                          ? _tripForm(l10n)
                          : _offerForm(l10n),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _tripForm(PassengerLocalizations l10n) => Column(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      SegmentedButton<_Point>(
        segments: [
          ButtonSegment(
            value: _Point.pickup,
            label: Text(l10n.setPickup),
            icon: const Icon(Icons.trip_origin),
          ),
          ButtonSegment(
            value: _Point.destination,
            label: Text(l10n.setDestination),
            icon: const Icon(Icons.place),
          ),
        ],
        selected: {_choosing},
        onSelectionChanged: (selection) =>
            setState(() => _choosing = selection.single),
      ),
      const SizedBox(height: 8),
      Text(
        _choosing == _Point.pickup ? l10n.tapForPickup : l10n.tapForDestination,
      ),
      if (_locationUnavailable) Text(l10n.locationUnavailable),
      Align(
        alignment: AlignmentDirectional.centerStart,
        child: TextButton.icon(
          onPressed: _useMyLocation,
          icon: const Icon(Icons.my_location),
          label: Text(l10n.useMyLocation),
        ),
      ),
      TextField(
        controller: _pickupName,
        maxLength: 200,
        decoration: InputDecoration(
          labelText: l10n.pickupNameLabel,
          counterText: '',
        ),
      ),
      const SizedBox(height: 8),
      TextField(
        controller: _destinationName,
        maxLength: 200,
        decoration: InputDecoration(
          labelText: l10n.destinationNameLabel,
          counterText: '',
        ),
      ),
      if (_error case final error?)
        _ErrorText(rideErrorMessage(context, error)),
      const SizedBox(height: 12),
      BusyButton(
        label: l10n.seePrice,
        onPressed: _pickup != null && _destination != null ? _seePrice : null,
      ),
    ],
  );

  Widget _offerForm(PassengerLocalizations l10n) {
    final quote = _quote!;
    final currency = quote.minimumFare.currency;
    final atMinimum = _offerMinor <= quote.minimumFare.amountMinor;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          tripSummary(
            context,
            quote.route.distanceMeters,
            quote.route.durationSeconds,
          ),
        ),
        Text(l10n.minimumFare(formatMoney(context, quote.minimumFare))),
        const SizedBox(height: 8),
        Row(
          children: [
            IconButton.outlined(
              key: const Key('lowerOffer'),
              tooltip: l10n.lowerOffer,
              onPressed: atMinimum ? null : () => _adjustOffer(-fareStepMinor),
              icon: const Icon(Icons.remove),
            ),
            Expanded(
              child: Text(
                l10n.yourOffer(
                  formatMinorUnits(context, _offerMinor, currency),
                ),
                key: const Key('offer'),
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            IconButton.outlined(
              key: const Key('raiseOffer'),
              tooltip: l10n.raiseOffer,
              onPressed: () => _adjustOffer(fareStepMinor),
              icon: const Icon(Icons.add),
            ),
          ],
        ),
        Text(l10n.offerHelp, style: Theme.of(context).textTheme.bodySmall),
        if (_error case final error?)
          _ErrorText(rideErrorMessage(context, error)),
        const SizedBox(height: 12),
        BusyButton(label: l10n.requestRide, onPressed: _request),
        TextButton(
          onPressed: () => setState(_invalidateQuote),
          child: Text(l10n.changeTrip),
        ),
      ],
    );
  }
}

class _ErrorText extends StatelessWidget {
  const _ErrorText(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 8),
    child: Semantics(
      liveRegion: true,
      child: Text(
        text,
        style: TextStyle(color: Theme.of(context).colorScheme.error),
      ),
    ),
  );
}
