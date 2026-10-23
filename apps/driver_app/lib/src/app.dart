import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_auth/taketuk_auth.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

import 'earnings_screen.dart';
import 'l10n/driver_localizations.dart';
import 'onboarding/documents.dart';
import 'routing.dart';
import 'screens.dart';

class DriverApp extends StatefulWidget {
  const DriverApp({
    required this.auth,
    required this.api,
    required this.session,
    required this.serviceAreaCode,
    required this.mapSettings,
    required this.location,
    required this.picker,
    required this.storage,
    this.signInMethod = SignInMethod.phone,
    this.pollInterval = const Duration(seconds: 4),
    this.locationInterval = const Duration(seconds: 15),
    super.key,
  });

  final AuthGateway auth;
  final TaketukApi api;
  final SessionController session;

  /// How sign-in codes are sent (`SIGN_IN_METHOD`).
  final SignInMethod signInMethod;

  /// The service area new drivers apply for (`SERVICE_AREA_CODE`).
  final String serviceAreaCode;
  final MapSettings mapSettings;
  final DeviceLocation location;
  final DocumentPicker picker;

  /// HTTP client for document uploads to signed storage URLs.
  final http.Client storage;
  final Duration pollInterval;
  final Duration locationInterval;

  @override
  State<DriverApp> createState() => _DriverAppState();
}

class _DriverAppState extends State<DriverApp> {
  late final GoRouter _router = GoRouter(
    initialLocation: Routes.starting,
    refreshListenable: widget.session,
    redirect: (context, state) => driverRedirect(
      widget.session.status,
      widget.session.me,
      state.matchedLocation,
    ),
    routes: [
      GoRoute(path: Routes.starting, builder: (_, _) => const StartingScreen()),
      GoRoute(
        path: Routes.signIn,
        builder: (context, _) => SignInScreen(
          auth: widget.auth,
          method: widget.signInMethod,
          heading: DriverLocalizations.of(context).appName,
          onCodeSent: (address) => context.go(
            Uri(
              path: Routes.signInCode,
              queryParameters: address.toQuery(),
            ).toString(),
          ),
        ),
        routes: [
          GoRoute(
            path: 'code',
            redirect: (_, state) =>
                SignInAddress.fromQuery(state.uri.queryParameters) == null
                ? Routes.signIn
                : null,
            builder: (context, state) => CodeEntryScreen(
              auth: widget.auth,
              address: SignInAddress.fromQuery(state.uri.queryParameters)!,
              onChangeAddress: () => context.go(Routes.signIn),
            ),
          ),
        ],
      ),
      GoRoute(
        path: Routes.register,
        builder: (_, _) => RegisterScreen(
          api: widget.api,
          session: widget.session,
          serviceAreaCode: widget.serviceAreaCode,
        ),
      ),
      GoRoute(
        path: Routes.accountError,
        builder: (_, _) => AccountErrorScreen(session: widget.session),
      ),
      GoRoute(
        path: Routes.home,
        builder: (context, _) => HomeScreen(
          api: widget.api,
          session: widget.session,
          mapSettings: widget.mapSettings,
          location: widget.location,
          picker: widget.picker,
          storage: widget.storage,
          pollInterval: widget.pollInterval,
          locationInterval: widget.locationInterval,
          onEarnings: () => context.push(Routes.earnings),
        ),
      ),
      GoRoute(
        path: Routes.earnings,
        builder: (_, _) => EarningsScreen(api: widget.api),
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
    onGenerateTitle: (context) => DriverLocalizations.of(context).appName,
    theme: taketukTheme(),
    routerConfig: _router,
    supportedLocales: taketukSupportedLocales,
    localeListResolutionCallback: (preferred, _) =>
        resolveTaketukLocale(preferred),
    localizationsDelegates: const [
      DriverLocalizations.delegate,
      TaketukAuthLocalizations.delegate,
      TaketukUiLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
  );
}
