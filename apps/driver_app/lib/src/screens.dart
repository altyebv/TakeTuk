import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_auth/taketuk_auth.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

import 'l10n/driver_localizations.dart';
import 'onboarding/documents.dart';
import 'onboarding/onboarding_screen.dart';
import 'work/work_screen.dart';

/// Driver applicant registration (`POST /v1/driver/registration`, idempotent for identical
/// details). Vehicles and documents follow in the onboarding flow (roadmap phase 10).
class RegisterScreen extends StatefulWidget {
  const RegisterScreen({
    required this.api,
    required this.session,
    required this.serviceAreaCode,
    super.key,
  });

  final TaketukApi api;
  final SessionController session;
  final String serviceAreaCode;

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _displayName = TextEditingController();
  final _legalName = TextEditingController();
  final _license = TextEditingController();
  bool _showRequired = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _displayName.text = widget.session.me?.displayName ?? '';
  }

  @override
  void dispose() {
    _displayName.dispose();
    _legalName.dispose();
    _license.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final fields = [
      _displayName,
      _legalName,
      _license,
    ].map((c) => c.text.trim()).toList();
    if (fields.any((f) => f.isEmpty)) {
      setState(() => _showRequired = true);
      return;
    }
    setState(() => _error = null);
    try {
      await widget.api.drivers.register(
        DriversRegisterRequest(
          displayName: fields[0],
          fullLegalName: fields[1],
          drivingLicenseNumber: fields[2],
          serviceAreaCode: widget.serviceAreaCode,
        ),
      );
      // The account now has the driver role.
      await widget.session.reloadAccount();
    } on Object catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Widget _field(TextEditingController controller, String label, Key key) {
    final empty = _showRequired && controller.text.trim().isEmpty;
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: TextField(
        key: key,
        controller: controller,
        decoration: InputDecoration(
          labelText: label,
          errorText: empty
              ? DriverLocalizations.of(context).errorRequired
              : null,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = DriverLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.registerTitle)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text(l10n.registerIntro),
            const SizedBox(height: 16),
            _field(
              _displayName,
              l10n.displayNameLabel,
              const Key('displayName'),
            ),
            _field(_legalName, l10n.legalNameLabel, const Key('legalName')),
            _field(_license, l10n.licenseLabel, const Key('license')),
            if (_error case final error?)
              error is ApiProblem &&
                      error.code == ProblemCodes.alreadyRegistered
                  ? Text(
                      l10n.errorAlreadyRegistered,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    )
                  : ErrorMessage(error),
            const SizedBox(height: 16),
            BusyButton(label: l10n.continueButton, onPressed: _submit),
          ],
        ),
      ),
    );
  }
}

/// Home: what the driver needs to do next, by review status (STATE_MACHINES §6). Applicants and
/// rejected drivers complete their application; approved drivers work; others see their status.
class HomeScreen extends StatefulWidget {
  const HomeScreen({
    required this.api,
    required this.session,
    required this.mapSettings,
    required this.location,
    required this.picker,
    required this.storage,
    required this.onEarnings,
    this.pollInterval = const Duration(seconds: 4),
    this.locationInterval = const Duration(seconds: 15),
    super.key,
  });

  final TaketukApi api;
  final SessionController session;
  final MapSettings mapSettings;
  final DeviceLocation location;
  final DocumentPicker picker;
  final http.Client storage;
  final VoidCallback onEarnings;
  final Duration pollInterval;
  final Duration locationInterval;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late Future<DriverProfile> _profile = widget.api.drivers.getProfile();

  void _reload() {
    // A block body: setState must not return the new Future.
    setState(() {
      _profile = widget.api.drivers.getProfile();
    });
  }

  String _statusText(DriverLocalizations l10n, DriverProfileStatus status) =>
      switch (status) {
        DriverProfileStatus.applicant => l10n.statusApplicant,
        DriverProfileStatus.pendingReview => l10n.statusPendingReview,
        DriverProfileStatus.approved => l10n.statusApproved,
        DriverProfileStatus.rejected => l10n.statusRejected,
        DriverProfileStatus.suspended => l10n.statusSuspended,
        DriverProfileStatus.$unknown => l10n.statusUnknown,
      };

  @override
  Widget build(BuildContext context) {
    final l10n = DriverLocalizations.of(context);
    return FutureBuilder<DriverProfile>(
      future: _profile,
      builder: (context, snapshot) {
        final profile = snapshot.data;
        final approved = profile?.status == DriverProfileStatus.approved;
        return Scaffold(
          appBar: AppBar(
            title: Text(l10n.appName),
            actions: [
              if (approved)
                IconButton(
                  tooltip: l10n.earnings,
                  icon: const Icon(Icons.account_balance_wallet),
                  onPressed: widget.onEarnings,
                ),
              IconButton(
                tooltip: l10n.signOut,
                icon: const Icon(Icons.logout),
                onPressed: widget.session.signOut,
              ),
            ],
          ),
          body: SafeArea(
            child: switch (snapshot) {
              AsyncSnapshot(hasError: true, :final error?) => ListView(
                padding: const EdgeInsets.all(24),
                children: [
                  ErrorMessage(error),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _reload,
                    child: Text(TaketukUiLocalizations.of(context).retry),
                  ),
                ],
              ),
              AsyncSnapshot(hasData: true, data: final profile?) =>
                switch (profile.status) {
                  DriverProfileStatus.applicant ||
                  DriverProfileStatus.rejected => OnboardingScreen(
                    api: widget.api,
                    profile: profile,
                    picker: widget.picker,
                    storage: widget.storage,
                    onSubmitted: (_) => _reload(),
                  ),
                  DriverProfileStatus.approved => WorkScreen(
                    api: widget.api,
                    profile: profile,
                    location: widget.location,
                    mapSettings: widget.mapSettings,
                    pollInterval: widget.pollInterval,
                    locationInterval: widget.locationInterval,
                  ),
                  _ => ListView(
                    padding: const EdgeInsets.all(24),
                    children: [
                      Text(
                        l10n.homeGreeting(widget.session.me?.displayName ?? ''),
                        style: Theme.of(context).textTheme.headlineSmall,
                      ),
                      const SizedBox(height: 16),
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Text(
                            _statusText(l10n, profile.status),
                            key: const Key('status'),
                          ),
                        ),
                      ),
                    ],
                  ),
                },
              _ => const Center(child: CircularProgressIndicator()),
            },
          ),
        );
      },
    );
  }
}
