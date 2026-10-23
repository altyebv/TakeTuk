/// Normalizes a Sudanese mobile number to E.164: `+249` followed by nine digits starting with
/// 1 or 9 (the mobile ranges). Accepts local (`0912345678`), national (`912345678`) and
/// international (`+249…`, `00249…`) forms, separators, and Arabic-Indic digits typed on Arabic
/// keyboards. Returns null for anything else.
String? normalizeSudanMobile(String input) {
  var digits = input
      .replaceAll(RegExp(r'[\s\-().\u200e\u200f]'), '')
      .split('')
      .map((c) {
        final code = c.codeUnitAt(0);
        if (code >= 0x0660 && code <= 0x0669) {
          return String.fromCharCode(code - 0x0660 + 0x30);
        }
        if (code >= 0x06F0 && code <= 0x06F9) {
          return String.fromCharCode(code - 0x06F0 + 0x30);
        }
        return c;
      })
      .join();
  if (digits.startsWith('+')) {
    digits = digits.substring(1);
  } else if (digits.startsWith('00')) {
    digits = digits.substring(2);
  } else if (digits.startsWith('0')) {
    digits = '249${digits.substring(1)}';
  } else if (digits.length == 9) {
    digits = '249$digits';
  }
  final match = RegExp(r'^249([19]\d{8})$').firstMatch(digits);
  return match == null ? null : '+249${match[1]}';
}

/// Wraps a phone number or email address in Unicode directional isolates so it reads left to
/// right inside Arabic text.
String isolateLtr(String text) => '\u2066$text\u2069';
