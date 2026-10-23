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
  String get signOut => 'Sign out';

  @override
  String get myRides => 'My rides';

  @override
  String get noRides => 'No rides yet.';

  @override
  String get setPickup => 'Pickup';

  @override
  String get setDestination => 'Destination';

  @override
  String get tapForPickup => 'Tap the map to set your pickup point.';

  @override
  String get tapForDestination => 'Tap the map to set your destination.';

  @override
  String get useMyLocation => 'Use my location';

  @override
  String get locationUnavailable =>
      'Your location is not available. Place the pickup on the map.';

  @override
  String get pickupNameLabel => 'Pickup place name (optional)';

  @override
  String get destinationNameLabel => 'Destination place name (optional)';

  @override
  String get seePrice => 'See price';

  @override
  String minimumFare(String amount) {
    return 'Minimum fare: $amount';
  }

  @override
  String tripSummary(String distance, int minutes) {
    return '$distance km · about $minutes min';
  }

  @override
  String yourOffer(String amount) {
    return 'Your offer: $amount';
  }

  @override
  String get offerHelp =>
      'Drivers can accept your offer or propose a higher fare.';

  @override
  String get lowerOffer => 'Lower offer';

  @override
  String get raiseOffer => 'Raise offer';

  @override
  String get requestRide => 'Request ride';

  @override
  String get changeTrip => 'Change trip';

  @override
  String get searchingTitle => 'Looking for a driver';

  @override
  String driversNotified(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count drivers notified',
      one: '1 driver notified',
      zero: 'No drivers notified yet',
    );
    return '$_temp0';
  }

  @override
  String get counteroffersTitle => 'Drivers\' offers';

  @override
  String counteroffer(String driver, String amount) {
    return '$driver offers $amount';
  }

  @override
  String get acceptOffer => 'Accept';

  @override
  String get rejectOffer => 'Decline';

  @override
  String get cancelRide => 'Cancel ride';

  @override
  String get cancelRideQuestion => 'Cancel this ride?';

  @override
  String get cancelReasonLabel => 'Reason (optional)';

  @override
  String get keepRide => 'Keep ride';

  @override
  String statusAssigned(String driver) {
    return '$driver is on the way';
  }

  @override
  String get statusArrived => 'Your driver has arrived';

  @override
  String get statusInProgress => 'On the way to your destination';

  @override
  String get statusCompleted => 'You have arrived';

  @override
  String payCash(String amount) {
    return 'Pay $amount in cash';
  }

  @override
  String get statusCancelled => 'This ride was cancelled';

  @override
  String get statusExpired => 'No driver accepted in time';

  @override
  String get statusUnknown =>
      'This ride\'s status cannot be shown in this version. Please update the app.';

  @override
  String agreedFare(String amount) {
    return 'Fare: $amount';
  }

  @override
  String vehicle(String type, String plate) {
    return '$type · $plate';
  }

  @override
  String get vehicleRaksha => 'Raksha';

  @override
  String get callDriver => 'Call driver';

  @override
  String get newRide => 'Request a new ride';

  @override
  String get errorOutsideArea =>
      'TAKE-TUK is not available there yet. Choose points inside the service area.';

  @override
  String get errorSamePoint => 'Pickup and destination are the same place.';

  @override
  String get errorNoRoute =>
      'We could not find a road route there. Move the points closer to a road.';

  @override
  String get errorRidesUnavailable => 'Rides are not available right now.';

  @override
  String get errorFareBelowMinimum =>
      'Your offer must be at least the minimum fare.';

  @override
  String get errorQuoteExpired =>
      'The price has expired. Check the price again.';

  @override
  String get errorRideAlreadyOpen => 'You already have a ride in progress.';

  @override
  String get errorOfferGone => 'This offer is no longer available.';

  @override
  String tripDistance(String distance) {
    return '$distance km';
  }

  @override
  String get loadMore => 'Show more';

  @override
  String get rideStatusSearching => 'Searching';

  @override
  String get rideStatusAssigned => 'Driver on the way';

  @override
  String get rideStatusArrived => 'Driver arrived';

  @override
  String get rideStatusInProgress => 'In progress';

  @override
  String get rideStatusCompleted => 'Completed';

  @override
  String get rideStatusCancelled => 'Cancelled';

  @override
  String get rideStatusExpired => 'Expired';

  @override
  String get rideStatusUnknown => 'Unknown';
}
