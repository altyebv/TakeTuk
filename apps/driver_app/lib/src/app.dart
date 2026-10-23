import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:go_router/go_router.dart';
import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_auth/taketuk_auth.dart';
import 'package:taketuk_ui/taketuk_ui.dart';

import 'l10n/driver_localizations.dart';
import 'routing.dart';
import 'screens.dart';

class DriverApp extends StatefulWidget {
  const DriverApp({
    required this.auth,
    required this.api,
    required this.session,
    required this.serviceAreaCode,
    super.key,
  });

  final AuthGateway auth;
  final TaketukApi api;
  final SessionController session;

  /// The service area new drivers apply for (`SERVICE_AREA_CODE`).
  final String serviceAreaCode;

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
        builder: (context, _) => PhoneEntryScreen(
          auth: widget.auth,
          heading: DriverLocalizations.of(context).appName,
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
        builder: (_, _) => HomeScreen(api: widget.api, session: widget.session),
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
