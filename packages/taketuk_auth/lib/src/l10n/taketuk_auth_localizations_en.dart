// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'taketuk_auth_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class TaketukAuthLocalizationsEn extends TaketukAuthLocalizations {
  TaketukAuthLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get signInTitle => 'Sign in';

  @override
  String get phoneLabel => 'Mobile number';

  @override
  String get phoneHint => '0912345678';

  @override
  String get phoneHelp => 'We will send you a code by SMS.';

  @override
  String get sendCode => 'Send code';

  @override
  String get codeTitle => 'Enter the code';

  @override
  String codeSentTo(String phone) {
    return 'Enter the code we sent to $phone.';
  }

  @override
  String get codeLabel => 'Verification code';

  @override
  String get verify => 'Confirm';

  @override
  String get resendCode => 'Send a new code';

  @override
  String get codeResent => 'A new code is on its way.';

  @override
  String get changeNumber => 'Change number';

  @override
  String get signOut => 'Sign out';

  @override
  String get errorInvalidPhone =>
      'Enter a Sudanese mobile number, for example 0912345678.';

  @override
  String get errorInvalidCode => 'The code is wrong or has expired.';

  @override
  String get loading => 'Loading…';

  @override
  String get accountErrorTitle => 'We could not load your account';
}
