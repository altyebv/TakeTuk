/// Normalizes an email address for sign-in: trimmed and lower-cased, as Supabase Auth stores
/// it. Returns null unless it has one `@`, a local part and a dotted domain. Supabase Auth does
/// the full validation; this only catches typing mistakes before a code is requested.
String? normalizeEmail(String input) {
  final email = input.trim().toLowerCase();
  return RegExp(r'^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$').hasMatch(email)
      ? email
      : null;
}
