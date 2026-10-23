// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'passenger_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class PassengerLocalizationsEn extends PassengerLocalizations {
  PassengerLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appName => 'TAKE-TUK';

  @override
  String get registerTitle => 'Welcome to TAKE-TUK';

  @override
  String get registerIntro => 'What should drivers call you?';

  @override
  String get nameLabel => 'Your name';

  @override
  String get errorNameRequired => 'Enter your name.';

  @override
  String get continueButton => 'Continue';

  @override
  String homeGreeting(String name) {
    return 'Hello, $name';
  }

  @override
  String get homeNextPhase =>
      'Requesting rides arrives in the next version of the app.';

  @override
  String get signOut => 'Sign out';
}
