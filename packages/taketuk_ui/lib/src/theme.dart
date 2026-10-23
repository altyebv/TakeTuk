import 'package:flutter/material.dart';

/// TAKE-TUK brand seed. Material 3 derives an accessible palette from it.
const Color taketukSeedColor = Color(0xFF0B6E4F);

/// The shared app theme. Larger touch targets and text suit low-end phones used outdoors.
ThemeData taketukTheme({Brightness brightness = Brightness.light}) {
  final scheme = ColorScheme.fromSeed(
    seedColor: taketukSeedColor,
    brightness: brightness,
  );
  return ThemeData(
    colorScheme: scheme,
    visualDensity: VisualDensity.standard,
    materialTapTargetSize: MaterialTapTargetSize.padded,
    inputDecorationTheme: const InputDecorationTheme(
      border: OutlineInputBorder(),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
      ),
    ),
  );
}
