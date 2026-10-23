import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'passenger_localizations_ar.dart';
import 'passenger_localizations_en.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of PassengerLocalizations
/// returned by `PassengerLocalizations.of(context)`.
///
/// Applications need to include `PassengerLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/passenger_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: PassengerLocalizations.localizationsDelegates,
///   supportedLocales: PassengerLocalizations.supportedLocales,
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
/// be consistent with the languages listed in the PassengerLocalizations.supportedLocales
/// property.
abstract class PassengerLocalizations {
  PassengerLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static PassengerLocalizations of(BuildContext context) {
    return Localizations.of<PassengerLocalizations>(
      context,
      PassengerLocalizations,
    )!;
  }

  static const LocalizationsDelegate<PassengerLocalizations> delegate =
      _PassengerLocalizationsDelegate();

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
  /// **'TAKE-TUK'**
  String get appName;

  /// No description provided for @registerTitle.
  ///
  /// In en, this message translates to:
  /// **'Welcome to TAKE-TUK'**
  String get registerTitle;

  /// No description provided for @registerIntro.
  ///
  /// In en, this message translates to:
  /// **'What should drivers call you?'**
  String get registerIntro;

  /// No description provided for @nameLabel.
  ///
  /// In en, this message translates to:
  /// **'Your name'**
  String get nameLabel;

  /// No description provided for @errorNameRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter your name.'**
  String get errorNameRequired;

  /// No description provided for @continueButton.
  ///
  /// In en, this message translates to:
  /// **'Continue'**
  String get continueButton;

  /// No description provided for @signOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get signOut;

  /// No description provided for @myRides.
  ///
  /// In en, this message translates to:
  /// **'My rides'**
  String get myRides;

  /// No description provided for @noRides.
  ///
  /// In en, this message translates to:
  /// **'No rides yet.'**
  String get noRides;

  /// No description provided for @setPickup.
  ///
  /// In en, this message translates to:
  /// **'Pickup'**
  String get setPickup;

  /// No description provided for @setDestination.
  ///
  /// In en, this message translates to:
  /// **'Destination'**
  String get setDestination;

  /// No description provided for @tapForPickup.
  ///
  /// In en, this message translates to:
  /// **'Tap the map to set your pickup point.'**
  String get tapForPickup;

  /// No description provided for @tapForDestination.
  ///
  /// In en, this message translates to:
  /// **'Tap the map to set your destination.'**
  String get tapForDestination;

  /// No description provided for @useMyLocation.
  ///
  /// In en, this message translates to:
  /// **'Use my location'**
  String get useMyLocation;

  /// No description provided for @locationUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Your location is not available. Place the pickup on the map.'**
  String get locationUnavailable;

  /// No description provided for @pickupNameLabel.
  ///
  /// In en, this message translates to:
  /// **'Pickup place name (optional)'**
  String get pickupNameLabel;

  /// No description provided for @destinationNameLabel.
  ///
  /// In en, this message translates to:
  /// **'Destination place name (optional)'**
  String get destinationNameLabel;

  /// No description provided for @seePrice.
  ///
  /// In en, this message translates to:
  /// **'See price'**
  String get seePrice;

  /// No description provided for @minimumFare.
  ///
  /// In en, this message translates to:
  /// **'Minimum fare: {amount}'**
  String minimumFare(String amount);

  /// No description provided for @tripSummary.
  ///
  /// In en, this message translates to:
  /// **'{distance} km · about {minutes} min'**
  String tripSummary(String distance, int minutes);

  /// No description provided for @yourOffer.
  ///
  /// In en, this message translates to:
  /// **'Your offer: {amount}'**
  String yourOffer(String amount);

  /// No description provided for @offerHelp.
  ///
  /// In en, this message translates to:
  /// **'Drivers can accept your offer or propose a higher fare.'**
  String get offerHelp;

  /// No description provided for @lowerOffer.
  ///
  /// In en, this message translates to:
  /// **'Lower offer'**
  String get lowerOffer;

  /// No description provided for @raiseOffer.
  ///
  /// In en, this message translates to:
  /// **'Raise offer'**
  String get raiseOffer;

  /// No description provided for @requestRide.
  ///
  /// In en, this message translates to:
  /// **'Request ride'**
  String get requestRide;

  /// No description provided for @changeTrip.
  ///
  /// In en, this message translates to:
  /// **'Change trip'**
  String get changeTrip;

  /// No description provided for @searchingTitle.
  ///
  /// In en, this message translates to:
  /// **'Looking for a driver'**
  String get searchingTitle;

  /// No description provided for @driversNotified.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No drivers notified yet} =1{1 driver notified} other{{count} drivers notified}}'**
  String driversNotified(int count);

  /// No description provided for @counteroffersTitle.
  ///
  /// In en, this message translates to:
  /// **'Drivers\' offers'**
  String get counteroffersTitle;

  /// No description provided for @counteroffer.
  ///
  /// In en, this message translates to:
  /// **'{driver} offers {amount}'**
  String counteroffer(String driver, String amount);

  /// No description provided for @acceptOffer.
  ///
  /// In en, this message translates to:
  /// **'Accept'**
  String get acceptOffer;

  /// No description provided for @rejectOffer.
  ///
  /// In en, this message translates to:
  /// **'Decline'**
  String get rejectOffer;

  /// No description provided for @cancelRide.
  ///
  /// In en, this message translates to:
  /// **'Cancel ride'**
  String get cancelRide;

  /// No description provided for @cancelRideQuestion.
  ///
  /// In en, this message translates to:
  /// **'Cancel this ride?'**
  String get cancelRideQuestion;

  /// No description provided for @cancelReasonLabel.
  ///
  /// In en, this message translates to:
  /// **'Reason (optional)'**
  String get cancelReasonLabel;

  /// No description provided for @keepRide.
  ///
  /// In en, this message translates to:
  /// **'Keep ride'**
  String get keepRide;

  /// No description provided for @statusAssigned.
  ///
  /// In en, this message translates to:
  /// **'{driver} is on the way'**
  String statusAssigned(String driver);

  /// No description provided for @statusArrived.
  ///
  /// In en, this message translates to:
  /// **'Your driver has arrived'**
  String get statusArrived;

  /// No description provided for @statusInProgress.
  ///
  /// In en, this message translates to:
  /// **'On the way to your destination'**
  String get statusInProgress;

  /// No description provided for @statusCompleted.
  ///
  /// In en, this message translates to:
  /// **'You have arrived'**
  String get statusCompleted;

  /// No description provided for @payCash.
  ///
  /// In en, this message translates to:
  /// **'Pay {amount} in cash'**
  String payCash(String amount);

  /// No description provided for @statusCancelled.
  ///
  /// In en, this message translates to:
  /// **'This ride was cancelled'**
  String get statusCancelled;

  /// No description provided for @statusExpired.
  ///
  /// In en, this message translates to:
  /// **'No driver accepted in time'**
  String get statusExpired;

  /// No description provided for @statusUnknown.
  ///
  /// In en, this message translates to:
  /// **'This ride\'s status cannot be shown in this version. Please update the app.'**
  String get statusUnknown;

  /// No description provided for @agreedFare.
  ///
  /// In en, this message translates to:
  /// **'Fare: {amount}'**
  String agreedFare(String amount);

  /// No description provided for @vehicle.
  ///
  /// In en, this message translates to:
  /// **'{type} · {plate}'**
  String vehicle(String type, String plate);

  /// No description provided for @vehicleRaksha.
  ///
  /// In en, this message translates to:
  /// **'Raksha'**
  String get vehicleRaksha;

  /// No description provided for @callDriver.
  ///
  /// In en, this message translates to:
  /// **'Call driver'**
  String get callDriver;

  /// No description provided for @newRide.
  ///
  /// In en, this message translates to:
  /// **'Request a new ride'**
  String get newRide;

  /// No description provided for @errorOutsideArea.
  ///
  /// In en, this message translates to:
  /// **'TAKE-TUK is not available there yet. Choose points inside the service area.'**
  String get errorOutsideArea;

  /// No description provided for @errorSamePoint.
  ///
  /// In en, this message translates to:
  /// **'Pickup and destination are the same place.'**
  String get errorSamePoint;

  /// No description provided for @errorNoRoute.
  ///
  /// In en, this message translates to:
  /// **'We could not find a road route there. Move the points closer to a road.'**
  String get errorNoRoute;

  /// No description provided for @errorRidesUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Rides are not available right now.'**
  String get errorRidesUnavailable;

  /// No description provided for @errorFareBelowMinimum.
  ///
  /// In en, this message translates to:
  /// **'Your offer must be at least the minimum fare.'**
  String get errorFareBelowMinimum;

  /// No description provided for @errorQuoteExpired.
  ///
  /// In en, this message translates to:
  /// **'The price has expired. Check the price again.'**
  String get errorQuoteExpired;

  /// No description provided for @errorRideAlreadyOpen.
  ///
  /// In en, this message translates to:
  /// **'You already have a ride in progress.'**
  String get errorRideAlreadyOpen;

  /// No description provided for @errorOfferGone.
  ///
  /// In en, this message translates to:
  /// **'This offer is no longer available.'**
  String get errorOfferGone;

  /// No description provided for @tripDistance.
  ///
  /// In en, this message translates to:
  /// **'{distance} km'**
  String tripDistance(String distance);

  /// No description provided for @loadMore.
  ///
  /// In en, this message translates to:
  /// **'Show more'**
  String get loadMore;

  /// No description provided for @rideStatusSearching.
  ///
  /// In en, this message translates to:
  /// **'Searching'**
  String get rideStatusSearching;

  /// No description provided for @rideStatusAssigned.
  ///
  /// In en, this message translates to:
  /// **'Driver on the way'**
  String get rideStatusAssigned;

  /// No description provided for @rideStatusArrived.
  ///
  /// In en, this message translates to:
  /// **'Driver arrived'**
  String get rideStatusArrived;

  /// No description provided for @rideStatusInProgress.
  ///
  /// In en, this message translates to:
  /// **'In progress'**
  String get rideStatusInProgress;

  /// No description provided for @rideStatusCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get rideStatusCompleted;

  /// No description provided for @rideStatusCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get rideStatusCancelled;

  /// No description provided for @rideStatusExpired.
  ///
  /// In en, this message translates to:
  /// **'Expired'**
  String get rideStatusExpired;

  /// No description provided for @rideStatusUnknown.
  ///
  /// In en, this message translates to:
  /// **'Unknown'**
  String get rideStatusUnknown;
}

class _PassengerLocalizationsDelegate
    extends LocalizationsDelegate<PassengerLocalizations> {
  const _PassengerLocalizationsDelegate();

  @override
  Future<PassengerLocalizations> load(Locale locale) {
    return SynchronousFuture<PassengerLocalizations>(
      lookupPassengerLocalizations(locale),
    );
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['ar', 'en'].contains(locale.languageCode);

  @override
  bool shouldReload(_PassengerLocalizationsDelegate old) => false;
}

PassengerLocalizations lookupPassengerLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'ar':
      return PassengerLocalizationsAr();
    case 'en':
      return PassengerLocalizationsEn();
  }

  throw FlutterError(
    'PassengerLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
