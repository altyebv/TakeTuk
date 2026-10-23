import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

import 'auth_gateway.dart';
import 'client_config.dart';
import 'email.dart';
import 'l10n/taketuk_auth_localizations.dart';
import 'phone.dart';

String _failureMessage(
  BuildContext context,
  AuthFailure failure,
  SignInMethod method,
) {
  final auth = TaketukAuthLocalizations.of(context);
  final ui = TaketukUiLocalizations.of(context);
  return switch (failure.kind) {
    AuthFailureKind.invalidAddress => _invalidAddress(auth, method),
    AuthFailureKind.addressNotAllowed => auth.errorAddressNotAllowed,
    AuthFailureKind.invalidCode => auth.errorInvalidCode,
    AuthFailureKind.rateLimited => ui.errorRateLimited,
    AuthFailureKind.network => ui.errorNetwork,
    AuthFailureKind.unavailable => ui.errorServiceUnavailable,
  };
}

String _invalidAddress(TaketukAuthLocalizations l10n, SignInMethod method) =>
    switch (method) {
      SignInMethod.phone => l10n.errorInvalidPhone,
      SignInMethod.email => l10n.errorInvalidEmail,
    };

SignInMethod _methodOf(SignInAddress address) => switch (address) {
  PhoneAddress() => SignInMethod.phone,
  EmailAddress() => SignInMethod.email,
};

/// Sign-in step 1: the mobile number, or the email address when the build signs in by email
/// ([SignInMethod]). Calls [onCodeSent] with the normalized address once a code has been sent.
class SignInScreen extends StatefulWidget {
  const SignInScreen({
    required this.auth,
    required this.onCodeSent,
    this.method = SignInMethod.phone,
    this.heading,
    super.key,
  });

  final AuthGateway auth;
  final SignInMethod method;
  final void Function(SignInAddress address) onCodeSent;

  /// Shown above the form, for example the app's name.
  final String? heading;

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  final _input = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  SignInAddress? _address() => switch (widget.method) {
    SignInMethod.phone => switch (normalizeSudanMobile(_input.text)) {
      final phone? => PhoneAddress(phone),
      null => null,
    },
    SignInMethod.email => switch (normalizeEmail(_input.text)) {
      final email? => EmailAddress(email),
      null => null,
    },
  };

  Future<void> _send() async {
    final address = _address();
    if (address == null) {
      setState(
        () => _error = _invalidAddress(
          TaketukAuthLocalizations.of(context),
          widget.method,
        ),
      );
      return;
    }
    setState(() => _error = null);
    try {
      await widget.auth.requestCode(address);
      widget.onCodeSent(address);
    } on AuthFailure catch (failure) {
      if (mounted) {
        setState(
          () => _error = _failureMessage(context, failure, widget.method),
        );
      }
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
            switch (widget.method) {
              SignInMethod.phone => TextField(
                key: const Key('phone'),
                controller: _input,
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
              SignInMethod.email => TextField(
                key: const Key('email'),
                controller: _input,
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
                autocorrect: false,
                textDirection: TextDirection.ltr,
                decoration: InputDecoration(
                  labelText: l10n.emailLabel,
                  hintText: l10n.emailHint,
                  helperText: l10n.emailHelp,
                  errorText: _error,
                ),
                onSubmitted: (_) => _send(),
              ),
            },
            const SizedBox(height: 24),
            BusyButton(label: l10n.sendCode, onPressed: _send),
          ],
        ),
      ),
    );
  }
}

/// Sign-in step 2: the code sent to [address]. On success the [AuthGateway] emits the
/// signed-in user; the session and navigation react to that, so this screen has no success
/// callback.
class CodeEntryScreen extends StatefulWidget {
  const CodeEntryScreen({
    required this.auth,
    required this.address,
    required this.onChangeAddress,
    super.key,
  });

  final AuthGateway auth;
  final SignInAddress address;
  final VoidCallback onChangeAddress;

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
      await widget.auth.verifyCode(address: widget.address, code: code);
    } on AuthFailure catch (failure) {
      if (mounted) setState(() => _error = _message(failure));
    }
  }

  Future<void> _resend() async {
    final l10n = TaketukAuthLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await widget.auth.requestCode(widget.address);
      messenger.showSnackBar(SnackBar(content: Text(l10n.codeResent)));
    } on AuthFailure catch (failure) {
      if (mounted) setState(() => _error = _message(failure));
    }
  }

  String _message(AuthFailure failure) =>
      _failureMessage(context, failure, _methodOf(widget.address));

  @override
  Widget build(BuildContext context) {
    final l10n = TaketukAuthLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.codeTitle)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text(l10n.codeSentTo(isolateLtr(widget.address.value))),
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
              onPressed: widget.onChangeAddress,
              child: Text(switch (widget.address) {
                PhoneAddress() => l10n.changeNumber,
                EmailAddress() => l10n.changeEmail,
              }),
            ),
          ],
        ),
      ),
    );
  }
}
