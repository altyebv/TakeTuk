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
      'Next: add your vehicle and upload your documents.';

  @override
  String get statusPendingReview => 'Your application is being reviewed.';

  @override
  String get statusApproved =>
      'You are approved. Go online to receive ride offers.';

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

  @override
  String get documentsTitle => 'Your documents';

  @override
  String get vehicleTitle => 'Your vehicle';

  @override
  String get docDriverPhoto => 'Your photo';

  @override
  String get docDrivingLicense => 'Driving licence';

  @override
  String get docNationalId => 'National ID';

  @override
  String get docVehicleRegistration => 'Vehicle registration';

  @override
  String get docVehiclePhoto => 'Vehicle photo';

  @override
  String get docUploaded => 'Uploaded';

  @override
  String get docMissing => 'Not uploaded yet';

  @override
  String get upload => 'Upload';

  @override
  String get replace => 'Replace';

  @override
  String get takePhoto => 'Take a photo';

  @override
  String get chooseFromGallery => 'Choose from gallery';

  @override
  String get addVehicle => 'Add your vehicle';

  @override
  String get vehicleTypeLabel => 'Vehicle type';

  @override
  String get plateLabel => 'Plate number';

  @override
  String get vehicleDescriptionLabel => 'Description (optional), e.g. colour';

  @override
  String get save => 'Save';

  @override
  String get vehicleStatusPendingReview => 'Waiting for review';

  @override
  String get vehicleStatusApproved => 'Approved';

  @override
  String get vehicleStatusRejected => 'Not approved';

  @override
  String get vehicleStatusSuspended => 'Suspended';

  @override
  String get vehicleStatusUnknown => 'Unknown status';

  @override
  String get submitForReview => 'Submit for review';

  @override
  String get submitHelp =>
      'Upload every document and add your vehicle, then submit. We review applications before you can take rides.';

  @override
  String get resubmitHelp => 'Fix what the reviewer noted, then submit again.';

  @override
  String get errorRequirementsNotMet =>
      'Some documents or the vehicle are still missing.';

  @override
  String get errorVehicleAlreadyRegistered =>
      'This vehicle is already registered.';

  @override
  String get errorVehicleNotEligible =>
      'This vehicle cannot be used for this service.';

  @override
  String get online => 'Online';

  @override
  String get offline => 'Offline';

  @override
  String get goOnline => 'Go online';

  @override
  String get goOffline => 'Go offline';

  @override
  String get onlineHelp =>
      'You receive ride offers while you are online and the app is open.';

  @override
  String get chooseVehicle => 'Vehicle for this shift';

  @override
  String get noApprovedVehicle => 'You need an approved vehicle to go online.';

  @override
  String get locationOff =>
      'Your location is not available. Turn on location to receive offers.';

  @override
  String get waitingForOffers => 'Waiting for ride offers…';

  @override
  String offerFrom(String passenger, String amount) {
    return '$passenger offers $amount';
  }

  @override
  String offerTrip(String toPickup, String trip) {
    return '$toPickup to pickup · trip $trip';
  }

  @override
  String offerMinimum(String amount) {
    return 'Minimum fare $amount';
  }

  @override
  String offerCountered(String amount) {
    return 'You proposed $amount. Waiting for the passenger.';
  }

  @override
  String get acceptOffer => 'Accept';

  @override
  String get declineOffer => 'Decline';

  @override
  String get proposeFare => 'Propose a fare';

  @override
  String get proposeFareTitle => 'Your fare';

  @override
  String get proposeFareHelp =>
      'It must be higher than the passenger\'s offer.';

  @override
  String get send => 'Send';

  @override
  String get cancel => 'Cancel';

  @override
  String km(String value) {
    return '$value km';
  }

  @override
  String get tripToPickup => 'Go to the pickup';

  @override
  String get tripAtPickup => 'Waiting for the passenger';

  @override
  String get tripInProgress => 'Trip in progress';

  @override
  String get tripCompleted => 'Trip completed';

  @override
  String get tripCancelled => 'This ride was cancelled';

  @override
  String get arrived => 'I have arrived';

  @override
  String get startTrip => 'Start trip';

  @override
  String get completeTrip => 'Complete trip';

  @override
  String get cancelRide => 'Cancel ride';

  @override
  String get cancelReasonRequired => 'Reason (required)';

  @override
  String get errorReasonTooShort => 'Enter at least 3 characters.';

  @override
  String get keepRide => 'Keep ride';

  @override
  String get callPassenger => 'Call passenger';

  @override
  String get pickupPoint => 'Pickup';

  @override
  String get destinationPoint => 'Destination';

  @override
  String fareToCollect(String amount) {
    return 'Collect $amount in cash';
  }

  @override
  String collectedFull(String amount) {
    return 'Collected $amount';
  }

  @override
  String get collectedOther => 'Collected a different amount';

  @override
  String get notCollected => 'The passenger did not pay';

  @override
  String amountLabel(String currency) {
    return 'Amount ($currency)';
  }

  @override
  String get paymentRecorded => 'Payment recorded.';

  @override
  String get done => 'Done';

  @override
  String get earnings => 'Earnings';

  @override
  String commissionOwed(String amount) {
    return 'Commission owed: $amount';
  }

  @override
  String get noCommissionOwed => 'No commission owed.';

  @override
  String get noEarnings => 'No completed rides yet.';

  @override
  String earningLine(String fare, String commission) {
    return 'Fare $fare · commission $commission';
  }

  @override
  String get loadMore => 'Show more';

  @override
  String get errorOfferGone => 'This offer is no longer available.';

  @override
  String get errorBelowMinimum =>
      'Your fare must be at least the minimum fare.';

  @override
  String get errorNotAboveProposal =>
      'Your fare must be higher than the passenger\'s offer.';

  @override
  String get errorBusy => 'You already have an active ride.';

  @override
  String get errorNotAvailable => 'Go online to accept offers.';

  @override
  String get errorPaymentReported => 'This payment was already reported.';
}
