import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:taketuk_api/taketuk_api.dart';

/// A real backend response recorded by backend/test/integration/client-fixtures.int-spec.ts.
Object? fixture(String name) =>
    jsonDecode(File('test/fixtures/$name.json').readAsStringSync());

final class RecordingClient {
  RecordingClient(this.respond);

  final Future<http.Response> Function(http.Request request) respond;
  final List<http.Request> requests = [];

  late final MockClient client = MockClient((request) {
    requests.add(request);
    return respond(request);
  });
}

http.Response jsonResponse(
  int status,
  Object? body, {
  Map<String, String> headers = const {},
}) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json', ...headers},
);

({TaketukApi api, RecordingClient http}) apiWith(
  Future<http.Response> Function(http.Request request) respond, {
  String? token = 'token-1',
  String baseUrl = 'https://api.example',
  Duration timeout = const Duration(seconds: 5),
}) {
  final recording = RecordingClient(respond);
  final transport = ApiTransport(
    baseUrl: Uri.parse(baseUrl),
    accessToken: () async => token,
    httpClient: recording.client,
    timeout: timeout,
  );
  return (api: TaketukApi(transport), http: recording);
}
