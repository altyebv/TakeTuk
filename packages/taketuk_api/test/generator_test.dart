import 'dart:convert';
import 'dart:io';

import 'package:test/test.dart';

import '../tool/generator.dart';

Map<String, Object?> _document() =>
    jsonDecode(File('../../docs/api/openapi.json').readAsStringSync())
        as Map<String, Object?>;

void main() {
  test('the committed client matches docs/api/openapi.json (run tool/generate.dart)', () {
    final client = generateClient(_document());
    expect(
      File('lib/src/generated/models.dart').readAsStringSync(),
      client.models,
    );
    expect(File('lib/src/generated/api.dart').readAsStringSync(), client.api);
  });

  test('leaves back-office operations out of the mobile client', () {
    final api = generateClient(_document()).api;
    expect(api, isNot(contains('/v1/admin/')));
    expect(api, contains("'/v1/rides'"));
  });

  test('stops on schema constructs it cannot represent faithfully', () {
    final document = _document();
    final schemas =
        (document['components']! as Map<String, Object?>)['schemas']!
            as Map<String, Object?>;
    final me = Map<String, Object?>.of(schemas['Me']! as Map<String, Object?>);
    me['properties'] = {
      ...me['properties']! as Map<String, Object?>,
      'combined': {
        'allOf': [
          {r'$ref': '#/components/schemas/Money'},
          {r'$ref': '#/components/schemas/Coordinates'},
        ],
      },
    };
    schemas['Me'] = me;
    expect(() => generateClient(document), throwsStateError);
  });
}
