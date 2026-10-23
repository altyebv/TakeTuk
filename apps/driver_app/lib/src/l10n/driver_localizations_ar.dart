// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'driver_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Arabic (`ar`).
class DriverLocalizationsAr extends DriverLocalizations {
  DriverLocalizationsAr([String locale = 'ar']) : super(locale);

  @override
  String get appName => 'تك تك - السائق';

  @override
  String get registerTitle => 'اعمل سائقًا مع تك تك';

  @override
  String get registerIntro =>
      'عرّفنا بنفسك. تُراجَع بياناتك قبل أن تبدأ في استقبال المشاوير.';

  @override
  String get displayNameLabel => 'الاسم الذي يظهر للركاب';

  @override
  String get legalNameLabel => 'الاسم الكامل كما في الأوراق الرسمية';

  @override
  String get licenseLabel => 'رقم رخصة القيادة';

  @override
  String get errorRequired => 'هذا الحقل مطلوب.';

  @override
  String get errorAlreadyRegistered =>
      'أنت مسجّل مسبقًا ببيانات مختلفة. يرجى التواصل مع الدعم.';

  @override
  String get continueButton => 'متابعة';

  @override
  String homeGreeting(String name) {
    return 'مرحبًا، $name';
  }

  @override
  String get statusApplicant =>
      'الخطوة التالية: أضف مركبتك ومستنداتك. يتوفر ذلك في الإصدار القادم من التطبيق.';

  @override
  String get statusPendingReview => 'طلبك قيد المراجعة.';

  @override
  String get statusApproved =>
      'تمت الموافقة عليك. استقبال المشاوير متاح في الإصدار القادم من التطبيق.';

  @override
  String get statusRejected => 'لم تتم الموافقة على طلبك.';

  @override
  String reviewNote(String note) {
    return 'ملاحظة المراجع: $note';
  }

  @override
  String get statusSuspended => 'حسابك موقوف. يرجى التواصل مع الدعم.';

  @override
  String get statusUnknown =>
      'لا يمكن عرض حالة حسابك في هذا الإصدار. يرجى تحديث التطبيق.';

  @override
  String get signOut => 'تسجيل الخروج';
}
