import 'package:taketuk_api/taketuk_api.dart';
import 'package:taketuk_auth/taketuk_auth.dart';

abstract final class Routes {
  static const starting = '/starting';
  static const signIn = '/sign-in';
  static const signInCode = '/sign-in/code';
  static const register = '/register';
  static const accountError = '/account-error';
  static const home = '/';
  static const rides = '/rides';
  static String ride(String id) => '/rides/${Uri.encodeComponent(id)}';
}

bool isPassenger(Me? me) =>
    me != null && me.registered && me.roles.contains(MeRolesItem.passenger);

/// Where the session state sends the user (null: stay). Pure, so it is unit-tested directly.
String? passengerRedirect(SessionStatus status, Me? me, String location) {
  final target = switch (status) {
    SessionStatus.starting || SessionStatus.loadingAccount => Routes.starting,
    SessionStatus.signedOut =>
      location.startsWith(Routes.signIn) ? location : Routes.signIn,
    SessionStatus.accountError => Routes.accountError,
    SessionStatus.ready when !isPassenger(me) => Routes.register,
    SessionStatus.ready =>
      const {
            Routes.starting,
            Routes.signIn,
            Routes.signInCode,
            Routes.register,
            Routes.accountError,
          }.contains(location)
          ? Routes.home
          : location,
  };
  return target == location ? null : target;
}
