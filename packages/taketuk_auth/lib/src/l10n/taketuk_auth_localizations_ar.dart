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
  String get emailLabel => 'البريد الإلكتروني';

  @override
  String get emailHint => 'name@example.com';

  @override
  String get emailHelp => 'سنرسل إليك رمزًا بالبريد الإلكتروني.';

  @override
  String get sendCode => 'إرسال الرمز';

  @override
  String get haveCode => 'لدي رمز بالفعل';

  @override
  String get codeTitle => 'أدخل الرمز';

  @override
  String codeSentTo(String address) {
    return 'أدخل الرمز الذي أرسلناه إلى $address.';
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
  String get changeEmail => 'تغيير البريد الإلكتروني';

  @override
  String get signOut => 'تسجيل الخروج';

  @override
  String get errorInvalidPhone => 'أدخل رقم هاتف سوداني، مثل 0912345678.';

  @override
  String get errorInvalidEmail =>
      'أدخل بريدًا إلكترونيًا صحيحًا، مثل name@example.com.';

  @override
  String get errorAddressNotAllowed =>
      'لا يمكن إرسال رموز الدخول إلى هذا العنوان حاليًا.';

  @override
  String get errorInvalidCode => 'الرمز غير صحيح أو انتهت صلاحيته.';

  @override
  String get loading => 'جارٍ التحميل…';

  @override
  String get accountErrorTitle => 'تعذّر تحميل حسابك';
}
