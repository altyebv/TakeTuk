import 'dart:convert';

import 'package:flutter/foundation.dart';

/// How users receive sign-in codes (`SIGN_IN_METHOD`).
enum SignInMethod {
  /// By SMS to a Sudanese mobile number (ADR-0004). The default.
  phone,

  /// By email. Development builds only, while SMS delivery is unavailable (OPEN_DECISIONS IDN-6).
  email,
}

/// Build-time configuration of a TAKE-TUK app, from `--dart-define` or `--dart-define-from-file`
/// (see apps/README.md). Only public values belong here: the API URL, the Supabase project URL
/// and its publishable key, the sign-in method and the map tile provider. Never a secret or
/// service-role key (docs/security/SECURITY.md §4).
@immutable
final class ClientConfig {
  const ClientConfig({
    required this.apiBaseUrl,
    required this.supabaseUrl,
    required this.supabasePublishableKey,
    required this.signInMethod,
    required this.mapTileUrlTemplate,
    required this.mapAttribution,
    required this.problems,
  });

  factory ClientConfig.fromEnvironment() => ClientConfig.validate(
    apiBaseUrl: const String.fromEnvironment('API_BASE_URL'),
    supabaseUrl: const String.fromEnvironment('SUPABASE_URL'),
    supabasePublishableKey: const String.fromEnvironment(
      'SUPABASE_PUBLISHABLE_KEY',
    ),
    signInMethod: const String.fromEnvironment('SIGN_IN_METHOD'),
    mapTileUrl: const String.fromEnvironment('MAP_TILE_URL'),
    mapAttribution: const String.fromEnvironment('MAP_ATTRIBUTION'),
    release: kReleaseMode,
  );

  /// Checks the values; [problems] lists everything wrong, and the app refuses to start on any.
  factory ClientConfig.validate({
    required String apiBaseUrl,
    required String supabaseUrl,
    required String supabasePublishableKey,
    required bool release,
    String signInMethod = '',
    String mapTileUrl = '',
    String mapAttribution = '',
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

    final method = switch (signInMethod) {
      '' || 'phone' => SignInMethod.phone,
      'email' => SignInMethod.email,
      _ => null,
    };
    if (method == null) {
      problems.add('SIGN_IN_METHOD must be phone or email');
    } else if (method == SignInMethod.email && release) {
      // Users signed in by email have no verified phone number for drivers and passengers to
      // call each other (IDN-2), so email stays out of releases until product decides IDN-6.
      problems.add(
        'SIGN_IN_METHOD=email is for development builds only; release builds sign in by phone',
      );
    }

    var tiles = mapTileUrl;
    if (tiles.isEmpty) {
      if (release) {
        problems.add(
          'MAP_TILE_URL is required in release builds (a map tile provider)',
        );
      } else {
        tiles = developmentTileUrl;
      }
    } else if (!tiles.startsWith('https://') ||
        !['{z}', '{x}', '{y}'].every(tiles.contains)) {
      problems.add(
        'MAP_TILE_URL must be an https URL template with {z}, {x} and {y}',
      );
    }

    return ClientConfig(
      apiBaseUrl: api ?? Uri(),
      supabaseUrl: supabase ?? Uri(),
      supabasePublishableKey: supabasePublishableKey,
      signInMethod: method ?? SignInMethod.phone,
      mapTileUrlTemplate: tiles,
      mapAttribution: mapAttribution.isEmpty
          ? openStreetMapAttribution
          : mapAttribution,
      problems: problems,
    );
  }

  /// The public OpenStreetMap tile server. Its usage policy suits development, not an app at
  /// scale, so release builds must name their own provider (OPEN_DECISIONS MAP-6).
  static const developmentTileUrl =
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  static const openStreetMapAttribution = '© OpenStreetMap contributors';

  final Uri apiBaseUrl;
  final Uri supabaseUrl;
  final String supabasePublishableKey;
  final SignInMethod signInMethod;

  /// Map tiles (`MAP_TILE_URL`), with `{z}`, `{x}` and `{y}` placeholders.
  final String mapTileUrlTemplate;

  /// Shown on every map (`MAP_ATTRIBUTION`, default OpenStreetMap's).
  final String mapAttribution;
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
