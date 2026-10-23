import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_auth/taketuk_auth.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

import 'src/app.dart';

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
    PassengerApp(
      auth: auth,
      api: api,
      session: session,
      signInMethod: config.signInMethod,
      mapSettings: MapSettings(
        tileUrlTemplate: config.mapTileUrlTemplate,
        attribution: config.mapAttribution,
        userAgentPackageName: 'app.taketuk.passenger',
      ),
      location: const GeolocatorDeviceLocation(),
    ),
  );
}
