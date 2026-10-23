import 'dart:convert';

import 'package:flutter/foundation.dart';

/// Build-time configuration of a TAKE-TUK app, from `--dart-define` or `--dart-define-from-file`
/// (see apps/README.md). Only public values belong here: the API URL, the Supabase project URL
/// and its publishable key. Never a secret or service-role key (docs/security/SECURITY.md §4).
@immutable
final class ClientConfig {
  const ClientConfig({
    required this.apiBaseUrl,
    required this.supabaseUrl,
    required this.supabasePublishableKey,
    required this.problems,
  });

  factory ClientConfig.fromEnvironment() => ClientConfig.validate(
    apiBaseUrl: const String.fromEnvironment('API_BASE_URL'),
    supabaseUrl: const String.fromEnvironment('SUPABASE_URL'),
    supabasePublishableKey: const String.fromEnvironment(
      'SUPABASE_PUBLISHABLE_KEY',
    ),
    release: kReleaseMode,
  );

  /// Checks the values; [problems] lists everything wrong, and the app refuses to start on any.
  factory ClientConfig.validate({
    required String apiBaseUrl,
    required String supabaseUrl,
    required String supabasePublishableKey,
    required bool release,
  }) {
    final problems = <String>[];
    Uri? url(String name, String value) {
      final uri = Uri.tryParse(value);
      if (value.isEmpty || uri == null || !uri.hasScheme || uri.host.isEmpty) {
        problems.add('$name must be an absolute URL');
        return null;
      }
      if (uri.scheme != 'https' && (release || uri.scheme != 'http')) {
        problems.add(
          '$name must use https${release ? ' in release builds' : ' or http'}',
        );
      }
      return uri;
    }

    final api = url('API_BASE_URL', apiBaseUrl);
    final supabase = url('SUPABASE_URL', supabaseUrl);
    if (supabasePublishableKey.isEmpty) {
      problems.add('SUPABASE_PUBLISHABLE_KEY is required');
    } else if (isPrivilegedSupabaseKey(supabasePublishableKey)) {
      problems.add(
        'SUPABASE_PUBLISHABLE_KEY is a secret or service-role key; apps may only embed the '
        'publishable (anon) key',
      );
    }
    return ClientConfig(
      apiBaseUrl: api ?? Uri(),
      supabaseUrl: supabase ?? Uri(),
      supabasePublishableKey: supabasePublishableKey,
      problems: problems,
    );
  }

  final Uri apiBaseUrl;
  final Uri supabaseUrl;
  final String supabasePublishableKey;
  final List<String> problems;
}

/// True for Supabase keys that bypass row-level security: new-style secret keys
/// (`sb_secret_…`) and legacy JWT keys whose role is `service_role`.
bool isPrivilegedSupabaseKey(String key) {
  if (key.startsWith('sb_secret_')) return true;
  final parts = key.split('.');
  if (parts.length != 3) return false;
  try {
    final payload = jsonDecode(
      utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))),
    );
    return payload is Map<String, Object?> && payload['role'] == 'service_role';
  } on FormatException {
    return false;
  }
}
