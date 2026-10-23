/// Checked readers used by the generated `fromJson` factories. A response that does not match
/// the contract fails with a [FormatException] naming the field, instead of a bare cast error.
library;

Never _mismatch(String expected, Object? value, String path) =>
    throw FormatException(
      'Expected $expected at $path, got ${value.runtimeType}',
    );

String readString(Object? value, String path) =>
    value is String ? value : _mismatch('a string', value, path);

int readInt(Object? value, String path) => switch (value) {
  final int v => v,
  final num v when v == v.truncateToDouble() => v.toInt(),
  _ => _mismatch('an integer', value, path),
};

double readDouble(Object? value, String path) =>
    value is num ? value.toDouble() : _mismatch('a number', value, path);

bool readBool(Object? value, String path) =>
    value is bool ? value : _mismatch('a boolean', value, path);

Map<String, Object?> readObject(Object? value, String path) =>
    value is Map<String, Object?> ? value : _mismatch('an object', value, path);

List<Object?> readList(Object? value, String path) =>
    value is List<Object?> ? value : _mismatch('an array', value, path);
