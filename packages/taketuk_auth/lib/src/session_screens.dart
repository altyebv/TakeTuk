import 'package:flutter/material.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

import 'l10n/taketuk_auth_localizations.dart';
import 'session_controller.dart';

/// Shown while a persisted session is restored or the account loads.
class StartingScreen extends StatelessWidget {
  const StartingScreen({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: Semantics(
        label: TaketukAuthLocalizations.of(context).loading,
        child: const CircularProgressIndicator(),
      ),
    ),
  );
}

/// Signed in, but `GET /v1/me` failed: retry, or sign out.
class AccountErrorScreen extends StatelessWidget {
  const AccountErrorScreen({required this.session, super.key});

  final SessionController session;

  @override
  Widget build(BuildContext context) {
    final l10n = TaketukAuthLocalizations.of(context);
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text(
              l10n.accountErrorTitle,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 16),
            if (session.error case final error?) ErrorMessage(error),
            const SizedBox(height: 24),
            BusyButton(
              label: TaketukUiLocalizations.of(context).retry,
              onPressed: session.reloadAccount,
            ),
            TextButton(onPressed: session.signOut, child: Text(l10n.signOut)),
          ],
        ),
      ),
    );
  }
}

/// Replaces the app when the build configuration is invalid (MANIFESTO §3.8: fail loudly).
/// Developer-facing, so not localized.
class ConfigurationErrorApp extends StatelessWidget {
  const ConfigurationErrorApp(this.problems, {super.key});

  final List<String> problems;

  @override
  Widget build(BuildContext context) => MaterialApp(
    home: Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const Text(
              'This build is misconfigured',
              style: TextStyle(fontSize: 22),
            ),
            const SizedBox(height: 12),
            for (final problem in problems) Text('• $problem'),
            const SizedBox(height: 12),
            const Text(
              'See apps/README.md for the --dart-define-from-file settings.',
            ),
          ],
        ),
      ),
    ),
  );
}
