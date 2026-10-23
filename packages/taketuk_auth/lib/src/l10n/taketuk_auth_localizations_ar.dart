// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'taketuk_auth_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Arabic (`ar`).
class TaketukAuthLocalizationsAr extends TaketukAuthLocalizations {
  TaketukAuthLocalizationsAr([String locale = 'ar']) : super(locale);

  @override
  String get signInTitle => 'تسجيل الدخول';

  @override
  String get phoneLabel => 'رقم الهاتف';

  @override
  String get phoneHint => '0912345678';

  @override
  String get phoneHelp => 'سنرسل إليك رمزًا برسالة نصية.';

  @override
  String get sendCode => 'إرسال الرمز';

  @override
  String get codeTitle => 'أدخل الرمز';

  @override
  String codeSentTo(String phone) {
    return 'أدخل الرمز الذي أرسلناه إلى $phone.';
  }

  @override
  String get codeLabel => 'رمز التحقق';

  @override
  String get verify => 'تأكيد';

  @override
  String get resendCode => 'إرسال رمز جديد';

  @override
  String get codeResent => 'تم إرسال رمز جديد.';

  @override
  String get changeNumber => 'تغيير الرقم';

  @override
  String get signOut => 'تسجيل الخروج';

  @override
  String get errorInvalidPhone => 'أدخل رقم هاتف سوداني، مثل 0912345678.';

  @override
  String get errorInvalidCode => 'الرمز غير صحيح أو انتهت صلاحيته.';

  @override
  String get loading => 'جارٍ التحميل…';

  @override
  String get accountErrorTitle => 'تعذّر تحميل حسابك';
}
