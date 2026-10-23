import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support.dart';

Future<void> uploadVia(WidgetTester tester, String documentKey) async {
  await tester.tap(
    find.descendant(
      of: find.byKey(Key('doc-$documentKey')),
      matching: find.byType(TextButton),
    ),
  );
  await settle(tester);
  await tester.tap(find.text('Take a photo'));
  await settle(tester);
}

void main() {
  testWidgets('an applicant uploads documents, adds a vehicle and submits', (
    tester,
  ) async {
    final backend = FakeDriverBackend(
      profile: {
        ...fixture('drivers.getProfile'),
        'status': 'applicant',
        'availability': 'offline',
        'activeVehicleId': null,
      },
    )..vehicles = [];
    await pumpDriverApp(tester, backend: backend);

    expect(find.text('Your documents'), findsOneWidget);
    expect(find.text('Not uploaded yet'), findsNWidgets(3));
    BusyButtonFinder.submitDisabled(tester);

    for (final type in ['driver_photo', 'driving_license', 'national_id']) {
      await uploadVia(tester, type);
    }
    expect(find.text('Uploaded'), findsNWidgets(3));

    // Each upload: a signed URL from the API, the bytes to storage, then confirmation.
    final grants = backend.requestsTo(
      'POST',
      '/v1/driver/documents/upload-requests',
    );
    expect(grants.map((r) => backend.body(r)['documentType']), [
      'driver_photo',
      'driving_license',
      'national_id',
    ]);
    expect(backend.body(grants.first), {
      'documentType': 'driver_photo',
      'contentType': 'image/jpeg',
    });
    expect(backend.uploads, hasLength(3));
    expect(backend.uploads.first.method, 'PUT');
    expect(
      backend.uploads.first.url.toString(),
      'https://storage.example/upload/doc-1?token=t',
    );
    expect(backend.uploads.first.headers['content-type'], 'image/jpeg');
    expect(backend.uploads.first.bodyBytes.take(3), [0xFF, 0xD8, 0xFF]);
    // Uploads never carry the API token to storage.
    expect(backend.uploads.first.headers.containsKey('Authorization'), isFalse);
    expect(
      backend.requests.where((r) => r.url.path.endsWith('/confirm')),
      hasLength(3),
    );

    await tester.tap(find.text('Add your vehicle'));
    await settle(tester);
    await tester.enterText(find.byKey(const Key('plate')), 'GZ 5678');
    await settle(tester);
    await tester.tap(find.text('Save'));
    await settle(tester);
    expect(
      backend.body(backend.requestsTo('POST', '/v1/driver/vehicles').single),
      {'vehicleTypeCode': 'raksha', 'plateNumber': 'GZ 5678'},
    );
    expect(find.text('Waiting for review'), findsOneWidget);

    await uploadVia(tester, 'vehicle_registration');
    await uploadVia(tester, 'vehicle_photo');
    final vehicleGrant = backend.body(
      backend.requestsTo('POST', '/v1/driver/documents/upload-requests').last,
    );
    expect(vehicleGrant['vehicleId'], 'vehicle-1');

    await tester.scrollUntilVisible(find.text('Submit for review'), 300);
    await tester.tap(find.text('Submit for review'));
    await settle(tester);
    expect(
      backend.requestsTo('POST', '/v1/driver/verification/submit'),
      hasLength(1),
    );
    expect(find.text('Your application is being reviewed.'), findsOneWidget);
  });

  testWidgets('a rejected applicant sees the reviewer note', (tester) async {
    await pumpDriverApp(
      tester,
      backend: FakeDriverBackend(
        profile: {
          ...fixture('drivers.getProfile'),
          'status': 'rejected',
          'reviewNote': 'Licence photo unreadable',
          'availability': 'offline',
          'activeVehicleId': null,
        },
      ),
    );
    expect(find.text('Your application was not approved.'), findsOneWidget);
    expect(
      find.text("Reviewer's note: Licence photo unreadable"),
      findsOneWidget,
    );
    await tester.scrollUntilVisible(find.text('Submit for review'), 300);
    expect(find.text('Submit for review'), findsOneWidget);
  });

  testWidgets(
    'goes online, reports its position, accepts an offer and completes the trip',
    (tester) async {
      final backend = FakeDriverBackend();
      await pumpDriverApp(tester, backend: backend);
      expect(find.text('Offline'), findsOneWidget);

      await tester.tap(find.text('Go online'));
      await settle(tester);
      expect(
        backend.body(
          backend.requestsTo('PUT', '/v1/driver/availability').single,
        ),
        {'availability': 'online', 'vehicleId': 'vehicle-1'},
      );
      final position = backend.body(
        backend.requestsTo('PUT', '/v1/driver/location').first,
      );
      expect(position['lat'], 14.401);
      expect(DateTime.parse(position['recordedAt']! as String).isUtc, isTrue);
      expect(find.text('Waiting for ride offers…'), findsOneWidget);

      backend.offers = [
        ...(fixture('driverOffers.list')['items']! as List)
            .cast<Map<String, Object?>>(),
      ];
      await tester.pump(const Duration(seconds: 1));
      await settle(tester);
      expect(find.text('Hiba offers 250.00 SDG'), findsOneWidget);
      expect(find.text('Minimum fare 225.00 SDG'), findsOneWidget);

      await tester.tap(find.text('Accept'));
      await settle(tester);
      expect(find.text('Go to the pickup'), findsOneWidget);
      expect(find.text('Hiba'), findsOneWidget);

      await tester.tap(find.text('I have arrived'));
      await settle(tester);
      await tester.tap(find.text('Start trip'));
      await settle(tester);
      expect(find.text('Trip in progress'), findsOneWidget);
      await tester.tap(find.text('Complete trip'));
      await settle(tester);
      expect(find.text('Collect 250.00 SDG in cash'), findsOneWidget);

      // A poll while the cash is unreported keeps the trip on screen.
      await tester.pump(const Duration(seconds: 1));
      await settle(tester);
      expect(find.text('Collect 250.00 SDG in cash'), findsOneWidget);

      await tester.tap(find.text('Collected 250.00 SDG'));
      await settle(tester);
      final rideId = backend.ride!['id'];
      expect(
        backend.body(
          backend
              .requestsTo('POST', '/v1/driver/rides/$rideId/cash-collection')
              .single,
        ),
        {
          'outcome': 'collected',
          'amountCollected': {'amountMinor': 25000, 'currency': 'SDG'},
        },
      );
      expect(find.text('Payment recorded.'), findsOneWidget);
      expect(find.text('Online'), findsOneWidget);
    },
  );

  testWidgets('proposes a higher fare', (tester) async {
    final backend = FakeDriverBackend()
      ..profile = {
        ...fixture('drivers.getProfile'),
        'userId': 'user-1',
        'availability': 'online',
      }
      ..offers = [
        ...(fixture('driverOffers.list')['items']! as List)
            .cast<Map<String, Object?>>(),
      ];
    await pumpDriverApp(tester, backend: backend);
    await tester.tap(find.text('Propose a fare'));
    await settle(tester);
    expect(find.text('260'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('amount')), '250');
    await settle(tester);
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Send'))
          .onPressed,
      isNull,
      reason: 'a counteroffer must be above the passenger offer',
    );
    await tester.enterText(find.byKey(const Key('amount')), '270');
    await settle(tester);
    await tester.tap(find.text('Send'));
    await settle(tester);
    final offerId = backend.offers.single['offerId'];
    expect(
      backend.body(
        backend
            .requestsTo('POST', '/v1/driver/offers/$offerId/counteroffer')
            .single,
      ),
      {
        'amount': {'amountMinor': 27000, 'currency': 'SDG'},
      },
    );
    expect(
      find.text('You proposed 270.00 SDG. Waiting for the passenger.'),
      findsOneWidget,
    );
  });

  testWidgets('warns when the position is unavailable while online', (
    tester,
  ) async {
    final backend = FakeDriverBackend()
      ..profile = {
        ...fixture('drivers.getProfile'),
        'userId': 'user-1',
        'availability': 'online',
      };
    await pumpDriverApp(
      tester,
      backend: backend,
      location: FakeDeviceLocation(null),
    );
    expect(
      find.textContaining('Your location is not available'),
      findsOneWidget,
    );
    expect(backend.requestsTo('PUT', '/v1/driver/location'), isEmpty);
  });

  testWidgets('shows a trip the passenger cancelled until dismissed', (
    tester,
  ) async {
    final backend = FakeDriverBackend()
      ..profile = {
        ...fixture('drivers.getProfile'),
        'userId': 'user-1',
        'availability': 'online',
      }
      ..ride = fixture('driverOffers.accept');
    await pumpDriverApp(tester, backend: backend);
    expect(find.text('Go to the pickup'), findsOneWidget);

    backend.ride = {...backend.ride!, 'status': 'cancelled'};
    await tester.pump(const Duration(seconds: 1));
    await settle(tester);
    expect(find.text('This ride was cancelled'), findsOneWidget);
    await tester.tap(find.text('Done'));
    await settle(tester);
    expect(find.text('Online'), findsOneWidget);
  });

  testWidgets('cancelling requires a reason of at least 3 characters', (
    tester,
  ) async {
    final backend = FakeDriverBackend()
      ..profile = {
        ...fixture('drivers.getProfile'),
        'userId': 'user-1',
        'availability': 'online',
      }
      ..ride = fixture('driverOffers.accept');
    await pumpDriverApp(tester, backend: backend);
    await tester.tap(find.text('Cancel ride'));
    await settle(tester);
    await tester.enterText(find.byKey(const Key('cancelReason')), 'no');
    await settle(tester);
    expect(find.text('Enter at least 3 characters.'), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('cancelReason')),
      'Vehicle broke down',
    );
    await settle(tester);
    await tester.tap(find.widgetWithText(FilledButton, 'Cancel ride'));
    await settle(tester);
    final rideId = backend.ride!['id'];
    expect(
      backend.body(
        backend.requestsTo('POST', '/v1/driver/rides/$rideId/cancel').single,
      ),
      {'reason': 'Vehicle broke down'},
    );
    expect(find.text('This ride was cancelled'), findsOneWidget);
  });

  testWidgets('shows earnings and commission owed', (tester) async {
    await pumpDriverApp(tester);
    await tester.tap(find.byTooltip('Earnings'));
    await settle(tester);
    expect(find.text('Commission owed: 25.00 SDG'), findsOneWidget);
    expect(find.text('Fare 250.00 SDG · commission 25.00 SDG'), findsOneWidget);
  });
}

abstract final class BusyButtonFinder {
  static void submitDisabled(WidgetTester tester) {
    final button = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Submit for review'),
    );
    expect(button.onPressed, isNull);
  }
}
