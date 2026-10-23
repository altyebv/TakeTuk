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
  String get signOut => 'تسجيل الخروج';

  @override
  String get myRides => 'مشاويري';

  @override
  String get noRides => 'لا توجد مشاوير بعد.';

  @override
  String get setPickup => 'نقطة الانطلاق';

  @override
  String get setDestination => 'الوجهة';

  @override
  String get tapForPickup => 'اضغط على الخريطة لتحديد نقطة الانطلاق.';

  @override
  String get tapForDestination => 'اضغط على الخريطة لتحديد وجهتك.';

  @override
  String get useMyLocation => 'استخدم موقعي';

  @override
  String get locationUnavailable =>
      'موقعك غير متاح. حدّد نقطة الانطلاق على الخريطة.';

  @override
  String get pickupNameLabel => 'اسم مكان الانطلاق (اختياري)';

  @override
  String get destinationNameLabel => 'اسم الوجهة (اختياري)';

  @override
  String get seePrice => 'اعرض السعر';

  @override
  String minimumFare(String amount) {
    return 'أقل أجرة: $amount';
  }

  @override
  String tripSummary(String distance, int minutes) {
    return '$distance كم · حوالي $minutes دقيقة';
  }

  @override
  String yourOffer(String amount) {
    return 'عرضك: $amount';
  }

  @override
  String get offerHelp => 'يمكن للسائقين قبول عرضك أو اقتراح أجرة أعلى.';

  @override
  String get lowerOffer => 'خفّض العرض';

  @override
  String get raiseOffer => 'ارفع العرض';

  @override
  String get requestRide => 'اطلب المشوار';

  @override
  String get changeTrip => 'غيّر المشوار';

  @override
  String get searchingTitle => 'جارٍ البحث عن سائق';

  @override
  String driversNotified(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'تم إبلاغ $count سائق',
      many: 'تم إبلاغ $count سائقًا',
      few: 'تم إبلاغ $count سائقين',
      two: 'تم إبلاغ سائقَين',
      one: 'تم إبلاغ سائق واحد',
      zero: 'لم يُبلَّغ أي سائق بعد',
    );
    return '$_temp0';
  }

  @override
  String get counteroffersTitle => 'عروض السائقين';

  @override
  String counteroffer(String driver, String amount) {
    return '$driver يعرض $amount';
  }

  @override
  String get acceptOffer => 'قبول';

  @override
  String get rejectOffer => 'رفض';

  @override
  String get cancelRide => 'إلغاء المشوار';

  @override
  String get cancelRideQuestion => 'هل تريد إلغاء هذا المشوار؟';

  @override
  String get cancelReasonLabel => 'السبب (اختياري)';

  @override
  String get keepRide => 'متابعة المشوار';

  @override
  String statusAssigned(String driver) {
    return '$driver في الطريق إليك';
  }

  @override
  String get statusArrived => 'وصل السائق';

  @override
  String get statusInProgress => 'في الطريق إلى وجهتك';

  @override
  String get statusCompleted => 'وصلت إلى وجهتك';

  @override
  String payCash(String amount) {
    return 'ادفع $amount نقدًا';
  }

  @override
  String get statusCancelled => 'تم إلغاء هذا المشوار';

  @override
  String get statusExpired => 'لم يقبل أي سائق في الوقت المحدد';

  @override
  String get statusUnknown =>
      'لا يمكن عرض حالة هذا المشوار في هذا الإصدار. يرجى تحديث التطبيق.';

  @override
  String agreedFare(String amount) {
    return 'الأجرة: $amount';
  }

  @override
  String vehicle(String type, String plate) {
    return '$type · $plate';
  }

  @override
  String get vehicleRaksha => 'ركشة';

  @override
  String get callDriver => 'اتصل بالسائق';

  @override
  String get newRide => 'اطلب مشوارًا جديدًا';

  @override
  String get errorOutsideArea =>
      'تك تك غير متاح هناك بعد. اختر نقاطًا داخل منطقة الخدمة.';

  @override
  String get errorSamePoint => 'نقطة الانطلاق والوجهة في المكان نفسه.';

  @override
  String get errorNoRoute => 'لم نجد طريقًا إلى هناك. قرّب النقاط من طريق.';

  @override
  String get errorRidesUnavailable => 'المشاوير غير متاحة الآن.';

  @override
  String get errorFareBelowMinimum => 'يجب ألا يقل عرضك عن أقل أجرة.';

  @override
  String get errorQuoteExpired => 'انتهت صلاحية السعر. اعرض السعر مرة أخرى.';

  @override
  String get errorRideAlreadyOpen => 'لديك مشوار جارٍ بالفعل.';

  @override
  String get errorOfferGone => 'هذا العرض لم يعد متاحًا.';

  @override
  String tripDistance(String distance) {
    return '$distance كم';
  }

  @override
  String get loadMore => 'عرض المزيد';

  @override
  String get rideStatusSearching => 'جارٍ البحث';

  @override
  String get rideStatusAssigned => 'السائق في الطريق';

  @override
  String get rideStatusArrived => 'وصل السائق';

  @override
  String get rideStatusInProgress => 'جارٍ';

  @override
  String get rideStatusCompleted => 'مكتمل';

  @override
  String get rideStatusCancelled => 'ملغى';

  @override
  String get rideStatusExpired => 'منتهي';

  @override
  String get rideStatusUnknown => 'غير معروف';
}
