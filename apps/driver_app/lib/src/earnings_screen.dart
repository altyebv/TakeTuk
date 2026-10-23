import 'package:flutter/material.dart';
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

import 'driver_text.dart';
import 'l10n/driver_localizations.dart';

/// Completed-ride fares, commissions and the commission owed (`GET /v1/driver/earnings`).
class EarningsScreen extends StatefulWidget {
  const EarningsScreen({required this.api, super.key});

  final TaketukApi api;

  @override
  State<EarningsScreen> createState() => _EarningsScreenState();
}

class _EarningsScreenState extends State<EarningsScreen> {
  final List<FinanceDriverEarningsResponseItemsItem> _items = [];
  List<Money> _owed = const [];
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
      final page = await widget.api.finance.driverEarnings(
        limit: 20,
        cursor: _cursor,
      );
      if (!mounted) return;
      setState(() {
        _owed = page.commissionOwed;
        _items.addAll(page.items);
        _cursor = page.nextCursor;
        _loaded = true;
      });
    } on Object catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = DriverLocalizations.of(context);
    final owed = _owed.where((m) => m.amountMinor != 0).toList();
    return Scaffold(
      appBar: AppBar(title: Text(l10n.earnings)),
      body: ListView(
        padding: const EdgeInsets.all(8),
        children: [
          if (_loaded)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  owed.isEmpty
                      ? l10n.noCommissionOwed
                      : owed
                            .map(
                              (m) =>
                                  l10n.commissionOwed(formatMoney(context, m)),
                            )
                            .join('\n'),
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
            ),
          if (_loaded && _items.isEmpty)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(l10n.noEarnings),
            ),
          for (final item in _items)
            ListTile(
              key: Key('earning-${item.rideId}'),
              title: Text(
                l10n.earningLine(
                  formatMoney(context, item.agreedFare),
                  formatMoney(context, item.commission),
                ),
              ),
              subtitle: Text(formatTime(context, item.completedAt)),
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
