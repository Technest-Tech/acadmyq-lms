import 'dart:convert';
import 'dart:typed_data';

import 'package:academiq_mobile/core/network/room_token_source.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

/// Phase 3c — the control-plane token exchange: success mapping + each failure code, with a stubbed
/// Dio adapter (no network).
class _StubAdapter implements HttpClientAdapter {
  _StubAdapter(this.onFetch);
  final Future<ResponseBody> Function(RequestOptions) onFetch;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) =>
      onFetch(options);

  @override
  void close({bool force = false}) {}
}

Dio _dio(Future<ResponseBody> Function(RequestOptions) onFetch) =>
    Dio(BaseOptions(baseUrl: 'http://test'))..httpClientAdapter = _StubAdapter(onFetch);

ResponseBody _json(String body, int status) => ResponseBody.fromString(
      body,
      status,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>[Headers.jsonContentType],
      },
    );

void main() {
  test('maps a successful response to RoomCredentials', () async {
    final Dio dio = _dio((_) async => _json(
          jsonEncode(<String, String>{
            'url': 'wss://media.host',
            'token': 'jwt-123',
            'room': 'r-abc__academy-1',
            'identity': 'teacher-1',
          }),
          200,
        ));
    final creds = await HttpRoomTokenSource(dio).fetchToken('room-1');
    expect(creds.url, 'wss://media.host');
    expect(creds.token, 'jwt-123');
    expect(creds.roomName, 'r-abc__academy-1');
    expect(creds.identity, 'teacher-1');
  });

  test('POSTs to /api/video/rooms/{id}/token', () async {
    String? path;
    String? method;
    final Dio dio = _dio((RequestOptions o) async {
      path = o.path;
      method = o.method;
      return _json(
        jsonEncode(<String, String>{
          'url': 'w',
          'token': 't',
          'room': 'r',
          'identity': 'i',
        }),
        200,
      );
    });
    await HttpRoomTokenSource(dio).fetchToken('abc-123');
    expect(method, 'POST');
    expect(path, '/api/video/rooms/abc-123/token');
  });

  for (final (int status, TokenFetchError kind) in <(int, TokenFetchError)>[
    (401, TokenFetchError.unauthorized),
    (402, TokenFetchError.upgradeRequired),
    (403, TokenFetchError.forbidden),
    (404, TokenFetchError.notFound),
    (500, TokenFetchError.unknown),
  ]) {
    test('maps HTTP $status to $kind', () async {
      final Dio dio = _dio((_) async => _json('{}', status));
      await expectLater(
        () => HttpRoomTokenSource(dio).fetchToken('r'),
        throwsA(isA<TokenFetchException>()
            .having((TokenFetchException e) => e.kind, 'kind', kind)),
      );
    });
  }

  test('maps a network failure', () async {
    final Dio dio = _dio((RequestOptions o) async =>
        throw DioException(requestOptions: o, type: DioExceptionType.connectionError));
    await expectLater(
      () => HttpRoomTokenSource(dio).fetchToken('r'),
      throwsA(isA<TokenFetchException>().having(
          (TokenFetchException e) => e.kind, 'kind', TokenFetchError.network)),
    );
  });

  test('FakeRoomTokenSource returns canned credentials', () async {
    final creds = await const FakeRoomTokenSource().fetchToken('room-x');
    expect(creds.roomName, 'room-x');
    expect(creds.token, isNotEmpty);
    expect(creds.url, startsWith('wss://'));
  });
}
