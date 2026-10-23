import 'dart:convert';

import 'package:driver_app/src/app.dart';
import 'package:driver_app/src/routing.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_auth/taketuk_auth.dart';
import 'package:taketuk_auth/testing.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

import 'support.dart' show FakeDeviceLocation, FakeDocumentPicker;

Map<String, Object?> _me({required List<String> roles}) => {
  'userId': 'user-1',
  'registered': roles.isNotEmpty,
  'displayName': roles.isEmpty ? null : 'Musa',
  'phoneE164': '+249912345678',
  'status': roles.isEmpty ? null : 'active',
  'roles': roles,
};

Map<String, Object?> _profile(String status, {String? note}) => {
  'userId': 'user-1',
  'serviceAreaCode': 'wad_madani',
  'status': status,
  'fullLegalName': 'Musa Ahmed',
  'drivingLicenseNumber': 'DL-123',
  'submittedAt': null,
  'reviewedAt': null,
  'reviewNote': note,
  'availability': 'offline',
  'activeVehicleId': null,
  'createdAt': '2026-10-23T10:00:00.000Z',
};

http.Response _json(int status, Object? body) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

Future<SessionController> _pumpApp(
  WidgetTester tester,
  FakeAuthGateway auth,
  Future<http.Response> Function(http.Request) respond, {
  SignInMethod signInMethod = SignInMethod.phone,
}) async {
  tester.platformDispatcher.localesTestValue = const [Locale('en')];
  addTearDown(tester.platformDispatcher.clearLocalesTestValue);
  final api = TaketukApi(
    ApiTransport(
      baseUrl: Uri.parse('https://api.example'),
      accessToken: auth.accessToken,
      httpClient: MockClient(respond),
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
      signInMethod: signInMethod,
      serviceAreaCode: 'wad_madani',
      mapSettings: const MapSettings.withoutTiles(),
      location: FakeDeviceLocation(null),
      picker: FakeDocumentPicker(),
      storage: MockClient((_) async => http.Response('', 200)),
    ),
  );
  await tester.pumpAndSettle();
  return session;
}

void main() {
  test(
    'driverRedirect sends accounts without the driver role to registration',
    () {
      final passengerOnly = Me.fromJson(_me(roles: ['passenger']));
      final driver = Me.fromJson(_me(roles: ['driver']));
      expect(
        driverRedirect(SessionStatus.ready, passengerOnly, Routes.home),
        Routes.register,
      );
      expect(
        driverRedirect(SessionStatus.ready, driver, Routes.register),
        Routes.home,
      );
      expect(driverRedirect(SessionStatus.ready, driver, Routes.home), isNull);
      expect(
        driverRedirect(SessionStatus.signedOut, null, Routes.home),
        Routes.signIn,
      );
    },
  );

  testWidgets('signs in by email when the build uses email codes', (
    tester,
  ) async {
    final auth = FakeAuthGateway();
    await _pumpApp(
      tester,
      auth,
      (request) async => _json(200, {..._me(roles: []), 'phoneE164': null}),
      signInMethod: SignInMethod.email,
    );

    expect(find.byKey(const Key('phone')), findsNothing);
    await tester.enterText(find.byKey(const Key('email')), 'musa@example.com');
    await tester.tap(find.text('Send code'));
    await tester.pumpAndSettle();
    expect(auth.codesRequested, [const EmailAddress('musa@example.com')]);

    await tester.enterText(find.byKey(const Key('code')), '123456');
    await tester.tap(find.text('Confirm'));
    await tester.pumpAndSettle();
    expect(find.text('Drive with TAKE-TUK'), findsOneWidget);
  });

  testWidgets('registers an applicant for the configured service area', (
    tester,
  ) async {
    final auth = FakeAuthGateway(signedIn: const AuthUser(id: 'user-1'));
    var roles = <String>['passenger'];
    http.Request? registration;
    await _pumpApp(tester, auth, (request) async {
      switch ((request.method, request.url.path)) {
        case ('GET', '/v1/me'):
          return _json(200, _me(roles: roles));
        case ('POST', '/v1/driver/registration'):
          registration = request;
          roles = ['passenger', 'driver'];
          return _json(201, _profile('applicant'));
        case ('GET', '/v1/driver/profile'):
          return _json(200, _profile('applicant'));
        case ('GET', '/v1/driver/vehicles' || '/v1/driver/documents'):
          return _json(200, {'items': <Object>[]});
        case ('GET', '/v1/fleet/vehicle-types'):
          return _json(200, {'items': <Object>[]});
      }
      return _json(404, {
        'type': 't',
        'title': 'Not found',
        'status': 404,
        'code': 'NOT_FOUND',
        'detail': '',
      });
    });

    expect(find.text('Drive with TAKE-TUK'), findsOneWidget);
    await tester.tap(find.text('Continue'));
    await tester.pump();
    expect(
      find.text('This field is required.'),
      findsNWidgets(2),
    ); // display name is prefilled

    await tester.enterText(find.byKey(const Key('legalName')), 'Musa Ahmed');
    await tester.enterText(find.byKey(const Key('license')), 'DL-123');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(jsonDecode(registration!.body), {
      'displayName': 'Musa',
      'fullLegalName': 'Musa Ahmed',
      'drivingLicenseNumber': 'DL-123',
      'serviceAreaCode': 'wad_madani',
    });
    // Registered as an applicant: onboarding (documents and vehicle) is next.
    expect(find.text('Your documents'), findsOneWidget);
    expect(find.text('Add your vehicle'), findsOneWidget);
  });

  testWidgets('explains an already-registered conflict', (tester) async {
    final auth = FakeAuthGateway(signedIn: const AuthUser(id: 'user-1'));
    await _pumpApp(tester, auth, (request) async {
      return request.url.path == '/v1/me'
          ? _json(200, _me(roles: []))
          : _json(409, {
              'type': 't',
              'title': 'Already registered with different details',
              'status': 409,
              'code': 'ALREADY_REGISTERED',
              'detail': 'x',
            });
    });
    for (final (key, value) in [
      ('displayName', 'Musa'),
      ('legalName', 'Musa A'),
      ('license', 'DL-9'),
    ]) {
      await tester.enterText(find.byKey(Key(key)), value);
    }
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('already registered with different details'),
      findsOneWidget,
    );
  });
}
