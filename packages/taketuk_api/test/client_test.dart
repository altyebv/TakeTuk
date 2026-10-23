import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:taketuk_api/taketuk_api.dart';
import 'package:test/test.dart';

import 'support.dart';

void main() {
  group('requests', () {
    test('send the bearer token, JSON body and idempotency key', () async {
      final (:api, :http) = apiWith(
        (_) async => jsonResponse(201, fixture('rides.create')),
      );
      final ride = await api.rides.create(
        const RidesCreateRequest(
          quoteId: '6f1c2a9e-1d4b-4c3a-9a51-2f9f0c7d1e22',
          proposedFare: MoneyInput(amountMinor: 25000, currency: 'SDG'),
        ),
        idempotencyKey: 'key-1',
      );

      final request = http.requests.single;
      expect(request.method, 'POST');
      expect(request.url.toString(), 'https://api.example/v1/rides');
      expect(request.headers['Authorization'], 'Bearer token-1');
      expect(request.headers['Idempotency-Key'], 'key-1');
      expect(request.headers['Content-Type'], startsWith('application/json'));
      expect(jsonDecode(request.body), {
        'quoteId': '6f1c2a9e-1d4b-4c3a-9a51-2f9f0c7d1e22',
        'proposedFare': {'amountMinor': 25000, 'currency': 'SDG'},
      });
      expect(ride.status, PassengerRideStatus.searching);
    });

    test('encode path parameters and omit absent query parameters', () async {
      final (:api, :http) = apiWith(
        (_) async => jsonResponse(200, fixture('rides.list')),
      );
      await api.rides.list(limit: 5);
      await api.rides.list(cursor: 'a b/c');
      expect(
        http.requests[0].url.toString(),
        'https://api.example/v1/rides?limit=5',
      );
      expect(http.requests[1].url.queryParameters, {'cursor': 'a b/c'});

      final (api: api2, http: http2) = apiWith(
        (_) async => jsonResponse(200, fixture('rides.get.assigned')),
      );
      await api2.rides.get('id/with?odd chars');
      expect(
        http2.requests.single.url.path,
        '/v1/rides/id%2Fwith%3Fodd%20chars',
      );
    });

    test('keep a base path prefix', () async {
      final (:api, :http) = apiWith(
        (_) async => jsonResponse(200, fixture('identity.getMe')),
        baseUrl: 'https://gateway.example/taketuk/',
      );
      await api.identity.getMe();
      expect(
        http.requests.single.url.toString(),
        'https://gateway.example/taketuk/v1/me',
      );
    });

    test('encode a discriminated request body with its constant', () async {
      final (:api, :http) = apiWith(
        (_) async => jsonResponse(200, fixture('finance.reportCashCollection')),
      );
      await api.finance.reportCashCollection(
        'ride-1',
        const FinanceReportCashCollectionRequestNotCollected(),
      );
      expect(jsonDecode(http.requests.single.body), {
        'outcome': 'not_collected',
      });
    });

    test('call public operations without asking for a token', () async {
      var asked = false;
      final recording = RecordingClient(
        (_) async => jsonResponse(200, {'status': 'ok'}),
      );
      final api = TaketukApi(
        ApiTransport(
          baseUrl: Uri.parse('https://api.example'),
          accessToken: () async {
            asked = true;
            return 'token';
          },
          httpClient: recording.client,
        ),
      );
      await api.health.live();
      expect(asked, isFalse);
      expect(
        recording.requests.single.headers.containsKey('Authorization'),
        isFalse,
      );
    });

    test(
      'refuse authenticated calls when signed out, without sending anything',
      () async {
        final (:api, :http) = apiWith(
          (_) async => jsonResponse(200, {}),
          token: null,
        );
        await expectLater(
          api.identity.getMe(),
          throwsA(
            isA<ApiProblem>().having(
              (p) => p.code,
              'code',
              ProblemCodes.authenticationRequired,
            ),
          ),
        );
        expect(http.requests, isEmpty);
      },
    );

    test('return nothing for 204 responses', () async {
      final (:api, :http) = apiWith((_) async => noContent());
      await api.notifications.removeDevice('installation-1');
      expect(http.requests.single.method, 'DELETE');
    });
  });

  group(
    'responses recorded from the backend decode with the generated client',
    () {
      test('identity.getMe', () async {
        final (:api, http: _) = apiWith(
          (_) async => jsonResponse(200, fixture('identity.getMe')),
        );
        final me = await api.identity.getMe();
        expect(me.registered, isTrue);
        expect(me.roles, [MeRolesItem.passenger]);
        expect(me.phoneE164, '+249911111111');
      });

      test('pricing.createQuote', () async {
        final (:api, http: _) = apiWith(
          (_) async => jsonResponse(201, fixture('pricing.createQuote')),
        );
        final quote = await api.pricing.createQuote(
          const PricingCreateQuoteRequest(
            pickup: Coordinates(lat: 14.4, lng: 33.52),
            destination: Coordinates(lat: 14.42, lng: 33.53),
          ),
        );
        expect(quote.minimumFare.amountMinor, 22500);
        expect(quote.route.distanceMeters, 2500);
        expect(quote.pickup.lat, 14.4);
      });

      test('ride and offer lifecycle bodies', () async {
        final bodies = {
          'rides.create': (Object? json) =>
              PassengerRide.fromJson(json! as Map<String, Object?>),
          'rides.get.assigned': (Object? json) =>
              PassengerRide.fromJson(json! as Map<String, Object?>),
          'rides.list': (Object? json) =>
              RidesListResponse.fromJson(json! as Map<String, Object?>),
          'driverOffers.list': (Object? json) =>
              DriverOffersListResponse.fromJson(json! as Map<String, Object?>),
          'driverOffers.accept': (Object? json) =>
              DriverRide.fromJson(json! as Map<String, Object?>),
          'driverRides.complete': (Object? json) =>
              DriverRide.fromJson(json! as Map<String, Object?>),
          'finance.reportCashCollection': (Object? json) =>
              RidePayment.fromJson(json! as Map<String, Object?>),
          'drivers.getProfile': (Object? json) =>
              DriverProfile.fromJson(json! as Map<String, Object?>),
        };
        for (final MapEntry(key: name, value: decode) in bodies.entries) {
          expect(() => decode(fixture(name)), returnsNormally, reason: name);
        }
        final assigned = PassengerRide.fromJson(
          fixture('rides.get.assigned')! as Map<String, Object?>,
        );
        expect(assigned.status, PassengerRideStatus.driverAssigned);
        expect(assigned.driver, isNotNull);
        final completed = DriverRide.fromJson(
          fixture('driverRides.complete')! as Map<String, Object?>,
        );
        expect(completed.status, DriverRideStatus.completed);
      });

      test('round-trip through toJson unchanged', () {
        for (final name in [
          'rides.get.assigned',
          'driverRides.complete',
          'identity.getMe',
        ]) {
          final json = fixture(name)! as Map<String, Object?>;
          final model = switch (name) {
            'identity.getMe' => Me.fromJson(json).toJson(),
            'driverRides.complete' => DriverRide.fromJson(json).toJson(),
            _ => PassengerRide.fromJson(json).toJson(),
          };
          expect(model, json, reason: name);
        }
      });
    },
  );

  group('compatibility (API_CONVENTIONS §1)', () {
    test('ignores unknown fields and tolerates unknown enum values', () {
      final json =
          Map<String, Object?>.of(
              fixture('identity.getMe')! as Map<String, Object?>,
            )
            ..['newField'] = {'nested': true}
            ..['status'] = 'on_holiday'
            ..['roles'] = ['passenger', 'merchant'];
      final me = Me.fromJson(json);
      expect(me.status, MeStatus.$unknown);
      expect(me.roles, [MeRolesItem.passenger, MeRolesItem.$unknown]);
      expect(() => MeStatus.$unknown.toJson(), throwsStateError);
    });
  });

  group('errors', () {
    test('problem responses become ApiProblem', () async {
      final (:api, http: _) = apiWith(
        (_) async => jsonResponse(
          422,
          fixture('problem.FARE_BELOW_MINIMUM'),
          headers: {'content-type': 'application/problem+json'},
        ),
      );
      await expectLater(
        api.rides.create(
          const RidesCreateRequest(
            quoteId: 'q',
            proposedFare: MoneyInput(amountMinor: 1, currency: 'SDG'),
          ),
          idempotencyKey: 'k',
        ),
        throwsA(
          isA<ApiProblem>()
              .having((p) => p.status, 'status', 422)
              .having((p) => p.code, 'code', ProblemCodes.fareBelowMinimum)
              .having((p) => p.requestId, 'requestId', isNotNull),
        ),
      );
    });

    test('validation errors, Retry-After and rate limits', () async {
      final (:api, http: _) = apiWith(
        (_) async => jsonResponse(
          429,
          {
            'type': 'https://docs.taketuk.app/problems/rate-limited',
            'title': 'Too many requests',
            'status': 429,
            'code': 'RATE_LIMITED',
            'detail': 'Too many quotes; try again shortly.',
            'requestId': 'r-1',
            'errors': [
              {'path': 'pickup.lat', 'message': 'Too big'},
            ],
          },
          headers: {'retry-after': '60'},
        ),
      );
      final problem = await api.identity.getMe().then<ApiProblem?>(
        (_) => null,
        onError: (Object e) => e as ApiProblem,
      );
      expect(problem!.retryAfter, const Duration(seconds: 60));
      expect(problem.errors.single.path, 'pickup.lat');
    });

    test(
      'network failures, timeouts and bare 5xx are ApiUnavailable',
      () async {
        final failures = <Future<http.Response> Function(http.Request)>[
          (_) async => throw http.ClientException('connection refused'),
          (_) async => http.Response('<html>Bad Gateway</html>', 502),
          (_) async => http.Response('', 503),
        ];
        for (final (index, respond) in failures.indexed) {
          final (:api, http: _) = apiWith(respond);
          await expectLater(
            api.identity.getMe(),
            throwsA(
              isA<ApiUnavailable>().having(
                (e) => e.reachedServer,
                'reachedServer',
                index > 0,
              ),
            ),
          );
        }
        final (:api, http: _) = apiWith(
          (_) => Completer<http.Response>().future,
          timeout: const Duration(milliseconds: 50),
        );
        await expectLater(api.identity.getMe(), throwsA(isA<ApiUnavailable>()));
      },
    );

    test('responses outside the contract are ApiContractViolation', () async {
      final violations = <Future<http.Response> Function(http.Request)>[
        (_) async =>
            jsonResponse(200, {'userId': 'u'}), // required fields missing
        (_) async => jsonResponse(200, ['not', 'an', 'object']),
        (_) async => jsonResponse(400, {'message': 'not a problem document'}),
        (_) async => http.Response('not json', 200),
      ];
      for (final respond in violations) {
        final (:api, http: _) = apiWith(respond);
        await expectLater(
          api.identity.getMe(),
          throwsA(isA<ApiContractViolation>()),
        );
      }
    });
  });

  test('idempotency keys are random UUID v4 values', () {
    final keys = {for (var i = 0; i < 100; i++) newIdempotencyKey()};
    expect(keys, hasLength(100));
    for (final key in keys) {
      expect(
        key,
        matches(
          RegExp(
            r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          ),
        ),
      );
    }
  });
}

http.Response noContent() => http.Response('', 204);
