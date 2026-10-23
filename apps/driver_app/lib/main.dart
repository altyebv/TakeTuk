import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_auth/taketuk_auth.dart';

import 'src/app.dart';

/// The service area drivers apply for. `wad_madani` is the code of the first city (supabase/seed.sql
/// uses it for development; production uses the code an operator created).
const _serviceAreaCode = String.fromEnvironment(
  'SERVICE_AREA_CODE',
  defaultValue: 'wad_madani',
);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final config = ClientConfig.fromEnvironment();
  if (config.problems.isNotEmpty) {
    runApp(ConfigurationErrorApp(config.problems));
    return;
  }
  final auth = await SupabaseAuthGateway.initialize(
    url: config.supabaseUrl.toString(),
    publishableKey: config.supabasePublishableKey,
  );
  final api = TaketukApi(
    ApiTransport(baseUrl: config.apiBaseUrl, accessToken: auth.accessToken),
  );
  final session = SessionController(auth: auth, api: api);
  unawaited(session.start());
  runApp(
    DriverApp(
      auth: auth,
      api: api,
      session: session,
      serviceAreaCode: _serviceAreaCode,
    ),
  );
}
