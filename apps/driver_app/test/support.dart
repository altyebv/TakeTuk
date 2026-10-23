import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:driver_app/src/app.dart';
import 'package:driver_app/src/onboarding/documents.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:latlong2/latlong.dart';
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

Map<String, Object?> vehicle({String status = 'approved'}) => {
  'id': 'vehicle-1',
  'driverId': 'user-1',
  'vehicleTypeCode': 'raksha',
  'plateNumber': 'GZ 1234',
  'description': null,
  'status': status,
  'reviewNote': null,
  'reviewedAt': null,
  'createdAt': '2026-10-23T10:00:00.000Z',
};

/// An in-memory backend for the driver flows. Tests change [profile], [offers] and [ride] to
/// simulate the server moving on; polling picks the changes up.
final class FakeDriverBackend {
  FakeDriverBackend({Map<String, Object?>? profile})
    : profile =
          profile ??
          {
            ...fixture('drivers.getProfile'),
            'userId': 'user-1',
            'availability': 'offline',
            'activeVehicleId': null,
          };

  Map<String, Object?> profile;
  List<Map<String, Object?>> vehicles = [vehicle()];
  final List<Map<String, Object?>> documents = [];
  List<Map<String, Object?>> offers = [];
  Map<String, Object?>? ride;
  final List<http.Request> requests = [];
  final List<http.Request> uploads = [];
  var _documentIds = 0;

  List<http.Request> requestsTo(String method, String path) =>
      requests.where((r) => r.method == method && r.url.path == path).toList();

  Map<String, Object?> body(http.Request request) =>
      jsonDecode(request.body) as Map<String, Object?>;

  /// Signed-URL uploads go to storage, not the API.
  late final http.Client storage = MockClient((request) async {
    uploads.add(request);
    return http.Response('', 200);
  });

  late final http.Client client = MockClient((request) async {
    requests.add(request);
    final path = request.url.path;
    final rideId = ride?['id'];
    switch ((request.method, path)) {
      case ('GET', '/v1/me'):
        return json(200, {
          'userId': 'user-1',
          'registered': true,
          'displayName': 'Musa',
          'phoneE164': '+249912345678',
          'status': 'active',
          'roles': ['driver'],
        });
      case ('GET', '/v1/driver/profile'):
        return json(200, profile);
      case ('GET', '/v1/driver/vehicles'):
        return json(200, {'items': vehicles});
      case ('POST', '/v1/driver/vehicles'):
        final created = {
          ...vehicle(status: 'pending_review'),
          'plateNumber': body(request)['plateNumber'],
        };
        vehicles = [created];
        return json(201, created);
      case ('GET', '/v1/fleet/vehicle-types'):
        return json(200, {
          'items': [
            {
              'code': 'raksha',
              'displayName': 'Raksha',
              'passengerCapable': true,
              'compatibleServiceTypes': ['passenger_transport'],
            },
            {
              'code': 'motorcycle',
              'displayName': 'Motorcycle',
              'passengerCapable': false,
              'compatibleServiceTypes': ['food_delivery'],
            },
          ],
        });
      case ('GET', '/v1/driver/documents'):
        return json(200, {'items': documents});
      case ('POST', '/v1/driver/documents/upload-requests'):
        final asked = body(request);
        final document = {
          'id': 'doc-${++_documentIds}',
          'documentType': asked['documentType'],
          'vehicleId': asked['vehicleId'],
          'contentType': asked['contentType'],
          'status': 'upload_pending',
          'createdAt': '2026-10-23T10:00:00.000Z',
          'uploadedAt': null,
        };
        documents.add(document);
        return json(201, {
          'document': document,
          'upload': {
            'url': 'https://storage.example/upload/${document['id']}?token=t',
            'method': 'PUT',
            'headers': {'content-type': asked['contentType']},
            'expiresInSeconds': 300,
          },
        });
      case ('POST', final p) when p.endsWith('/confirm'):
        final id = p.split('/')[4];
        final document = documents.firstWhere((d) => d['id'] == id);
        document['status'] = 'uploaded';
        document['uploadedAt'] = '2026-10-23T10:01:00.000Z';
        return json(200, document);
      case ('POST', '/v1/driver/verification/submit'):
        profile = {...profile, 'status': 'pending_review'};
        return json(200, profile);
      case ('PUT', '/v1/driver/availability'):
        final availability = body(request)['availability'];
        profile = {
          ...profile,
          'availability': availability,
          'activeVehicleId': availability == 'online'
              ? body(request)['vehicleId']
              : null,
        };
        return json(200, profile);
      case ('PUT', '/v1/driver/location'):
        return json(200, {'receivedAt': '2026-10-23T10:00:00.000Z'});
      case ('GET', '/v1/driver/offers'):
        return json(200, {'items': offers});
      case ('POST', final p) when p.endsWith('/accept'):
        offers = [];
        ride = fixture('driverOffers.accept');
        return json(200, ride);
      case ('POST', final p) when p.endsWith('/decline'):
        final offer = offers.removeAt(0);
        return json(200, {...offer, 'status': 'declined'});
      case ('POST', final p) when p.endsWith('/counteroffer'):
        offers[0] = {
          ...offers[0],
          'status': 'countered',
          'counterFare': body(request)['amount'],
        };
        return json(200, offers[0]);
      case ('GET', '/v1/driver/rides/current'):
        final active = const {
          'driver_assigned',
          'driver_arrived',
          'in_progress',
        };
        return json(200, {
          'ride': ride != null && active.contains(ride!['status'])
              ? ride
              : null,
        });
      case ('GET', final p)
          when rideId != null && p == '/v1/driver/rides/$rideId':
        return json(200, ride);
      case ('POST', final p)
          when rideId != null && p.startsWith('/v1/driver/rides/$rideId/'):
        final action = p.split('/').last;
        if (action == 'cash-collection') {
          final report = body(request);
          return json(200, {
            ...fixture('finance.reportCashCollection'),
            'status': report['outcome'] == 'collected'
                ? 'collected'
                : 'reported_unpaid',
            'amountCollected': report['amountCollected'],
          });
        }
        ride = switch (action) {
          'arrive' => {...ride!, 'status': 'driver_arrived'},
          'start' => {...ride!, 'status': 'in_progress'},
          'complete' => fixture('driverRides.complete'),
          'cancel' => {...ride!, 'status': 'cancelled'},
          _ => ride,
        };
        return json(200, ride);
      case ('GET', '/v1/driver/earnings'):
        return json(200, {
          'commissionOwed': [
            {'amountMinor': 2500, 'currency': 'SDG'},
          ],
          'items': [
            {
              'rideId': 'ride-1',
              'completedAt': '2026-10-23T10:00:00.000Z',
              'agreedFare': {'amountMinor': 25000, 'currency': 'SDG'},
              'amountCollected': {'amountMinor': 25000, 'currency': 'SDG'},
              'paymentStatus': 'collected',
              'commission': {'amountMinor': 2500, 'currency': 'SDG'},
            },
          ],
          'nextCursor': null,
        });
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

final class FakeDocumentPicker implements DocumentPicker {
  final List<PhotoSource> sources = [];

  @override
  Future<PickedDocument?> pick(PhotoSource source) async {
    sources.add(source);
    return PickedDocument(
      bytes: Uint8List.fromList([0xFF, 0xD8, 0xFF, sources.length]),
      contentType: DriversRequestDocumentUploadRequestContentType.imageJpeg,
    );
  }
}

/// Lets requests complete and frames render, without waiting for indefinite animations.
Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

/// Pumps the app signed in as a registered driver.
Future<FakeDriverBackend> pumpDriverApp(
  WidgetTester tester, {
  FakeDriverBackend? backend,
  DeviceLocation? location,
  FakeDocumentPicker? picker,
}) async {
  final server = backend ?? FakeDriverBackend();
  tester.platformDispatcher.localesTestValue = const [Locale('en')];
  addTearDown(tester.platformDispatcher.clearLocalesTestValue);
  tester.view.physicalSize = const Size(1080, 2400);
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
    DriverApp(
      auth: auth,
      api: api,
      session: session,
      serviceAreaCode: 'wad_madani',
      mapSettings: const MapSettings.withoutTiles(),
      location: location ?? FakeDeviceLocation(const LatLng(14.401, 33.521)),
      picker: picker ?? FakeDocumentPicker(),
      storage: server.storage,
      pollInterval: const Duration(seconds: 1),
      locationInterval: const Duration(seconds: 5),
    ),
  );
  await settle(tester);
  return server;
}
