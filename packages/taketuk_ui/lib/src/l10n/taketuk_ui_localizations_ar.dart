// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'taketuk_ui_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Arabic (`ar`).
class TaketukUiLocalizationsAr extends TaketukUiLocalizations {
  TaketukUiLocalizationsAr([String locale = 'ar']) : super(locale);

  @override
  String get retry => 'حاول مرة أخرى';

  @override
  String get errorNetwork => 'لا يوجد اتصال. تحقّق من الإنترنت وحاول مرة أخرى.';

  @override
  String get errorServiceUnavailable =>
      'الخدمة غير متاحة مؤقتًا. حاول مرة أخرى بعد قليل.';

  @override
  String get errorSignedOut => 'انتهت جلستك. سجّل الدخول مرة أخرى.';

  @override
  String get errorAccountDisabled => 'هذا الحساب معطّل. يرجى التواصل مع الدعم.';

  @override
  String get errorRateLimited =>
      'محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.';

  @override
  String get errorValidation =>
      'بعض البيانات غير صحيحة. راجعها وحاول مرة أخرى.';

  @override
  String get errorUpdateRequired => 'إصدار التطبيق قديم. يرجى تحديثه.';

  @override
  String get errorGeneric => 'حدث خطأ ما. حاول مرة أخرى.';

  @override
  String supportReference(String requestId) {
    return 'رقم المرجع: $requestId';
  }

  @override
  String get currencySdg => 'ج.س';
}
