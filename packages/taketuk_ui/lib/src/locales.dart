import 'package:flutter/widgets.dart';

/// Arabic first: it is the default for every device whose preferred language is not English.
const List<Locale> taketukSupportedLocales = [Locale('ar'), Locale('en')];

/// Picks the first supported language from the device preferences, defaulting to Arabic.
Locale resolveTaketukLocale(List<Locale>? preferred) {
  for (final locale in preferred ?? const <Locale>[]) {
    for (final supported in taketukSupportedLocales) {
      if (supported.languageCode == locale.languageCode) return supported;
    }
  }
  return taketukSupportedLocales.first;
}
