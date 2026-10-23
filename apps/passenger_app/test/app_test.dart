import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:passenger_app/src/app.dart';
import 'package:passenger_app/src/routing.dart';
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_auth/taketuk_auth.dart';
import 'package:taketuk_auth/testing.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

import 'support.dart' show FakeDeviceLocation;

Me _me({required bool registered, String? name}) => Me.fromJson({
  'userId': 'user-1',
  'registered': registered,
  'displayName': name,
  'phoneE164': '+249912345678',
  'status': registered ? 'active' : null,
  'roles': registered ? ['passenger'] : <String>[],
});

http.Response _json(int status, Object? body) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

void main() {
  group('passengerRedirect', () {
    final registered = _me(registered: true, name: 'Hiba');
    final unregistered = _me(registered: false);

    test('waits while the session or account loads', () {
      expect(
        passengerRedirect(SessionStatus.starting, null, Routes.home),
        Routes.starting,
      );
      expect(
        passengerRedirect(
          SessionStatus.loadingAccount,
          null,
          Routes.signInCode,
        ),
        Routes.starting,
      );
    });

    test('keeps signed-out users in the sign-in flow', () {
      expect(
        passengerRedirect(SessionStatus.signedOut, null, Routes.home),
        Routes.signIn,
      );
      expect(
        passengerRedirect(SessionStatus.signedOut, null, Routes.signIn),
        isNull,
      );
      expect(
        passengerRedirect(SessionStatus.signedOut, null, Routes.signInCode),
        isNull,
      );
    });

    test('sends accounts without the passenger role to registration', () {
      expect(
        passengerRedirect(SessionStatus.ready, unregistered, Routes.home),
        Routes.register,
      );
      final driverOnly = Me.fromJson({
        ...registered.toJson(),
        'roles': ['driver'],
      });
      expect(
        passengerRedirect(SessionStatus.ready, driverOnly, Routes.home),
        Routes.register,
      );
    });

    test('sends registered passengers home from the entry screens only', () {
      for (final entry in [
        Routes.starting,
        Routes.signIn,
        Routes.signInCode,
        Routes.register,
      ]) {
        expect(
          passengerRedirect(SessionStatus.ready, registered, entry),
          Routes.home,
        );
      }
      expect(
        passengerRedirect(SessionStatus.ready, registered, Routes.home),
        isNull,
      );
      expect(
        passengerRedirect(SessionStatus.accountError, null, Routes.home),
        Routes.accountError,
      );
    });
  });

  testWidgets('signs in, registers and reaches home', (tester) async {
    final auth = FakeAuthGateway();
    var registered = false;
    final requests = <http.Request>[];
    final api = TaketukApi(
      ApiTransport(
        baseUrl: Uri.parse('https://api.example'),
        accessToken: auth.accessToken,
        httpClient: MockClient((request) async {
          requests.add(request);
          return switch ((request.method, request.url.path)) {
            ('GET', '/v1/me') => _json(
              200,
              _me(registered: registered, name: 'Hiba').toJson(),
            ),
            ('POST', '/v1/passenger/registration') => () {
              registered = true;
              return _json(201, _me(registered: true, name: 'Hiba').toJson());
            }(),
            ('GET', '/v1/rides') => _json(200, {
              'items': <Object>[],
              'nextCursor': null,
            }),
            _ => _json(404, {
              'type': 't',
              'title': 'Not found',
              'status': 404,
              'code': 'NOT_FOUND',
              'detail': '',
            }),
          };
        }),
      ),
    );
    // A device language the app does not offer: it falls back to Arabic.
    tester.platformDispatcher.localesTestValue = const [Locale('fr', 'FR')];
    addTearDown(tester.platformDispatcher.clearLocalesTestValue);
    final session = SessionController(auth: auth, api: api);
    await session.start();
    await tester.pumpWidget(
      PassengerApp(
        auth: auth,
        api: api,
        session: session,
        mapSettings: const MapSettings.withoutTiles(),
        location: FakeDeviceLocation(null),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('تسجيل الدخول'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('phone')), '0912345678');
    await tester.tap(find.text('إرسال الرمز'));
    await tester.pumpAndSettle();
    expect(auth.codesRequested, ['+249912345678']);

    await tester.enterText(find.byKey(const Key('code')), '123456');
    await tester.tap(find.text('تأكيد'));
    await tester.pumpAndSettle();

    // Signed in without a passenger account: registration.
    expect(find.text('مرحبًا بك في تك تك'), findsOneWidget);
    await tester.tap(find.text('متابعة'));
    await tester.pump();
    expect(find.text('أدخل اسمك.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('name')), 'Hiba');
    await tester.tap(find.text('متابعة'));
    await tester.pumpAndSettle();

    // Registered: the trip planner.
    expect(find.text('اضغط على الخريطة لتحديد نقطة الانطلاق.'), findsOneWidget);
    final registration = requests.singleWhere(
      (r) => r.url.path == '/v1/passenger/registration',
    );
    expect(jsonDecode(registration.body), {'displayName': 'Hiba'});
    expect(registration.headers['Authorization'], 'Bearer token-for-user-1');

    await tester.tap(find.byIcon(Icons.logout));
    await tester.pumpAndSettle();
    expect(find.text('تسجيل الدخول'), findsOneWidget);
    session.dispose();
  });

  testWidgets('shows a localized error when registration fails', (
    tester,
  ) async {
    final auth = FakeAuthGateway(signedIn: const AuthUser(id: 'user-1'));
    final api = TaketukApi(
      ApiTransport(
        baseUrl: Uri.parse('https://api.example'),
        accessToken: auth.accessToken,
        httpClient: MockClient(
          (request) async => request.url.path == '/v1/me'
              ? _json(200, _me(registered: false).toJson())
              : http.Response('<html>Bad Gateway</html>', 502),
        ),
      ),
    );
    // A device language the app does not offer: it falls back to Arabic.
    tester.platformDispatcher.localesTestValue = const [Locale('fr', 'FR')];
    addTearDown(tester.platformDispatcher.clearLocalesTestValue);
    final session = SessionController(auth: auth, api: api);
    await session.start();
    await tester.pumpWidget(
      PassengerApp(
        auth: auth,
        api: api,
        session: session,
        mapSettings: const MapSettings.withoutTiles(),
        location: FakeDeviceLocation(null),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('name')), 'Hiba');
    await tester.tap(find.text('متابعة'));
    await tester.pumpAndSettle();
    expect(
      find.text('الخدمة غير متاحة مؤقتًا. حاول مرة أخرى بعد قليل.'),
      findsOneWidget,
    );
    session.dispose();
  });
}
