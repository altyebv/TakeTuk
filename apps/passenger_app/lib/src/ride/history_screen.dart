import 'package:flutter/material.dart';
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

import '../l10n/passenger_localizations.dart';
import 'ride_text.dart';

/// The passenger's rides, newest first, with keyset pagination (API_CONVENTIONS §7).
class HistoryScreen extends StatefulWidget {
  const HistoryScreen({required this.api, required this.onOpen, super.key});

  final TaketukApi api;
  final void Function(String rideId) onOpen;

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  final List<PassengerRide> _rides = [];
  String? _cursor;
  bool _loaded = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final page = await widget.api.rides.list(limit: 20, cursor: _cursor);
      if (!mounted) return;
      setState(() {
        _rides.addAll(page.items);
        _cursor = page.nextCursor;
        _loaded = true;
      });
    } on Object catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = PassengerLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.myRides)),
      body: ListView(
        padding: const EdgeInsets.all(8),
        children: [
          if (_loaded && _rides.isEmpty)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(l10n.noRides),
            ),
          for (final ride in _rides)
            ListTile(
              key: Key('ride-${ride.id}'),
              title: Text(
                ride.destination.label ?? rideStatusLabel(l10n, ride.status),
              ),
              subtitle: Text(
                '${formatRideTime(context, ride.createdAt)} · '
                '${rideStatusLabel(l10n, ride.status)}',
              ),
              trailing: Text(
                formatMoney(context, ride.agreedFare ?? ride.proposedFare),
              ),
              onTap: () => widget.onOpen(ride.id),
            ),
          if (_error case final error?)
            Padding(
              padding: const EdgeInsets.all(16),
              child: ErrorMessage(error),
            ),
          if (!_loaded && _error == null)
            const Center(child: CircularProgressIndicator()),
          if (_cursor != null || _error != null)
            TextButton(
              onPressed: _load,
              child: Text(
                _error == null
                    ? l10n.loadMore
                    : TaketukUiLocalizations.of(context).retry,
              ),
            ),
        ],
      ),
    );
  }
}
