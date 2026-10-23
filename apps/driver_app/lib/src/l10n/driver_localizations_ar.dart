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
  String get statusApplicant => 'الخطوة التالية: أضف مركبتك وارفع مستنداتك.';

  @override
  String get statusPendingReview => 'طلبك قيد المراجعة.';

  @override
  String get statusApproved =>
      'تمت الموافقة عليك. كن متاحًا لتصلك عروض المشاوير.';

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

  @override
  String get documentsTitle => 'مستنداتك';

  @override
  String get vehicleTitle => 'مركبتك';

  @override
  String get docDriverPhoto => 'صورتك الشخصية';

  @override
  String get docDrivingLicense => 'رخصة القيادة';

  @override
  String get docNationalId => 'البطاقة القومية';

  @override
  String get docVehicleRegistration => 'ترخيص المركبة';

  @override
  String get docVehiclePhoto => 'صورة المركبة';

  @override
  String get docUploaded => 'تم الرفع';

  @override
  String get docMissing => 'لم يُرفع بعد';

  @override
  String get upload => 'رفع';

  @override
  String get replace => 'استبدال';

  @override
  String get takePhoto => 'التقط صورة';

  @override
  String get chooseFromGallery => 'اختر من المعرض';

  @override
  String get addVehicle => 'أضف مركبتك';

  @override
  String get vehicleTypeLabel => 'نوع المركبة';

  @override
  String get plateLabel => 'رقم اللوحة';

  @override
  String get vehicleDescriptionLabel => 'وصف (اختياري)، مثل اللون';

  @override
  String get save => 'حفظ';

  @override
  String get vehicleStatusPendingReview => 'في انتظار المراجعة';

  @override
  String get vehicleStatusApproved => 'مقبولة';

  @override
  String get vehicleStatusRejected => 'غير مقبولة';

  @override
  String get vehicleStatusSuspended => 'موقوفة';

  @override
  String get vehicleStatusUnknown => 'حالة غير معروفة';

  @override
  String get submitForReview => 'إرسال للمراجعة';

  @override
  String get submitHelp =>
      'ارفع كل المستندات وأضف مركبتك ثم أرسل الطلب. نراجع الطلبات قبل أن تبدأ في استقبال المشاوير.';

  @override
  String get resubmitHelp => 'صحّح ما ذكره المراجع ثم أرسل الطلب مرة أخرى.';

  @override
  String get errorRequirementsNotMet =>
      'ما زالت بعض المستندات أو المركبة ناقصة.';

  @override
  String get errorVehicleAlreadyRegistered => 'هذه المركبة مسجّلة بالفعل.';

  @override
  String get errorVehicleNotEligible =>
      'لا يمكن استخدام هذه المركبة لهذه الخدمة.';

  @override
  String get online => 'متاح';

  @override
  String get offline => 'غير متاح';

  @override
  String get goOnline => 'ابدأ استقبال المشاوير';

  @override
  String get goOffline => 'أوقف استقبال المشاوير';

  @override
  String get onlineHelp => 'تصلك عروض المشاوير وأنت متاح والتطبيق مفتوح.';

  @override
  String get chooseVehicle => 'المركبة لهذه الوردية';

  @override
  String get noApprovedVehicle => 'تحتاج إلى مركبة مقبولة لتبدأ.';

  @override
  String get locationOff => 'موقعك غير متاح. شغّل الموقع لتصلك العروض.';

  @override
  String get waitingForOffers => 'في انتظار عروض المشاوير…';

  @override
  String offerFrom(String passenger, String amount) {
    return '$passenger يعرض $amount';
  }

  @override
  String offerTrip(String toPickup, String trip) {
    return '$toPickup إلى نقطة الانطلاق · المشوار $trip';
  }

  @override
  String offerMinimum(String amount) {
    return 'أقل أجرة $amount';
  }

  @override
  String offerCountered(String amount) {
    return 'اقترحت $amount. في انتظار رد الراكب.';
  }

  @override
  String get acceptOffer => 'قبول';

  @override
  String get declineOffer => 'رفض';

  @override
  String get proposeFare => 'اقترح أجرة';

  @override
  String get proposeFareTitle => 'أجرتك';

  @override
  String get proposeFareHelp => 'يجب أن تكون أعلى من عرض الراكب.';

  @override
  String get send => 'إرسال';

  @override
  String get cancel => 'إلغاء';

  @override
  String km(String value) {
    return '$value كم';
  }

  @override
  String get tripToPickup => 'توجّه إلى نقطة الانطلاق';

  @override
  String get tripAtPickup => 'في انتظار الراكب';

  @override
  String get tripInProgress => 'المشوار جارٍ';

  @override
  String get tripCompleted => 'اكتمل المشوار';

  @override
  String get tripCancelled => 'تم إلغاء هذا المشوار';

  @override
  String get arrived => 'وصلت';

  @override
  String get startTrip => 'ابدأ المشوار';

  @override
  String get completeTrip => 'أنهِ المشوار';

  @override
  String get cancelRide => 'إلغاء المشوار';

  @override
  String get cancelReasonRequired => 'السبب (مطلوب)';

  @override
  String get errorReasonTooShort => 'اكتب 3 أحرف على الأقل.';

  @override
  String get keepRide => 'متابعة المشوار';

  @override
  String get callPassenger => 'اتصل بالراكب';

  @override
  String get pickupPoint => 'نقطة الانطلاق';

  @override
  String get destinationPoint => 'الوجهة';

  @override
  String fareToCollect(String amount) {
    return 'استلم $amount نقدًا';
  }

  @override
  String collectedFull(String amount) {
    return 'استلمت $amount';
  }

  @override
  String get collectedOther => 'استلمت مبلغًا مختلفًا';

  @override
  String get notCollected => 'لم يدفع الراكب';

  @override
  String amountLabel(String currency) {
    return 'المبلغ ($currency)';
  }

  @override
  String get paymentRecorded => 'تم تسجيل الدفع.';

  @override
  String get done => 'تم';

  @override
  String get earnings => 'الأرباح';

  @override
  String commissionOwed(String amount) {
    return 'العمولة المستحقة: $amount';
  }

  @override
  String get noCommissionOwed => 'لا توجد عمولة مستحقة.';

  @override
  String get noEarnings => 'لا توجد مشاوير مكتملة بعد.';

  @override
  String earningLine(String fare, String commission) {
    return 'الأجرة $fare · العمولة $commission';
  }

  @override
  String get loadMore => 'عرض المزيد';

  @override
  String get errorOfferGone => 'هذا العرض لم يعد متاحًا.';

  @override
  String get errorBelowMinimum => 'يجب ألا تقل أجرتك عن أقل أجرة.';

  @override
  String get errorNotAboveProposal => 'يجب أن تكون أجرتك أعلى من عرض الراكب.';

  @override
  String get errorBusy => 'لديك مشوار نشط بالفعل.';

  @override
  String get errorNotAvailable => 'كن متاحًا لتقبل العروض.';

  @override
  String get errorPaymentReported => 'تم تسجيل هذا الدفع من قبل.';
}
