import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'driver_localizations_ar.dart';
import 'driver_localizations_en.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of DriverLocalizations
/// returned by `DriverLocalizations.of(context)`.
///
/// Applications need to include `DriverLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/driver_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: DriverLocalizations.localizationsDelegates,
///   supportedLocales: DriverLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the DriverLocalizations.supportedLocales
/// property.
abstract class DriverLocalizations {
  DriverLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static DriverLocalizations of(BuildContext context) {
    return Localizations.of<DriverLocalizations>(context, DriverLocalizations)!;
  }

  static const LocalizationsDelegate<DriverLocalizations> delegate =
      _DriverLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('ar'),
    Locale('en'),
  ];

  /// No description provided for @appName.
  ///
  /// In en, this message translates to:
  /// **'TAKE-TUK Driver'**
  String get appName;

  /// No description provided for @registerTitle.
  ///
  /// In en, this message translates to:
  /// **'Drive with TAKE-TUK'**
  String get registerTitle;

  /// No description provided for @registerIntro.
  ///
  /// In en, this message translates to:
  /// **'Tell us about yourself. Your details are reviewed before you can take rides.'**
  String get registerIntro;

  /// No description provided for @displayNameLabel.
  ///
  /// In en, this message translates to:
  /// **'Name shown to passengers'**
  String get displayNameLabel;

  /// No description provided for @legalNameLabel.
  ///
  /// In en, this message translates to:
  /// **'Full legal name'**
  String get legalNameLabel;

  /// No description provided for @licenseLabel.
  ///
  /// In en, this message translates to:
  /// **'Driving licence number'**
  String get licenseLabel;

  /// No description provided for @errorRequired.
  ///
  /// In en, this message translates to:
  /// **'This field is required.'**
  String get errorRequired;

  /// No description provided for @errorAlreadyRegistered.
  ///
  /// In en, this message translates to:
  /// **'You are already registered with different details. Please contact support.'**
  String get errorAlreadyRegistered;

  /// No description provided for @continueButton.
  ///
  /// In en, this message translates to:
  /// **'Continue'**
  String get continueButton;

  /// No description provided for @homeGreeting.
  ///
  /// In en, this message translates to:
  /// **'Hello, {name}'**
  String homeGreeting(String name);

  /// No description provided for @statusApplicant.
  ///
  /// In en, this message translates to:
  /// **'Next: add your vehicle and documents. This arrives in the next version of the app.'**
  String get statusApplicant;

  /// No description provided for @statusPendingReview.
  ///
  /// In en, this message translates to:
  /// **'Your application is being reviewed.'**
  String get statusPendingReview;

  /// No description provided for @statusApproved.
  ///
  /// In en, this message translates to:
  /// **'You are approved. Going online arrives in the next version of the app.'**
  String get statusApproved;

  /// No description provided for @statusRejected.
  ///
  /// In en, this message translates to:
  /// **'Your application was not approved.'**
  String get statusRejected;

  /// No description provided for @reviewNote.
  ///
  /// In en, this message translates to:
  /// **'Reviewer\'s note: {note}'**
  String reviewNote(String note);

  /// No description provided for @statusSuspended.
  ///
  /// In en, this message translates to:
  /// **'Your account is suspended. Please contact support.'**
  String get statusSuspended;

  /// No description provided for @statusUnknown.
  ///
  /// In en, this message translates to:
  /// **'Your account status cannot be shown in this version. Please update the app.'**
  String get statusUnknown;

  /// No description provided for @signOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get signOut;
}

class _DriverLocalizationsDelegate
    extends LocalizationsDelegate<DriverLocalizations> {
  const _DriverLocalizationsDelegate();

  @override
  Future<DriverLocalizations> load(Locale locale) {
    return SynchronousFuture<DriverLocalizations>(
      lookupDriverLocalizations(locale),
    );
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['ar', 'en'].contains(locale.languageCode);

  @override
  bool shouldReload(_DriverLocalizationsDelegate old) => false;
}

DriverLocalizations lookupDriverLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'ar':
      return DriverLocalizationsAr();
    case 'en':
      return DriverLocalizationsEn();
  }

  throw FlutterError(
    'DriverLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
