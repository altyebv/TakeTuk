// Regenerates lib/src/generated/ from docs/api/openapi.json.
//
//   cd packages/taketuk_api && dart run tool/generate.dart
import 'dart:convert';
import 'dart:io';

import 'generator.dart';

Future<void> main() async {
  final document = jsonDecode(
    await File('../../docs/api/openapi.json').readAsString(),
  ) as Map<String, Object?>;
  final client = generateClient(document);
  await Directory('lib/src/generated').create(recursive: true);
  await File('lib/src/generated/models.dart').writeAsString(client.models);
  await File('lib/src/generated/api.dart').writeAsString(client.api);
  stdout.writeln('generated lib/src/generated/{models,api}.dart');
}
