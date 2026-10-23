import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:latlong2/latlong.dart';
import 'package:passenger_app/src/app.dart';
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_auth/taketuk_auth.dart';
import 'package:taketuk_auth/testing.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

/// A response recorded from the real backend (packages/taketuk_api/test/fixtures).
Map<String, Object?> fixture(String name) => jsonDecode(
  File('../../packages/taketuk_api/test/fixtures/$name.json')
      .readAsStringSync(),
) as Map<String, Object?>;

http.Response json(int status, Object? body) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

http.Response problem(int status, String code) => json(status, {
  'type': 'https://docs.taketuk.app/problems/${code.toLowerCase()}',
  'title': 'English title',
  'status': status,
  'code': code,
  'detail': 'English detail',
  'requestId': 'req-1',
});

Map<String, Object?> counteroffer({
  String id = 'offer-1',
  int amountMinor = 26000,
  String status = 'countered',
}) => {
  'offerId': id,
  'status': status,
  'amount': {'amountMinor': amountMinor, 'currency': 'SDG'},
  'expiresAt': '2026-10-23T04:13:14.343Z',
  'driverDisplayName': 'Musa',
  'vehicleTypeCode': 'raksha',
  'distanceToPickupMeters': 250,
};

/// An in-memory backend for the passenger flows. Tests change [ride] to simulate the server
/// moving on (a driver accepting, the trip completing); polling picks the change up.
final class FakeBackend {
  FakeBackend({this.registered = true});

  bool registered;
  final List<http.Request> requests = [];

  /// The current state of the passenger's ride, if any.
  Map<String, Object?>? ride;
  List<Map<String, Object?>> history = [];
  http.Response? nextQuoteResponse;

  /// Ride creations that fail with a network error before one succeeds.
  int failRideCreates = 0;

  List<http.Request> requestsTo(String method, String path) =>
      requests.where((r) => r.method == method && r.url.path == path).toList();

  late final http.Client client = MockClient((request) async {
    requests.add(request);
    final path = request.url.path;
    final rideId = ride?['id'];
    switch ((request.method, path)) {
      case ('GET', '/v1/me'):
        return json(200, {
          'userId': 'user-1',
          'registered': registered,
          'displayName': registered ? 'Hiba' : null,
          'phoneE164': '+249912345678',
          'status': registered ? 'active' : null,
          'roles': registered ? ['passenger'] : <String>[],
        });
      case ('POST', '/v1/passenger/registration'):
        registered = true;
        return json(201, {
          'userId': 'user-1',
          'registered': true,
          'displayName': 'Hiba',
          'phoneE164': '+249912345678',
          'status': 'active',
          'roles': ['passenger'],
        });
      case ('GET', '/v1/rides'):
        return json(200, {
          'items': [?ride, ...history],
          'nextCursor': null,
        });
      case ('POST', '/v1/fare-quotes'):
        final injected = nextQuoteResponse;
        nextQuoteResponse = null;
        return injected ?? json(201, fixture('pricing.createQuote'));
      case ('POST', '/v1/rides'):
        if (failRideCreates > 0) {
          failRideCreates--;
          throw http.ClientException('connection reset');
        }
        final body = jsonDecode(request.body) as Map<String, Object?>;
        ride = {
          ...fixture('rides.create'),
          'proposedFare': body['proposedFare'],
        };
        return json(201, ride);
      case ('GET', final p) when rideId != null && p == '/v1/rides/$rideId':
        return json(200, ride);
      case ('POST', final p)
          when rideId != null && p == '/v1/rides/$rideId/cancel':
        ride = {
          ...ride!,
          'status': 'cancelled',
          'cancellation': {
            'cancelledByRole': 'passenger',
            'reason': (jsonDecode(request.body) as Map)['reason'],
            'statusBeforeCancellation': ride!['status'],
          },
        };
        return json(200, ride);
      case ('POST', final p)
          when rideId != null && p.endsWith('/accept-counteroffer'):
        final assigned = fixture('rides.get.assigned');
        ride = {
          ...ride!,
          'status': 'driver_assigned',
          'agreedFare': {'amountMinor': 26000, 'currency': 'SDG'},
          'driver': assigned['driver'],
        };
        return json(200, ride);
    }
    return problem(404, 'NOT_FOUND');
  });
}

final class FakeDeviceLocation implements DeviceLocation {
  FakeDeviceLocation(this.position);

  LatLng? position;

  @override
  Future<LatLng?> current() async => position;
}

/// Pumps the app signed in as a registered passenger.
Future<FakeBackend> pumpPassengerApp(
  WidgetTester tester, {
  FakeBackend? backend,
  Locale locale = const Locale('en'),
  DeviceLocation? location,
}) async {
  final server = backend ?? FakeBackend();
  tester.platformDispatcher.localesTestValue = [locale];
  addTearDown(tester.platformDispatcher.clearLocalesTestValue);
  tester.view.physicalSize = const Size(1080, 2160);
  tester.view.devicePixelRatio = 2.5;
  addTearDown(tester.view.reset);
  final auth = FakeAuthGateway(signedIn: const AuthUser(id: 'user-1'));
  final api = TaketukApi(
    ApiTransport(
      baseUrl: Uri.parse('https://api.example'),
      accessToken: auth.accessToken,
      httpClient: server.client,
    ),
  );
  final session = SessionController(auth: auth, api: api);
  addTearDown(session.dispose);
  await session.start();
  await tester.pumpWidget(
    PassengerApp(
      auth: auth,
      api: api,
      session: session,
      mapSettings: const MapSettings.withoutTiles(),
      location: location ?? FakeDeviceLocation(null),
      ridePollInterval: const Duration(seconds: 1),
    ),
  );
  await settle(tester);
  return server;
}

/// Lets requests complete and frames render. Unlike pumpAndSettle it does not wait for
/// indefinite animations such as the searching progress bar.
Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}
