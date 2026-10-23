import 'package:flutter/widgets.dart';
import 'package:intl/intl.dart';
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

import '../l10n/passenger_localizations.dart';

/// A localized message for errors of the ride operations, falling back to the shared messages
/// for problems any operation can return.
String rideErrorMessage(BuildContext context, Object error) {
  final l10n = PassengerLocalizations.of(context);
  return switch (error) {
    ApiProblem(
      code: ProblemCodes.outsideServiceArea || ProblemCodes.serviceNotAvailable,
    ) =>
      l10n.errorOutsideArea,
    ApiProblem(code: ProblemCodes.pickupEqualsDestination) =>
      l10n.errorSamePoint,
    ApiProblem(code: ProblemCodes.noRouteFound) => l10n.errorNoRoute,
    ApiProblem(code: ProblemCodes.pricingNotConfigured) =>
      l10n.errorRidesUnavailable,
    ApiProblem(code: ProblemCodes.fareBelowMinimum) =>
      l10n.errorFareBelowMinimum,
    ApiProblem(
      code: ProblemCodes.quoteExpired ||
          ProblemCodes.quoteAlreadyUsed ||
          ProblemCodes.quoteNotFound,
    ) =>
      l10n.errorQuoteExpired,
    ApiProblem(code: ProblemCodes.rideAlreadyOpen) => l10n.errorRideAlreadyOpen,
    ApiProblem(
      code: ProblemCodes.offerNotFound ||
          ProblemCodes.offerNotOpen ||
          ProblemCodes.offerExpired ||
          ProblemCodes.rideNoLongerAvailable ||
          ProblemCodes.driverNotAvailable ||
          ProblemCodes.driverBusy,
    ) =>
      l10n.errorOfferGone,
    _ => describeError(context, error),
  };
}

/// Statuses in which the ride still needs the passenger's attention.
bool isOpenRide(PassengerRideStatus status) => switch (status) {
  PassengerRideStatus.searching ||
  PassengerRideStatus.driverAssigned ||
  PassengerRideStatus.driverArrived ||
  PassengerRideStatus.inProgress => true,
  _ => false,
};

/// The passenger may cancel until the trip starts (STATE_MACHINES §1).
bool canCancelRide(PassengerRideStatus status) => switch (status) {
  PassengerRideStatus.searching ||
  PassengerRideStatus.driverAssigned ||
  PassengerRideStatus.driverArrived => true,
  _ => false,
};

String rideStatusLabel(
  PassengerLocalizations l10n,
  PassengerRideStatus status,
) => switch (status) {
  PassengerRideStatus.searching => l10n.rideStatusSearching,
  PassengerRideStatus.driverAssigned => l10n.rideStatusAssigned,
  PassengerRideStatus.driverArrived => l10n.rideStatusArrived,
  PassengerRideStatus.inProgress => l10n.rideStatusInProgress,
  PassengerRideStatus.completed => l10n.rideStatusCompleted,
  PassengerRideStatus.cancelled => l10n.rideStatusCancelled,
  PassengerRideStatus.expired => l10n.rideStatusExpired,
  PassengerRideStatus.$unknown => l10n.rideStatusUnknown,
};

String tripSummary(
  BuildContext context,
  int distanceMeters,
  int? durationSeconds,
) {
  final l10n = PassengerLocalizations.of(context);
  final km = NumberFormat.decimalPatternDigits(
    locale: Localizations.localeOf(context).toLanguageTag(),
    decimalDigits: 1,
  ).format(distanceMeters / 1000);
  return durationSeconds == null
      ? l10n.tripDistance(km)
      : l10n.tripSummary(km, (durationSeconds / 60).ceil());
}

String vehicleTypeName(PassengerLocalizations l10n, String code) =>
    code == 'raksha' ? l10n.vehicleRaksha : code;

String formatRideTime(BuildContext context, String timestamp) {
  final time = DateTime.tryParse(timestamp)?.toLocal();
  if (time == null) return timestamp;
  final locale = Localizations.localeOf(context).toLanguageTag();
  return DateFormat.yMMMd(locale).add_jm().format(time);
}
