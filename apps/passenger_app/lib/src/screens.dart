import 'package:flutter/material.dart';
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_auth/taketuk_auth.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

import 'l10n/passenger_localizations.dart';

/// Passenger registration: the display name (`POST /v1/passenger/registration`, idempotent).
class RegisterScreen extends StatefulWidget {
  const RegisterScreen({required this.api, required this.session, super.key});

  final TaketukApi api;
  final SessionController session;

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _name = TextEditingController();
  String? _fieldError;
  Object? _error;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      setState(
        () =>
            _fieldError = PassengerLocalizations.of(context).errorNameRequired,
      );
      return;
    }
    setState(() {
      _fieldError = null;
      _error = null;
    });
    try {
      final me = await widget.api.identity.registerPassenger(
        IdentityRegisterPassengerRequest(displayName: name),
      );
      widget.session.accountUpdated(me);
    } on Object catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = PassengerLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.registerTitle)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text(
              l10n.registerIntro,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 16),
            TextField(
              key: const Key('name'),
              controller: _name,
              textCapitalization: TextCapitalization.words,
              maxLength: 100,
              decoration: InputDecoration(
                labelText: l10n.nameLabel,
                errorText: _fieldError,
              ),
            ),
            if (_error case final error?) ErrorMessage(error),
            const SizedBox(height: 16),
            BusyButton(label: l10n.continueButton, onPressed: _submit),
          ],
        ),
      ),
    );
  }
}

/// Home placeholder until the ride flow (roadmap phase 10).
class HomeScreen extends StatelessWidget {
  const HomeScreen({required this.session, super.key});

  final SessionController session;

  @override
  Widget build(BuildContext context) {
    final l10n = PassengerLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.appName),
        actions: [
          IconButton(
            tooltip: l10n.signOut,
            icon: const Icon(Icons.logout),
            onPressed: session.signOut,
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text(
              l10n.homeGreeting(session.me?.displayName ?? ''),
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 16),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Text(l10n.homeNextPhase),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
