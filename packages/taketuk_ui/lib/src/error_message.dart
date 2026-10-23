import 'package:flutter/material.dart';
import 'package:taketuk_api/taketuk_api.dart';

import 'l10n/taketuk_ui_localizations.dart';

/// A localized, user-facing message for an error from the API client.
///
/// Screens handle the problem codes of their own operations first (for example
/// `FARE_BELOW_MINIMUM`); this covers what any operation can return. Problem titles and details
/// from the server are never shown: they are English and meant for logs.
String describeError(BuildContext context, Object error) {
  final l10n = TaketukUiLocalizations.of(context);
  return switch (error) {
    ApiProblem(code: ProblemCodes.authenticationRequired) =>
      l10n.errorSignedOut,
    ApiProblem(code: ProblemCodes.accountDisabled) => l10n.errorAccountDisabled,
    ApiProblem(code: ProblemCodes.rateLimited) => l10n.errorRateLimited,
    ApiProblem(code: ProblemCodes.validationFailed) => l10n.errorValidation,
    ApiProblem(status: >= 500) => l10n.errorServiceUnavailable,
    ApiUnavailable(reachedServer: true) => l10n.errorServiceUnavailable,
    ApiUnavailable() => l10n.errorNetwork,
    ApiContractViolation() => l10n.errorUpdateRequired,
    _ => l10n.errorGeneric,
  };
}

/// The support reference for an error, when the server assigned one.
String? supportReference(BuildContext context, Object error) => switch (error) {
  ApiProblem(:final requestId?) => TaketukUiLocalizations.of(
    context,
  ).supportReference(requestId),
  _ => null,
};

/// An inline error: the message and, when available, the support reference.
class ErrorMessage extends StatelessWidget {
  const ErrorMessage(this.error, {super.key});

  final Object error;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final reference = supportReference(context, error);
    return Semantics(
      liveRegion: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            describeError(context, error),
            style: theme.textTheme.bodyLarge?.copyWith(
              color: theme.colorScheme.error,
            ),
          ),
          if (reference != null)
            Text(reference, style: theme.textTheme.bodySmall),
        ],
      ),
    );
  }
}
