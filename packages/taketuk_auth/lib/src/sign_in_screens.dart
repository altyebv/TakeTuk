import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

import 'auth_gateway.dart';
import 'l10n/taketuk_auth_localizations.dart';
import 'phone.dart';

String _failureMessage(BuildContext context, AuthFailure failure) {
  final auth = TaketukAuthLocalizations.of(context);
  final ui = TaketukUiLocalizations.of(context);
  return switch (failure.kind) {
    AuthFailureKind.invalidPhone => auth.errorInvalidPhone,
    AuthFailureKind.invalidCode => auth.errorInvalidCode,
    AuthFailureKind.rateLimited => ui.errorRateLimited,
    AuthFailureKind.network => ui.errorNetwork,
    AuthFailureKind.unavailable => ui.errorServiceUnavailable,
  };
}

/// Sign-in step 1: the phone number. Calls [onCodeSent] with the E.164 number once an SMS code
/// has been requested.
class PhoneEntryScreen extends StatefulWidget {
  const PhoneEntryScreen({
    required this.auth,
    required this.onCodeSent,
    this.heading,
    super.key,
  });

  final AuthGateway auth;
  final void Function(String phoneE164) onCodeSent;

  /// Shown above the form, for example the app's name.
  final String? heading;

  @override
  State<PhoneEntryScreen> createState() => _PhoneEntryScreenState();
}

class _PhoneEntryScreenState extends State<PhoneEntryScreen> {
  final _phone = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final phone = normalizeSudanMobile(_phone.text);
    if (phone == null) {
      setState(
        () => _error = TaketukAuthLocalizations.of(context).errorInvalidPhone,
      );
      return;
    }
    setState(() => _error = null);
    try {
      await widget.auth.requestCode(phone);
      widget.onCodeSent(phone);
    } on AuthFailure catch (failure) {
      if (mounted) setState(() => _error = _failureMessage(context, failure));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = TaketukAuthLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.signInTitle)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            if (widget.heading case final heading?)
              Padding(
                padding: const EdgeInsets.only(bottom: 24),
                child: Text(
                  heading,
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
              ),
            TextField(
              key: const Key('phone'),
              controller: _phone,
              keyboardType: TextInputType.phone,
              autofillHints: const [AutofillHints.telephoneNumber],
              // Phone numbers read left to right in Arabic too.
              textDirection: TextDirection.ltr,
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9٠-٩۰-۹+\s-]')),
              ],
              decoration: InputDecoration(
                labelText: l10n.phoneLabel,
                hintText: l10n.phoneHint,
                helperText: l10n.phoneHelp,
                errorText: _error,
              ),
              onSubmitted: (_) => _send(),
            ),
            const SizedBox(height: 24),
            BusyButton(label: l10n.sendCode, onPressed: _send),
          ],
        ),
      ),
    );
  }
}

/// Sign-in step 2: the SMS code. On success the [AuthGateway] emits the signed-in user; the
/// session and navigation react to that, so this screen has no success callback.
class CodeEntryScreen extends StatefulWidget {
  const CodeEntryScreen({
    required this.auth,
    required this.phoneE164,
    required this.onChangeNumber,
    super.key,
  });

  final AuthGateway auth;
  final String phoneE164;
  final VoidCallback onChangeNumber;

  @override
  State<CodeEntryScreen> createState() => _CodeEntryScreenState();
}

class _CodeEntryScreenState extends State<CodeEntryScreen> {
  final _code = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    final code = _code.text.trim();
    if (code.isEmpty) return;
    setState(() => _error = null);
    try {
      await widget.auth.verifyCode(phoneE164: widget.phoneE164, code: code);
    } on AuthFailure catch (failure) {
      if (mounted) setState(() => _error = _failureMessage(context, failure));
    }
  }

  Future<void> _resend() async {
    final l10n = TaketukAuthLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await widget.auth.requestCode(widget.phoneE164);
      messenger.showSnackBar(SnackBar(content: Text(l10n.codeResent)));
    } on AuthFailure catch (failure) {
      if (mounted) setState(() => _error = _failureMessage(context, failure));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = TaketukAuthLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.codeTitle)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text(l10n.codeSentTo(isolateLtr(widget.phoneE164))),
            const SizedBox(height: 16),
            TextField(
              key: const Key('code'),
              controller: _code,
              keyboardType: TextInputType.number,
              autofillHints: const [AutofillHints.oneTimeCode],
              textDirection: TextDirection.ltr,
              maxLength: 10,
              decoration: InputDecoration(
                labelText: l10n.codeLabel,
                errorText: _error,
              ),
              onSubmitted: (_) => _verify(),
            ),
            const SizedBox(height: 16),
            BusyButton(label: l10n.verify, onPressed: _verify),
            const SizedBox(height: 8),
            TextButton(onPressed: _resend, child: Text(l10n.resendCode)),
            TextButton(
              onPressed: widget.onChangeNumber,
              child: Text(l10n.changeNumber),
            ),
          ],
        ),
      ),
    );
  }
}
