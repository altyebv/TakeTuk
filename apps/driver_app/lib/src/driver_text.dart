import 'package:flutter/widgets.dart';
import 'package:intl/intl.dart';
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

import 'l10n/driver_localizations.dart';

/// A localized message for errors of the driver operations, falling back to the shared messages
/// for problems any operation can return.
String driverErrorMessage(BuildContext context, Object error) {
  final l10n = DriverLocalizations.of(context);
  return switch (error) {
    ApiProblem(code: ProblemCodes.verificationRequirementsNotMet) =>
      l10n.errorRequirementsNotMet,
    ApiProblem(code: ProblemCodes.vehicleAlreadyRegistered) =>
      l10n.errorVehicleAlreadyRegistered,
    ApiProblem(code: ProblemCodes.vehicleNotEligible) =>
      l10n.errorVehicleNotEligible,
    ApiProblem(
      code: ProblemCodes.offerNotFound ||
          ProblemCodes.offerNotOpen ||
          ProblemCodes.offerExpired ||
          ProblemCodes.rideNoLongerAvailable,
    ) =>
      l10n.errorOfferGone,
    ApiProblem(code: ProblemCodes.fareBelowMinimum) => l10n.errorBelowMinimum,
    ApiProblem(code: ProblemCodes.counterofferNotAboveProposal) =>
      l10n.errorNotAboveProposal,
    ApiProblem(code: ProblemCodes.driverBusy) => l10n.errorBusy,
    ApiProblem(code: ProblemCodes.driverNotAvailable) => l10n.errorNotAvailable,
    ApiProblem(code: ProblemCodes.paymentAlreadyReported) =>
      l10n.errorPaymentReported,
    _ => describeError(context, error),
  };
}

String documentName(
  DriverLocalizations l10n,
  DriverDocumentDocumentType type,
) => switch (type) {
  DriverDocumentDocumentType.driverPhoto => l10n.docDriverPhoto,
  DriverDocumentDocumentType.drivingLicense => l10n.docDrivingLicense,
  DriverDocumentDocumentType.nationalId => l10n.docNationalId,
  DriverDocumentDocumentType.vehicleRegistration => l10n.docVehicleRegistration,
  DriverDocumentDocumentType.vehiclePhoto => l10n.docVehiclePhoto,
  DriverDocumentDocumentType.$unknown => type.value,
};

String vehicleStatusLabel(DriverLocalizations l10n, VehicleStatus status) =>
    switch (status) {
      VehicleStatus.pendingReview => l10n.vehicleStatusPendingReview,
      VehicleStatus.approved => l10n.vehicleStatusApproved,
      VehicleStatus.rejected => l10n.vehicleStatusRejected,
      VehicleStatus.suspended => l10n.vehicleStatusSuspended,
      VehicleStatus.$unknown => l10n.vehicleStatusUnknown,
    };

String kilometres(BuildContext context, int meters) =>
    DriverLocalizations.of(context).km(
      NumberFormat.decimalPatternDigits(
        locale: Localizations.localeOf(context).toLanguageTag(),
        decimalDigits: 1,
      ).format(meters / 1000),
    );

String formatTime(BuildContext context, String timestamp) {
  final time = DateTime.tryParse(timestamp)?.toLocal();
  if (time == null) return timestamp;
  return DateFormat.yMMMd(Localizations.localeOf(context).toLanguageTag())
      .add_jm()
      .format(time);
}
