import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:go_router/go_router.dart';
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_auth/taketuk_auth.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

import 'l10n/passenger_localizations.dart';
import 'ride/history_screen.dart';
import 'ride/ride_screen.dart';
import 'ride/trip_planner_screen.dart';
import 'routing.dart';
import 'screens.dart';

class PassengerApp extends StatefulWidget {
  const PassengerApp({
    required this.auth,
    required this.api,
    required this.session,
    required this.mapSettings,
    required this.location,
    this.ridePollInterval = const Duration(seconds: 4),
    super.key,
  });

  final AuthGateway auth;
  final TaketukApi api;
  final SessionController session;
  final MapSettings mapSettings;
  final DeviceLocation location;
  final Duration ridePollInterval;

  @override
  State<PassengerApp> createState() => _PassengerAppState();
}

class _PassengerAppState extends State<PassengerApp> {
  late final GoRouter _router = GoRouter(
    initialLocation: Routes.starting,
    refreshListenable: widget.session,
    redirect: (context, state) => passengerRedirect(
      widget.session.status,
      widget.session.me,
      state.matchedLocation,
    ),
    routes: [
      GoRoute(path: Routes.starting, builder: (_, _) => const StartingScreen()),
      GoRoute(
        path: Routes.signIn,
        builder: (context, _) => PhoneEntryScreen(
          auth: widget.auth,
          heading: PassengerLocalizations.of(context).appName,
          onCodeSent: (phone) => context.go(
            Uri(
              path: Routes.signInCode,
              queryParameters: {'phone': phone},
            ).toString(),
          ),
        ),
        routes: [
          GoRoute(
            path: 'code',
            builder: (context, state) => CodeEntryScreen(
              auth: widget.auth,
              phoneE164: state.uri.queryParameters['phone'] ?? '',
              onChangeNumber: () => context.go(Routes.signIn),
            ),
          ),
        ],
      ),
      GoRoute(
        path: Routes.register,
        builder: (_, _) =>
            RegisterScreen(api: widget.api, session: widget.session),
      ),
      GoRoute(
        path: Routes.accountError,
        builder: (_, _) => AccountErrorScreen(session: widget.session),
      ),
      GoRoute(
        path: Routes.home,
        builder: (context, _) => TripPlannerScreen(
          api: widget.api,
          mapSettings: widget.mapSettings,
          location: widget.location,
          onRide: (id) => context.go(Routes.ride(id)),
          onHistory: () => context.push(Routes.rides),
          onSignOut: widget.session.signOut,
        ),
      ),
      GoRoute(
        path: Routes.rides,
        builder: (context, _) => HistoryScreen(
          api: widget.api,
          onOpen: (id) => context.push(Routes.ride(id)),
        ),
        routes: [
          GoRoute(
            path: ':id',
            builder: (context, state) => RideScreen(
              key: ValueKey(state.pathParameters['id']),
              api: widget.api,
              rideId: state.pathParameters['id']!,
              mapSettings: widget.mapSettings,
              pollInterval: widget.ridePollInterval,
              onNewRide: () => context.go(Routes.home),
            ),
          ),
        ],
      ),
    ],
  );

  @override
  void dispose() {
    _router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp.router(
    onGenerateTitle: (context) => PassengerLocalizations.of(context).appName,
    theme: taketukTheme(),
    routerConfig: _router,
    supportedLocales: taketukSupportedLocales,
    localeListResolutionCallback: (preferred, _) =>
        resolveTaketukLocale(preferred),
    localizationsDelegates: const [
      PassengerLocalizations.delegate,
      TaketukAuthLocalizations.delegate,
      TaketukUiLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
  );
}
