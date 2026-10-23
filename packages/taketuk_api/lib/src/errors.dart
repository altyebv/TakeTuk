/// An RFC 9457 problem returned by the API (docs/api/API_CONVENTIONS.md §6).
///
/// Switch on [code] (see `ProblemCodes`); [title] and [detail] are for logs and support, not for
/// display. User-facing text comes from the app's own localized messages.
final class ApiProblem implements Exception {
  const ApiProblem({
    required this.status,
    required this.code,
    required this.title,
    required this.detail,
    this.requestId,
    this.errors = const [],
    this.retryAfter,
  });

  /// Parses a problem body. Returns null when [json] is not a problem document.
  static ApiProblem? tryParse(
    int status,
    Object? json, {
    Duration? retryAfter,
  }) {
    if (json is! Map<String, Object?>) return null;
    final code = json['code'];
    if (code is! String) return null;
    final errors = json['errors'];
    return ApiProblem(
      status: status,
      code: code,
      title: json['title'] is String ? json['title']! as String : '',
      detail: json['detail'] is String ? json['detail']! as String : '',
      requestId: json['requestId'] is String
          ? json['requestId'] as String?
          : null,
      errors: [
        if (errors is List<Object?>)
          for (final error in errors)
            if (error is Map<String, Object?>)
              ApiFieldError(
                path: error['path'] is String ? error['path']! as String : '',
                message: error['message'] is String
                    ? error['message']! as String
                    : '',
              ),
      ],
      retryAfter: retryAfter,
    );
  }

  final int status;
  final String code;
  final String title;
  final String detail;

  /// Quote it to support: it identifies the request in the backend logs.
  final String? requestId;
  final List<ApiFieldError> errors;

  /// From the `Retry-After` header, when the API sent one (rate limits, outages).
  final Duration? retryAfter;

  @override
  String toString() =>
      'ApiProblem($status $code: $detail, requestId: $requestId)';
}

/// One invalid input field of a `VALIDATION_FAILED` problem.
final class ApiFieldError {
  const ApiFieldError({required this.path, required this.message});

  final String path;
  final String message;
}

/// The API could not be reached, timed out, or answered with a server error that carried no
/// problem document (for example a proxy's 502). Retrying is safe with the same idempotency key.
final class ApiUnavailable implements Exception {
  const ApiUnavailable(this.reason, {this.cause, this.reachedServer = false});

  final String reason;
  final Object? cause;

  /// True when a server answered (a bare 5xx); false for network failures and timeouts, which
  /// usually mean the user's connection.
  final bool reachedServer;

  @override
  String toString() => 'ApiUnavailable($reason)';
}

/// A response that does not match the API contract: a bug, or a client older than a breaking
/// change. Never retried automatically.
final class ApiContractViolation implements Exception {
  const ApiContractViolation(this.reason, [this.cause]);

  final String reason;
  final Object? cause;

  @override
  String toString() => 'ApiContractViolation($reason)';
}
