import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';

import 'support.dart';

Future<void> placeTrip(WidgetTester tester) async {
  final map = tester.getTopLeft(find.byKey(const Key('tripMap')));
  await tester.tapAt(map + const Offset(120, 120));
  await settle(tester);
  await tester.tapAt(map + const Offset(260, 200));
  await settle(tester);
}

void main() {
  testWidgets('quotes a trip, raises the offer and requests the ride', (
    tester,
  ) async {
    final backend = await pumpPassengerApp(tester);
    expect(find.text('Tap the map to set your pickup point.'), findsOneWidget);
    expect(find.text('See price'), findsOneWidget);

    await placeTrip(tester);
    expect(find.byKey(const Key('pickupMarker')), findsOneWidget);
    expect(find.byKey(const Key('destinationMarker')), findsOneWidget);

    await tester.enterText(
      find.byType(TextField).first,
      'University main gate',
    );
    await tester.tap(find.text('See price'));
    await settle(tester);

    final quoteBody = jsonDecode(
      backend.requestsTo('POST', '/v1/fare-quotes').single.body,
    ) as Map<String, Object?>;
    expect(quoteBody['pickupLabel'], 'University main gate');
    expect(quoteBody.containsKey('destinationLabel'), isFalse);
    expect((quoteBody['pickup']! as Map)['lat'], isA<double>());
    expect(find.text('Minimum fare: 225.00 SDG'), findsOneWidget);
    expect(find.text('2.5 km · about 10 min'), findsOneWidget);
    expect(find.text('Your offer: 225.00 SDG'), findsOneWidget);

    // Never below the minimum fare.
    await tester.tap(find.byKey(const Key('lowerOffer')));
    await tester.pump();
    expect(find.text('Your offer: 225.00 SDG'), findsOneWidget);
    await tester.tap(find.byKey(const Key('raiseOffer')));
    await tester.pump();
    expect(find.text('Your offer: 235.00 SDG'), findsOneWidget);

    await tester.tap(find.text('Request ride'));
    await settle(tester);
    final create = backend.requestsTo('POST', '/v1/rides').single;
    expect(create.headers['Idempotency-Key'], hasLength(36));
    expect(jsonDecode(create.body), {
      'quoteId': '22efd9d2-1fa5-4f27-959a-79c3e919d506',
      'proposedFare': {'amountMinor': 23500, 'currency': 'SDG'},
    });
    expect(find.text('Looking for a driver'), findsOneWidget);
    expect(find.text('Your offer: 235.00 SDG'), findsOneWidget);
  });

  testWidgets(
    'a retried request keeps its idempotency key; a new offer does not',
    (tester) async {
      final backend = await pumpPassengerApp(tester)
        ..failRideCreates = 2;
      await placeTrip(tester);
      await tester.tap(find.text('See price'));
      await settle(tester);

      await tester.tap(find.text('Request ride'));
      await settle(tester);
      expect(find.textContaining('No connection'), findsOneWidget);
      await tester.tap(find.text('Request ride'));
      await settle(tester);
      await tester.tap(find.byKey(const Key('raiseOffer')));
      await tester.pump();
      await tester.tap(find.text('Request ride'));
      await settle(tester);

      final keys = backend
          .requestsTo('POST', '/v1/rides')
          .map((r) => r.headers['Idempotency-Key'])
          .toList();
      expect(keys, hasLength(3));
      expect(keys[1], keys[0]);
      expect(keys[2], isNot(keys[0]));
      expect(find.text('Looking for a driver'), findsOneWidget);
    },
  );

  testWidgets('explains quotes outside the service area', (tester) async {
    final backend = await pumpPassengerApp(tester)
      ..nextQuoteResponse = problem(422, 'OUTSIDE_SERVICE_AREA');
    await placeTrip(tester);
    await tester.tap(find.text('See price'));
    await settle(tester);
    expect(find.textContaining('not available there yet'), findsOneWidget);
    expect(backend.requestsTo('POST', '/v1/rides'), isEmpty);
  });

  testWidgets('follows the ride: counteroffer, assignment, arrival, payment', (
    tester,
  ) async {
    final backend = FakeBackend()
      ..ride = {
        ...fixture('rides.create'),
        'negotiation': {
          'driversNotified': 2,
          'counteroffers': [counteroffer()],
        },
      };
    await pumpPassengerApp(tester, backend: backend);

    // An open ride is resumed instead of starting a new trip.
    expect(find.text('Looking for a driver'), findsOneWidget);
    expect(find.text('2 drivers notified'), findsOneWidget);
    expect(find.text('Musa offers 260.00 SDG'), findsOneWidget);

    await tester.tap(find.text('Accept'));
    await settle(tester);
    expect(
      backend.requestsTo(
        'POST',
        '/v1/rides/${backend.ride!['id']}/offers/offer-1/accept-counteroffer',
      ),
      hasLength(1),
    );
    expect(find.text('Musa is on the way'), findsOneWidget);
    expect(find.text('Raksha · GZ 128259'), findsOneWidget);
    expect(find.text('Fare: 260.00 SDG'), findsOneWidget);

    backend.ride = {...backend.ride!, 'status': 'driver_arrived'};
    await tester.pump(const Duration(seconds: 1));
    await settle(tester);
    expect(find.text('Your driver has arrived'), findsOneWidget);

    backend.ride = {...backend.ride!, 'status': 'completed'};
    await tester.pump(const Duration(seconds: 1));
    await settle(tester);
    expect(find.text('Pay 260.00 SDG in cash'), findsOneWidget);
    expect(find.text('Cancel ride'), findsNothing);

    // Polling stops once the ride has ended.
    final polls = backend
        .requestsTo('GET', '/v1/rides/${backend.ride!['id']}')
        .length;
    await tester.pump(const Duration(seconds: 5));
    expect(
      backend.requestsTo('GET', '/v1/rides/${backend.ride!['id']}'),
      hasLength(polls),
    );

    await tester.tap(find.text('Request a new ride'));
    await settle(tester);
    expect(find.text('See price'), findsOneWidget);
  });

  testWidgets('cancels with a reason', (tester) async {
    final backend = FakeBackend()..ride = fixture('rides.create');
    await pumpPassengerApp(tester, backend: backend);
    await tester.tap(find.text('Cancel ride'));
    await settle(tester);
    await tester.enterText(
      find.byKey(const Key('cancelReason')),
      'Changed my plans',
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Cancel ride'));
    await settle(tester);
    final cancel = backend
        .requestsTo('POST', '/v1/rides/${backend.ride!['id']}/cancel')
        .single;
    expect(jsonDecode(cancel.body), {'reason': 'Changed my plans'});
    expect(find.text('This ride was cancelled'), findsOneWidget);
  });

  testWidgets('uses the device position for the pickup when available', (
    tester,
  ) async {
    final location = FakeDeviceLocation(null);
    await pumpPassengerApp(tester, location: location);
    await tester.tap(find.text('Use my location'));
    await settle(tester);
    expect(
      find.textContaining('Your location is not available'),
      findsOneWidget,
    );
    expect(find.byKey(const Key('pickupMarker')), findsNothing);

    location.position = const LatLng(14.401, 33.52);
    await tester.tap(find.text('Use my location'));
    await settle(tester);
    expect(find.byKey(const Key('pickupMarker')), findsOneWidget);
    expect(find.text('Tap the map to set your destination.'), findsOneWidget);
  });

  testWidgets('lists past rides and opens one', (tester) async {
    final completed = {...fixture('rides.get.assigned'), 'status': 'completed'};
    final backend = FakeBackend()..history = [completed];
    await pumpPassengerApp(tester, backend: backend);
    await tester.tap(find.byTooltip('My rides'));
    await settle(tester);
    expect(find.text('Souq'), findsOneWidget);
    expect(find.textContaining('Completed'), findsOneWidget);
    backend.ride = completed;
    await tester.tap(find.text('Souq'));
    await settle(tester);
    expect(find.text('You have arrived'), findsOneWidget);
  });

  testWidgets('works in Arabic, right to left', (tester) async {
    await pumpPassengerApp(tester, locale: const Locale('ar'));
    expect(find.text('اضغط على الخريطة لتحديد نقطة الانطلاق.'), findsOneWidget);
    expect(
      Directionality.of(tester.element(find.text('اعرض السعر'))),
      TextDirection.rtl,
    );
  });
}
