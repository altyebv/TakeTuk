// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'taketuk_ui_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class TaketukUiLocalizationsEn extends TaketukUiLocalizations {
  TaketukUiLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get retry => 'Try again';

  @override
  String get errorNetwork =>
      'No connection. Check your internet and try again.';

  @override
  String get errorServiceUnavailable =>
      'The service is temporarily unavailable. Please try again shortly.';

  @override
  String get errorSignedOut => 'Your session has ended. Please sign in again.';

  @override
  String get errorAccountDisabled =>
      'This account is disabled. Please contact support.';

  @override
  String get errorRateLimited =>
      'Too many attempts. Wait a moment and try again.';

  @override
  String get errorValidation =>
      'Some details are not valid. Check them and try again.';

  @override
  String get errorUpdateRequired =>
      'This version of the app is out of date. Please update it.';

  @override
  String get errorGeneric => 'Something went wrong. Please try again.';

  @override
  String supportReference(String requestId) {
    return 'Reference: $requestId';
  }

  @override
  String get currencySdg => 'SDG';
}
