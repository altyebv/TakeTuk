import 'dart:math' as math;

import 'package:flutter/widgets.dart';
import 'package:intl/intl.dart';
import 'package:taketuk_api/taketuk_api.dart';

import 'l10n/taketuk_ui_localizations.dart';

/// ISO 4217 minor-unit exponents of the currencies the API uses (API_CONVENTIONS: integer minor
/// units, never floats).
const Map<String, int> _minorUnitDigits = {'SDG': 2};

/// Formats an API amount for display, for example `250.00 ج.س` or `250.00 SDG`.
String formatMoney(BuildContext context, Money money) =>
    formatMinorUnits(context, money.amountMinor, money.currency);

String formatMinorUnits(
  BuildContext context,
  int amountMinor,
  String currency,
) {
  final digits = _minorUnitDigits[currency] ?? 2;
  final locale = Localizations.localeOf(context).toLanguageTag();
  final number = NumberFormat.decimalPatternDigits(
    locale: locale,
    decimalDigits: digits,
  );
  // Rounded to the minor-unit digits, the division displays exactly for every amount the API
  // accepts (at most 10^12 minor units, far inside double precision).
  final text = number.format(amountMinor / math.pow(10, digits));
  final symbol = currency == 'SDG'
      ? TaketukUiLocalizations.of(context).currencySdg
      : currency;
  return '$text $symbol';
}
