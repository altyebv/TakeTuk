import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'errors.dart';

/// Returns the current access token, or null when signed out. Called before every
/// authenticated request so a refreshed token is always used.
typedef AccessTokenProvider = Future<String?> Function();

/// HTTP transport for the generated API: authentication, JSON, timeouts and error mapping.
final class ApiTransport {
  ApiTransport({
    required this.baseUrl,
    required this.accessToken,
    http.Client? httpClient,
    this.timeout = const Duration(seconds: 20),
  }) : _client = httpClient ?? http.Client();

  /// The API origin, optionally with a path prefix, for example `https://api.example`.
  final Uri baseUrl;
  final Duration timeout;
  final AccessTokenProvider accessToken;
  final http.Client _client;

  /// Sends one request and returns the decoded JSON body (null for an empty body).
  ///
  /// Throws [ApiProblem] for problem responses, [ApiUnavailable] for network failures, timeouts
  /// and bare server errors, and [ApiContractViolation] for responses outside the contract.
  Future<Object?> send(
    String method,
    String path, {
    Map<String, String> query = const {},
    Map<String, String> headers = const {},
    Object? body,
    bool authenticated = true,
  }) async {
    final basePath = baseUrl.path.endsWith('/')
        ? baseUrl.path.substring(0, baseUrl.path.length - 1)
        : baseUrl.path;
    final uri = baseUrl.replace(
      path: '$basePath$path',
      queryParameters: query.isEmpty ? null : query,
    );
    final request = http.Request(method, uri)
      ..headers.addAll({'Accept': 'application/json', ...headers});
    if (authenticated) {
      final token = await accessToken();
      if (token == null) {
        throw const ApiProblem(
          status: 401,
          code: 'AUTHENTICATION_REQUIRED',
          title: 'Authentication is required',
          detail: 'No access token is available: the user is signed out.',
        );
      }
      request.headers['Authorization'] = 'Bearer $token';
    }
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }

    final http.Response response;
    try {
      response = await http.Response.fromStream(
        await _client.send(request).timeout(timeout),
      ).timeout(timeout);
    } on TimeoutException catch (error) {
      throw ApiUnavailable(
        'timed out after ${timeout.inSeconds} s',
        cause: error,
      );
    } on http.ClientException catch (error) {
      throw ApiUnavailable('network error', cause: error);
    }

    final status = response.statusCode;
    final Object? json;
    try {
      json = response.body.isEmpty ? null : jsonDecode(response.body);
    } on FormatException catch (error) {
      if (status >= 500) {
        throw ApiUnavailable('HTTP $status', cause: error, reachedServer: true);
      }
      throw ApiContractViolation(
        'HTTP $status with a body that is not JSON',
        error,
      );
    }

    if (status >= 200 && status < 300) return json;
    final problem = ApiProblem.tryParse(
      status,
      json,
      retryAfter: switch (int.tryParse(response.headers['retry-after'] ?? '')) {
        final seconds? => Duration(seconds: seconds),
        null => null,
      },
    );
    if (problem != null) throw problem;
    if (status >= 500) {
      throw ApiUnavailable('HTTP $status', reachedServer: true);
    }
    throw ApiContractViolation('HTTP $status without a problem document');
  }

  /// Decodes a success body with a generated reader, mapping shape mismatches to
  /// [ApiContractViolation].
  T decode<T>(Object? json, T Function(Object? json) read) {
    try {
      return read(json);
    } on FormatException catch (error) {
      throw ApiContractViolation(error.message, error);
    }
  }

  void close() => _client.close();
}
