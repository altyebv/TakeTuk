// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'driver_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class DriverLocalizationsEn extends DriverLocalizations {
  DriverLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appName => 'TAKE-TUK Driver';

  @override
  String get registerTitle => 'Drive with TAKE-TUK';

  @override
  String get registerIntro =>
      'Tell us about yourself. Your details are reviewed before you can take rides.';

  @override
  String get displayNameLabel => 'Name shown to passengers';

  @override
  String get legalNameLabel => 'Full legal name';

  @override
  String get licenseLabel => 'Driving licence number';

  @override
  String get errorRequired => 'This field is required.';

  @override
  String get errorAlreadyRegistered =>
      'You are already registered with different details. Please contact support.';

  @override
  String get continueButton => 'Continue';

  @override
  String homeGreeting(String name) {
    return 'Hello, $name';
  }

  @override
  String get statusApplicant =>
      'Next: add your vehicle and documents. This arrives in the next version of the app.';

  @override
  String get statusPendingReview => 'Your application is being reviewed.';

  @override
  String get statusApproved =>
      'You are approved. Going online arrives in the next version of the app.';

  @override
  String get statusRejected => 'Your application was not approved.';

  @override
  String reviewNote(String note) {
    return 'Reviewer\'s note: $note';
  }

  @override
  String get statusSuspended =>
      'Your account is suspended. Please contact support.';

  @override
  String get statusUnknown =>
      'Your account status cannot be shown in this version. Please update the app.';

  @override
  String get signOut => 'Sign out';
}
