// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'passenger_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Arabic (`ar`).
class PassengerLocalizationsAr extends PassengerLocalizations {
  PassengerLocalizationsAr([String locale = 'ar']) : super(locale);

  @override
  String get appName => 'تك تك';

  @override
  String get registerTitle => 'مرحبًا بك في تك تك';

  @override
  String get registerIntro => 'بماذا يناديك السائقون؟';

  @override
  String get nameLabel => 'اسمك';

  @override
  String get errorNameRequired => 'أدخل اسمك.';

  @override
  String get continueButton => 'متابعة';

  @override
  String homeGreeting(String name) {
    return 'مرحبًا، $name';
  }

  @override
  String get homeNextPhase => 'طلب المشاوير متاح في الإصدار القادم من التطبيق.';

  @override
  String get signOut => 'تسجيل الخروج';
}
