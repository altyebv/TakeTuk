import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart'
    show AuthException, AuthRetryableFetchException;
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_auth/taketuk_auth.dart';
import 'package:taketuk_auth/testing.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

Map<String, Object?> _me({bool registered = true}) => {
  'userId': 'user-1',
  'registered': registered,
  'displayName': registered ? 'Hiba' : null,
  'phoneE164': '+249911111111',
  'status': registered ? 'active' : null,
  'roles': registered ? ['passenger'] : <String>[],
};

TaketukApi _api(
  FakeAuthGateway auth,
  http.Response Function(http.Request) respond,
) => TaketukApi(
  ApiTransport(
    baseUrl: Uri.parse('https://api.example'),
    accessToken: auth.accessToken,
    httpClient: MockClient((request) async => respond(request)),
  ),
);

http.Response _json(int status, Object body) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

Widget _app(Widget home) => MaterialApp(
  locale: const Locale('en'),
  supportedLocales: taketukSupportedLocales,
  localizationsDelegates: const [
    TaketukAuthLocalizations.delegate,
    TaketukUiLocalizations.delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
  ],
  home: home,
);

void main() {
  group('normalizeSudanMobile', () {
    test('accepts local, national and international forms', () {
      for (final input in [
        '0912345678',
        '912345678',
        '+249912345678',
        '00249912345678',
        '249912345678',
        '+249 91 234 5678',
        '091-234-5678',
        '٠٩١٢٣٤٥٦٧٨',
        '۰۹۱۲۳۴۵۶۷۸',
      ]) {
        expect(normalizeSudanMobile(input), '+249912345678', reason: input);
      }
      expect(normalizeSudanMobile('0123456789'), '+249123456789');
    });

    test('rejects other numbers', () {
      for (final input in [
        '',
        '12345',
        '0812345678',
        '+20912345678',
        '09123456789',
        'abc',
      ]) {
        expect(normalizeSudanMobile(input), isNull, reason: input);
      }
    });
  });

  test('normalizeEmail trims, lower-cases and rejects malformed addresses', () {
    expect(
      normalizeEmail('  Hiba.Osman@Example.COM '),
      'hiba.osman@example.com',
    );
    expect(normalizeEmail('a+b@mail.example.sd'), 'a+b@mail.example.sd');
    for (final input in [
      '',
      'hiba',
      'hiba@',
      '@example.com',
      'hiba@example',
      'hiba@@example.com',
      'hiba osman@example.com',
      'hiba@example..com',
    ]) {
      expect(normalizeEmail(input), isNull, reason: input);
    }
  });

  test('sign-in addresses round-trip through navigation query parameters', () {
    for (final address in const [
      PhoneAddress('+249912345678'),
      EmailAddress('hiba@example.com'),
    ]) {
      expect(SignInAddress.fromQuery(address.toQuery()), address);
    }
    expect(SignInAddress.fromQuery(const {}), isNull);
    expect(SignInAddress.fromQuery(const {'phone': ''}), isNull);
  });

  test('maps Supabase Auth errors to sign-in failures', () {
    expect(
      authFailureFrom(AuthRetryableFetchException(message: 'offline')).kind,
      AuthFailureKind.network,
    );
    expect(
      authFailureFrom(
        const AuthException('expired', code: 'otp_expired', statusCode: '403'),
      ).kind,
      AuthFailureKind.invalidCode,
    );
    expect(
      authFailureFrom(
        const AuthException('slow down', code: 'over_sms_send_rate_limit'),
      ).kind,
      AuthFailureKind.rateLimited,
    );
    expect(
      authFailureFrom(const AuthException('x', statusCode: '429')).kind,
      AuthFailureKind.rateLimited,
    );
    expect(
      authFailureFrom(
        const AuthException('slow down', code: 'over_email_send_rate_limit'),
      ).kind,
      AuthFailureKind.rateLimited,
    );
    for (final code in ['validation_failed', 'email_address_invalid']) {
      expect(
        authFailureFrom(AuthException('bad address', code: code)).kind,
        AuthFailureKind.invalidAddress,
        reason: code,
      );
    }
    expect(
      authFailureFrom(
        const AuthException(
          'Email address not authorized',
          code: 'email_address_not_authorized',
          statusCode: '400',
        ),
      ).kind,
      AuthFailureKind.addressNotAllowed,
    );
    expect(
      authFailureFrom(
        const AuthException(
          'sms down',
          code: 'sms_send_failed',
          statusCode: '500',
        ),
      ).kind,
      AuthFailureKind.unavailable,
    );
  });

  group('SessionController', () {
    test('signs in, loads the account and signs out', () async {
      final auth = FakeAuthGateway();
      final requests = <http.Request>[];
      final session = SessionController(
        auth: auth,
        api: _api(auth, (request) {
          requests.add(request);
          return _json(200, _me());
        }),
      );
      final statuses = <SessionStatus>[];
      session.addListener(() => statuses.add(session.status));

      await session.start();
      expect(session.status, SessionStatus.signedOut);

      await auth.verifyCode(
        address: const PhoneAddress('+249911111111'),
        code: '123456',
      );
      await pumpEventQueue();
      expect(session.status, SessionStatus.ready);
      expect(session.me!.displayName, 'Hiba');
      expect(
        requests.single.headers['Authorization'],
        'Bearer token-for-user-1',
      );
      expect(
        statuses,
        containsAllInOrder([SessionStatus.loadingAccount, SessionStatus.ready]),
      );

      await session.signOut();
      expect(session.status, SessionStatus.signedOut);
      expect(session.me, isNull);
      session.dispose();
    });

    test('restores a persisted session on start', () async {
      final auth = FakeAuthGateway(signedIn: const AuthUser(id: 'user-1'));
      final session = SessionController(
        auth: auth,
        api: _api(auth, (_) => _json(200, _me(registered: false))),
      );
      await session.start();
      expect(session.status, SessionStatus.ready);
      expect(session.me!.registered, isFalse);
      session.dispose();
    });

    test('signs out when the API no longer accepts the session', () async {
      final auth = FakeAuthGateway(signedIn: const AuthUser(id: 'user-1'));
      final session = SessionController(
        auth: auth,
        api: _api(
          auth,
          (_) => _json(401, {
            'type': 't',
            'title': 'Authentication is required',
            'status': 401,
            'code': 'AUTHENTICATION_REQUIRED',
            'detail': 'Token expired',
          }),
        ),
      );
      await session.start();
      expect(session.status, SessionStatus.signedOut);
      expect(auth.currentUser, isNull);
      session.dispose();
    });

    test('keeps the user signed in but reports account errors', () async {
      final auth = FakeAuthGateway(signedIn: const AuthUser(id: 'user-1'));
      final session = SessionController(
        auth: auth,
        api: _api(auth, (_) => http.Response('', 503)),
      );
      await session.start();
      expect(session.status, SessionStatus.accountError);
      expect(session.error, isA<ApiUnavailable>());
      expect(auth.currentUser, isNotNull);
      session.dispose();
    });
  });

  group('sign-in screens', () {
    testWidgets('phone entry validates and requests a code in E.164', (
      tester,
    ) async {
      final auth = FakeAuthGateway();
      SignInAddress? sentTo;
      await tester.pumpWidget(
        _app(SignInScreen(auth: auth, onCodeSent: (a) => sentTo = a)),
      );

      await tester.enterText(find.byKey(const Key('phone')), '0812');
      await tester.tap(find.text('Send code'));
      await tester.pump();
      expect(
        find.textContaining('Enter a Sudanese mobile number'),
        findsOneWidget,
      );
      expect(auth.codesRequested, isEmpty);

      await tester.enterText(find.byKey(const Key('phone')), '091 234 5678');
      await tester.tap(find.text('Send code'));
      await tester.pumpAndSettle();
      expect(auth.codesRequested, [const PhoneAddress('+249912345678')]);
      expect(sentTo, const PhoneAddress('+249912345678'));
    });

    testWidgets('email entry validates and requests a code by email', (
      tester,
    ) async {
      final auth = FakeAuthGateway();
      SignInAddress? sentTo;
      await tester.pumpWidget(
        _app(
          SignInScreen(
            auth: auth,
            method: SignInMethod.email,
            onCodeSent: (a) => sentTo = a,
          ),
        ),
      );
      expect(find.byKey(const Key('phone')), findsNothing);

      await tester.enterText(find.byKey(const Key('email')), 'hiba@example');
      await tester.tap(find.text('Send code'));
      await tester.pump();
      expect(
        find.textContaining('Enter a valid email address'),
        findsOneWidget,
      );
      expect(auth.codesRequested, isEmpty);

      auth.nextFailure = const AuthFailure(AuthFailureKind.addressNotAllowed);
      await tester.enterText(
        find.byKey(const Key('email')),
        'Hiba@Example.com',
      );
      await tester.tap(find.text('Send code'));
      await tester.pumpAndSettle();
      expect(
        find.text('Sign-in codes cannot be sent to this address yet.'),
        findsOneWidget,
      );

      await tester.tap(find.text('Send code'));
      await tester.pumpAndSettle();
      expect(auth.codesRequested, [const EmailAddress('hiba@example.com')]);
      expect(sentTo, const EmailAddress('hiba@example.com'));
    });

    testWidgets('development builds can skip to a code issued elsewhere', (
      tester,
    ) async {
      final auth = FakeAuthGateway();
      SignInAddress? sentTo;
      await tester.pumpWidget(
        _app(
          SignInScreen(
            auth: auth,
            method: SignInMethod.email,
            onCodeSent: (a) => sentTo = a,
          ),
        ),
      );
      await tester.tap(find.text('I already have a code'));
      await tester.pump();
      expect(
        find.textContaining('Enter a valid email address'),
        findsOneWidget,
      );
      expect(sentTo, isNull);

      await tester.enterText(
        find.byKey(const Key('email')),
        'Passenger@Example.com',
      );
      await tester.tap(find.text('I already have a code'));
      await tester.pump();
      expect(sentTo, const EmailAddress('passenger@example.com'));
      expect(auth.codesRequested, isEmpty);

      await tester.pumpWidget(
        _app(
          SignInScreen(
            auth: auth,
            onCodeSent: (_) {},
            offerExistingCode: false,
          ),
        ),
      );
      expect(find.text('I already have a code'), findsNothing);
    });

    testWidgets('phone entry explains rate limits and network failures', (
      tester,
    ) async {
      final auth = FakeAuthGateway()
        ..nextFailure = const AuthFailure(AuthFailureKind.rateLimited);
      await tester.pumpWidget(
        _app(SignInScreen(auth: auth, onCodeSent: (_) {})),
      );
      await tester.enterText(find.byKey(const Key('phone')), '0912345678');
      await tester.tap(find.text('Send code'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Too many attempts'), findsOneWidget);
    });

    testWidgets(
      'code entry rejects a wrong code and signs in with the right one',
      (tester) async {
        final auth = FakeAuthGateway();
        await tester.pumpWidget(
          _app(
            CodeEntryScreen(
              auth: auth,
              address: const PhoneAddress('+249912345678'),
              onChangeAddress: () {},
            ),
          ),
        );
        expect(find.textContaining('+249912345678'), findsOneWidget);

        await tester.enterText(find.byKey(const Key('code')), '000000');
        await tester.tap(find.text('Confirm'));
        await tester.pumpAndSettle();
        expect(find.text('The code is wrong or has expired.'), findsOneWidget);
        expect(auth.currentUser, isNull);

        await tester.enterText(find.byKey(const Key('code')), '123456');
        await tester.tap(find.text('Confirm'));
        await tester.pumpAndSettle();
        expect(auth.currentUser?.phoneE164, '+249912345678');
      },
    );

    testWidgets('code entry signs in by email and offers to change it', (
      tester,
    ) async {
      final auth = FakeAuthGateway();
      var changed = false;
      await tester.pumpWidget(
        _app(
          CodeEntryScreen(
            auth: auth,
            address: const EmailAddress('hiba@example.com'),
            onChangeAddress: () => changed = true,
          ),
        ),
      );
      expect(find.textContaining('hiba@example.com'), findsOneWidget);
      await tester.tap(find.text('Change email'));
      expect(changed, isTrue);

      await tester.enterText(find.byKey(const Key('code')), '123456');
      await tester.tap(find.text('Confirm'));
      await tester.pumpAndSettle();
      expect(auth.currentUser?.email, 'hiba@example.com');
      expect(auth.currentUser?.phoneE164, isNull);
    });
  });

  group('ClientConfig', () {
    String jwt(Map<String, Object?> payload) =>
        'eyJhbGciOiJIUzI1NiJ9.${base64Url.encode(utf8.encode(jsonEncode(payload))).replaceAll('=', '')}.sig';

    test('accepts public values', () {
      final config = ClientConfig.validate(
        apiBaseUrl: 'https://api.example',
        supabaseUrl: 'https://project.supabase.co',
        supabasePublishableKey: 'sb_publishable_abc',
        release: true,
        mapTileUrl: 'https://tiles.example/{z}/{x}/{y}.png',
      );
      expect(config.problems, isEmpty);
      expect(config.apiBaseUrl.host, 'api.example');
      expect(config.signInMethod, SignInMethod.phone);
    });

    test('allows email sign-in only in development builds', () {
      ClientConfig check(String method, {required bool release}) =>
          ClientConfig.validate(
            apiBaseUrl: 'https://api.example',
            supabaseUrl: 'https://project.supabase.co',
            supabasePublishableKey: 'sb_publishable_abc',
            release: release,
            signInMethod: method,
            mapTileUrl: 'https://tiles.example/{z}/{x}/{y}.png',
          );
      final development = check('email', release: false);
      expect(development.problems, isEmpty);
      expect(development.signInMethod, SignInMethod.email);
      expect(check('phone', release: true).problems, isEmpty);
      expect(
        check('email', release: true).problems.single,
        contains('development builds only'),
      );
      expect(
        check('whatsapp', release: false).problems.single,
        contains('SIGN_IN_METHOD must be phone or email'),
      );
    });

    test('allows http only in development builds', () {
      ClientConfig check({required bool release}) => ClientConfig.validate(
        apiBaseUrl: 'http://10.0.2.2:3000',
        supabaseUrl: 'http://10.0.2.2:54321',
        supabasePublishableKey: jwt({'role': 'anon'}),
        release: release,
        mapTileUrl: 'https://tiles.example/{z}/{x}/{y}.png',
      );
      expect(check(release: false).problems, isEmpty);
      expect(check(release: true).problems, hasLength(2));
    });

    test('uses the public OpenStreetMap tiles only in development builds', () {
      ClientConfig check({required bool release, String tiles = ''}) =>
          ClientConfig.validate(
            apiBaseUrl: 'https://api.example',
            supabaseUrl: 'https://project.supabase.co',
            supabasePublishableKey: 'sb_publishable_abc',
            release: release,
            mapTileUrl: tiles,
          );
      final development = check(release: false);
      expect(development.problems, isEmpty);
      expect(development.mapTileUrlTemplate, ClientConfig.developmentTileUrl);
      expect(development.mapAttribution, '© OpenStreetMap contributors');
      expect(
        check(release: true).problems.single,
        contains('MAP_TILE_URL is required'),
      );
      expect(
        check(
          release: true,
          tiles: 'https://tiles.example/{z}/{x}/{y}.png',
        ).problems,
        isEmpty,
      );
      expect(
        check(
          release: false,
          tiles: 'http://tiles.example/{z}/{x}/{y}.png',
        ).problems,
        hasLength(1),
      );
    });

    test('refuses missing values and privileged keys', () {
      expect(
        ClientConfig.validate(
          apiBaseUrl: '',
          supabaseUrl: 'nonsense',
          supabasePublishableKey: '',
          release: false,
        ).problems,
        hasLength(3),
      );
      for (final key in [
        'sb_secret_abc',
        jwt({'role': 'service_role'}),
      ]) {
        final problems = ClientConfig.validate(
          apiBaseUrl: 'https://api.example',
          supabaseUrl: 'https://project.supabase.co',
          supabasePublishableKey: key,
          release: false,
        ).problems;
        expect(problems.single, contains('secret or service-role'));
      }
    });
  });
}
