import 'package:flutter/material.dart';
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_auth/taketuk_auth.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

import 'l10n/driver_localizations.dart';

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

/// Home: the applicant's review status (`GET /v1/driver/profile`). Going online, offers and
/// trips arrive with roadmap phase 10.
class HomeScreen extends StatefulWidget {
  const HomeScreen({required this.api, required this.session, super.key});

  final TaketukApi api;
  final SessionController session;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late Future<DriverProfile> _profile = widget.api.drivers.getProfile();

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
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.appName),
        actions: [
          IconButton(
            tooltip: l10n.signOut,
            icon: const Icon(Icons.logout),
            onPressed: widget.session.signOut,
          ),
        ],
      ),
      body: SafeArea(
        child: FutureBuilder<DriverProfile>(
          future: _profile,
          builder: (context, snapshot) => ListView(
            padding: const EdgeInsets.all(24),
            children: [
              Text(
                l10n.homeGreeting(widget.session.me?.displayName ?? ''),
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 16),
              switch (snapshot) {
                AsyncSnapshot(hasError: true, :final error?) => Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    ErrorMessage(error),
                    const SizedBox(height: 16),
                    BusyButton(
                      label: TaketukUiLocalizations.of(context).retry,
                      onPressed: () async {
                        setState(
                          () => _profile = widget.api.drivers.getProfile(),
                        );
                        await _profile.then((_) {}, onError: (_) {});
                      },
                    ),
                  ],
                ),
                AsyncSnapshot(hasData: true, :final data?) => Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          key: const Key('status'),
                          _statusText(l10n, data.status),
                        ),
                        if (data.reviewNote case final note?
                            when data.status == DriverProfileStatus.rejected)
                          Text(l10n.reviewNote(note)),
                      ],
                    ),
                  ),
                ),
                _ => const Center(child: CircularProgressIndicator()),
              },
            ],
          ),
        ),
      ),
    );
  }
}
