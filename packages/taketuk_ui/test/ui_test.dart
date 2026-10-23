import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

Future<BuildContext> _contextFor(WidgetTester tester, Locale locale) async {
  late BuildContext captured;
  await tester.pumpWidget(
    MaterialApp(
      locale: locale,
      supportedLocales: taketukSupportedLocales,
      localizationsDelegates: const [
        TaketukUiLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: Builder(
        builder: (context) {
          captured = context;
          return const SizedBox();
        },
      ),
    ),
  );
  return captured;
}

ApiProblem _problem(String code, {int status = 400, String? requestId}) =>
    ApiProblem(
      status: status,
      code: code,
      title: 'English title for logs',
      detail: 'English detail for logs',
      requestId: requestId,
    );

void main() {
  testWidgets('Arabic is the default and lays out right to left', (
    tester,
  ) async {
    expect(
      resolveTaketukLocale([const Locale('fr'), const Locale('de')]),
      const Locale('ar'),
    );
    expect(
      resolveTaketukLocale([const Locale('en', 'GB')]),
      const Locale('en'),
    );
    expect(resolveTaketukLocale(null), const Locale('ar'));
    final context = await _contextFor(tester, const Locale('ar'));
    expect(Directionality.of(context), TextDirection.rtl);
  });

  testWidgets('maps errors any operation can return to localized messages', (
    tester,
  ) async {
    final en = await _contextFor(tester, const Locale('en'));
    expect(
      describeError(en, const ApiUnavailable('network error')),
      contains('No connection'),
    );
    expect(
      describeError(en, const ApiUnavailable('HTTP 502', reachedServer: true)),
      contains('temporarily unavailable'),
    );
    expect(
      describeError(
        en,
        _problem(ProblemCodes.authenticationRequired, status: 401),
      ),
      contains('sign in'),
    );
    expect(
      describeError(en, _problem(ProblemCodes.rateLimited, status: 429)),
      contains('Too many'),
    );
    expect(
      describeError(
        en,
        _problem(ProblemCodes.databaseUnavailable, status: 503),
      ),
      contains('temporarily'),
    );
    expect(
      describeError(en, const ApiContractViolation('shape')),
      contains('update'),
    );
    // Server titles and details are never shown to users.
    expect(
      describeError(en, _problem('SOMETHING_NEW')),
      isNot(contains('English')),
    );
    expect(
      supportReference(en, _problem('X', requestId: 'req-42')),
      'Reference: req-42',
    );

    final ar = await _contextFor(tester, const Locale('ar'));
    expect(
      describeError(ar, const ApiUnavailable('network error')),
      'لا يوجد اتصال. تحقّق من الإنترنت وحاول مرة أخرى.',
    );
  });

  testWidgets('formats integer minor units with the currency', (tester) async {
    final en = await _contextFor(tester, const Locale('en'));
    expect(
      formatMoney(en, const Money(amountMinor: 2250000, currency: 'SDG')),
      '22,500.00 SDG',
    );
    expect(formatMinorUnits(en, 5, 'SDG'), '0.05 SDG');
    expect(formatMinorUnits(en, 1000000000000, 'SDG'), '10,000,000,000.00 SDG');
    final ar = await _contextFor(tester, const Locale('ar'));
    expect(formatMinorUnits(ar, 2250000, 'SDG'), endsWith('ج.س'));
  });

  testWidgets('BusyButton ignores taps while its action runs', (tester) async {
    var runs = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: BusyButton(
            label: 'Go',
            onPressed: () async {
              runs++;
              await Future<void>.delayed(const Duration(milliseconds: 100));
            },
          ),
        ),
      ),
    );
    await tester.tap(find.text('Go'));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    await tester.tap(find.byType(FilledButton));
    await tester.pump(const Duration(milliseconds: 150));
    expect(runs, 1);
    expect(find.text('Go'), findsOneWidget);
  });
}
