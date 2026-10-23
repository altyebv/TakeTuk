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
  /// **'Next: add your vehicle and upload your documents.'**
  String get statusApplicant;

  /// No description provided for @statusPendingReview.
  ///
  /// In en, this message translates to:
  /// **'Your application is being reviewed.'**
  String get statusPendingReview;

  /// No description provided for @statusApproved.
  ///
  /// In en, this message translates to:
  /// **'You are approved. Go online to receive ride offers.'**
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

  /// No description provided for @documentsTitle.
  ///
  /// In en, this message translates to:
  /// **'Your documents'**
  String get documentsTitle;

  /// No description provided for @vehicleTitle.
  ///
  /// In en, this message translates to:
  /// **'Your vehicle'**
  String get vehicleTitle;

  /// No description provided for @docDriverPhoto.
  ///
  /// In en, this message translates to:
  /// **'Your photo'**
  String get docDriverPhoto;

  /// No description provided for @docDrivingLicense.
  ///
  /// In en, this message translates to:
  /// **'Driving licence'**
  String get docDrivingLicense;

  /// No description provided for @docNationalId.
  ///
  /// In en, this message translates to:
  /// **'National ID'**
  String get docNationalId;

  /// No description provided for @docVehicleRegistration.
  ///
  /// In en, this message translates to:
  /// **'Vehicle registration'**
  String get docVehicleRegistration;

  /// No description provided for @docVehiclePhoto.
  ///
  /// In en, this message translates to:
  /// **'Vehicle photo'**
  String get docVehiclePhoto;

  /// No description provided for @docUploaded.
  ///
  /// In en, this message translates to:
  /// **'Uploaded'**
  String get docUploaded;

  /// No description provided for @docMissing.
  ///
  /// In en, this message translates to:
  /// **'Not uploaded yet'**
  String get docMissing;

  /// No description provided for @upload.
  ///
  /// In en, this message translates to:
  /// **'Upload'**
  String get upload;

  /// No description provided for @replace.
  ///
  /// In en, this message translates to:
  /// **'Replace'**
  String get replace;

  /// No description provided for @takePhoto.
  ///
  /// In en, this message translates to:
  /// **'Take a photo'**
  String get takePhoto;

  /// No description provided for @chooseFromGallery.
  ///
  /// In en, this message translates to:
  /// **'Choose from gallery'**
  String get chooseFromGallery;

  /// No description provided for @addVehicle.
  ///
  /// In en, this message translates to:
  /// **'Add your vehicle'**
  String get addVehicle;

  /// No description provided for @vehicleTypeLabel.
  ///
  /// In en, this message translates to:
  /// **'Vehicle type'**
  String get vehicleTypeLabel;

  /// No description provided for @plateLabel.
  ///
  /// In en, this message translates to:
  /// **'Plate number'**
  String get plateLabel;

  /// No description provided for @vehicleDescriptionLabel.
  ///
  /// In en, this message translates to:
  /// **'Description (optional), e.g. colour'**
  String get vehicleDescriptionLabel;

  /// No description provided for @save.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get save;

  /// No description provided for @vehicleStatusPendingReview.
  ///
  /// In en, this message translates to:
  /// **'Waiting for review'**
  String get vehicleStatusPendingReview;

  /// No description provided for @vehicleStatusApproved.
  ///
  /// In en, this message translates to:
  /// **'Approved'**
  String get vehicleStatusApproved;

  /// No description provided for @vehicleStatusRejected.
  ///
  /// In en, this message translates to:
  /// **'Not approved'**
  String get vehicleStatusRejected;

  /// No description provided for @vehicleStatusSuspended.
  ///
  /// In en, this message translates to:
  /// **'Suspended'**
  String get vehicleStatusSuspended;

  /// No description provided for @vehicleStatusUnknown.
  ///
  /// In en, this message translates to:
  /// **'Unknown status'**
  String get vehicleStatusUnknown;

  /// No description provided for @submitForReview.
  ///
  /// In en, this message translates to:
  /// **'Submit for review'**
  String get submitForReview;

  /// No description provided for @submitHelp.
  ///
  /// In en, this message translates to:
  /// **'Upload every document and add your vehicle, then submit. We review applications before you can take rides.'**
  String get submitHelp;

  /// No description provided for @resubmitHelp.
  ///
  /// In en, this message translates to:
  /// **'Fix what the reviewer noted, then submit again.'**
  String get resubmitHelp;

  /// No description provided for @errorRequirementsNotMet.
  ///
  /// In en, this message translates to:
  /// **'Some documents or the vehicle are still missing.'**
  String get errorRequirementsNotMet;

  /// No description provided for @errorVehicleAlreadyRegistered.
  ///
  /// In en, this message translates to:
  /// **'This vehicle is already registered.'**
  String get errorVehicleAlreadyRegistered;

  /// No description provided for @errorVehicleNotEligible.
  ///
  /// In en, this message translates to:
  /// **'This vehicle cannot be used for this service.'**
  String get errorVehicleNotEligible;

  /// No description provided for @online.
  ///
  /// In en, this message translates to:
  /// **'Online'**
  String get online;

  /// No description provided for @offline.
  ///
  /// In en, this message translates to:
  /// **'Offline'**
  String get offline;

  /// No description provided for @goOnline.
  ///
  /// In en, this message translates to:
  /// **'Go online'**
  String get goOnline;

  /// No description provided for @goOffline.
  ///
  /// In en, this message translates to:
  /// **'Go offline'**
  String get goOffline;

  /// No description provided for @onlineHelp.
  ///
  /// In en, this message translates to:
  /// **'You receive ride offers while you are online and the app is open.'**
  String get onlineHelp;

  /// No description provided for @chooseVehicle.
  ///
  /// In en, this message translates to:
  /// **'Vehicle for this shift'**
  String get chooseVehicle;

  /// No description provided for @noApprovedVehicle.
  ///
  /// In en, this message translates to:
  /// **'You need an approved vehicle to go online.'**
  String get noApprovedVehicle;

  /// No description provided for @locationOff.
  ///
  /// In en, this message translates to:
  /// **'Your location is not available. Turn on location to receive offers.'**
  String get locationOff;

  /// No description provided for @waitingForOffers.
  ///
  /// In en, this message translates to:
  /// **'Waiting for ride offers…'**
  String get waitingForOffers;

  /// No description provided for @offerFrom.
  ///
  /// In en, this message translates to:
  /// **'{passenger} offers {amount}'**
  String offerFrom(String passenger, String amount);

  /// No description provided for @offerTrip.
  ///
  /// In en, this message translates to:
  /// **'{toPickup} to pickup · trip {trip}'**
  String offerTrip(String toPickup, String trip);

  /// No description provided for @offerMinimum.
  ///
  /// In en, this message translates to:
  /// **'Minimum fare {amount}'**
  String offerMinimum(String amount);

  /// No description provided for @offerCountered.
  ///
  /// In en, this message translates to:
  /// **'You proposed {amount}. Waiting for the passenger.'**
  String offerCountered(String amount);

  /// No description provided for @acceptOffer.
  ///
  /// In en, this message translates to:
  /// **'Accept'**
  String get acceptOffer;

  /// No description provided for @declineOffer.
  ///
  /// In en, this message translates to:
  /// **'Decline'**
  String get declineOffer;

  /// No description provided for @proposeFare.
  ///
  /// In en, this message translates to:
  /// **'Propose a fare'**
  String get proposeFare;

  /// No description provided for @proposeFareTitle.
  ///
  /// In en, this message translates to:
  /// **'Your fare'**
  String get proposeFareTitle;

  /// No description provided for @proposeFareHelp.
  ///
  /// In en, this message translates to:
  /// **'It must be higher than the passenger\'s offer.'**
  String get proposeFareHelp;

  /// No description provided for @send.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get send;

  /// No description provided for @cancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// No description provided for @km.
  ///
  /// In en, this message translates to:
  /// **'{value} km'**
  String km(String value);

  /// No description provided for @tripToPickup.
  ///
  /// In en, this message translates to:
  /// **'Go to the pickup'**
  String get tripToPickup;

  /// No description provided for @tripAtPickup.
  ///
  /// In en, this message translates to:
  /// **'Waiting for the passenger'**
  String get tripAtPickup;

  /// No description provided for @tripInProgress.
  ///
  /// In en, this message translates to:
  /// **'Trip in progress'**
  String get tripInProgress;

  /// No description provided for @tripCompleted.
  ///
  /// In en, this message translates to:
  /// **'Trip completed'**
  String get tripCompleted;

  /// No description provided for @tripCancelled.
  ///
  /// In en, this message translates to:
  /// **'This ride was cancelled'**
  String get tripCancelled;

  /// No description provided for @arrived.
  ///
  /// In en, this message translates to:
  /// **'I have arrived'**
  String get arrived;

  /// No description provided for @startTrip.
  ///
  /// In en, this message translates to:
  /// **'Start trip'**
  String get startTrip;

  /// No description provided for @completeTrip.
  ///
  /// In en, this message translates to:
  /// **'Complete trip'**
  String get completeTrip;

  /// No description provided for @cancelRide.
  ///
  /// In en, this message translates to:
  /// **'Cancel ride'**
  String get cancelRide;

  /// No description provided for @cancelReasonRequired.
  ///
  /// In en, this message translates to:
  /// **'Reason (required)'**
  String get cancelReasonRequired;

  /// No description provided for @errorReasonTooShort.
  ///
  /// In en, this message translates to:
  /// **'Enter at least 3 characters.'**
  String get errorReasonTooShort;

  /// No description provided for @keepRide.
  ///
  /// In en, this message translates to:
  /// **'Keep ride'**
  String get keepRide;

  /// No description provided for @callPassenger.
  ///
  /// In en, this message translates to:
  /// **'Call passenger'**
  String get callPassenger;

  /// No description provided for @pickupPoint.
  ///
  /// In en, this message translates to:
  /// **'Pickup'**
  String get pickupPoint;

  /// No description provided for @destinationPoint.
  ///
  /// In en, this message translates to:
  /// **'Destination'**
  String get destinationPoint;

  /// No description provided for @fareToCollect.
  ///
  /// In en, this message translates to:
  /// **'Collect {amount} in cash'**
  String fareToCollect(String amount);

  /// No description provided for @collectedFull.
  ///
  /// In en, this message translates to:
  /// **'Collected {amount}'**
  String collectedFull(String amount);

  /// No description provided for @collectedOther.
  ///
  /// In en, this message translates to:
  /// **'Collected a different amount'**
  String get collectedOther;

  /// No description provided for @notCollected.
  ///
  /// In en, this message translates to:
  /// **'The passenger did not pay'**
  String get notCollected;

  /// No description provided for @amountLabel.
  ///
  /// In en, this message translates to:
  /// **'Amount ({currency})'**
  String amountLabel(String currency);

  /// No description provided for @paymentRecorded.
  ///
  /// In en, this message translates to:
  /// **'Payment recorded.'**
  String get paymentRecorded;

  /// No description provided for @done.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get done;

  /// No description provided for @earnings.
  ///
  /// In en, this message translates to:
  /// **'Earnings'**
  String get earnings;

  /// No description provided for @commissionOwed.
  ///
  /// In en, this message translates to:
  /// **'Commission owed: {amount}'**
  String commissionOwed(String amount);

  /// No description provided for @noCommissionOwed.
  ///
  /// In en, this message translates to:
  /// **'No commission owed.'**
  String get noCommissionOwed;

  /// No description provided for @noEarnings.
  ///
  /// In en, this message translates to:
  /// **'No completed rides yet.'**
  String get noEarnings;

  /// No description provided for @earningLine.
  ///
  /// In en, this message translates to:
  /// **'Fare {fare} · commission {commission}'**
  String earningLine(String fare, String commission);

  /// No description provided for @loadMore.
  ///
  /// In en, this message translates to:
  /// **'Show more'**
  String get loadMore;

  /// No description provided for @errorOfferGone.
  ///
  /// In en, this message translates to:
  /// **'This offer is no longer available.'**
  String get errorOfferGone;

  /// No description provided for @errorBelowMinimum.
  ///
  /// In en, this message translates to:
  /// **'Your fare must be at least the minimum fare.'**
  String get errorBelowMinimum;

  /// No description provided for @errorNotAboveProposal.
  ///
  /// In en, this message translates to:
  /// **'Your fare must be higher than the passenger\'s offer.'**
  String get errorNotAboveProposal;

  /// No description provided for @errorBusy.
  ///
  /// In en, this message translates to:
  /// **'You already have an active ride.'**
  String get errorBusy;

  /// No description provided for @errorNotAvailable.
  ///
  /// In en, this message translates to:
  /// **'Go online to accept offers.'**
  String get errorNotAvailable;

  /// No description provided for @errorPaymentReported.
  ///
  /// In en, this message translates to:
  /// **'This payment was already reported.'**
  String get errorPaymentReported;
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
