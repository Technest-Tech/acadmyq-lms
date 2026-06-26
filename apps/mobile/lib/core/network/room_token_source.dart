import 'package:dio/dio.dart';

import '../media/media_models.dart';

/// Why a token fetch failed — mapped to a clear user message by the UI.
enum TokenFetchError {
  /// Not signed in / session expired (401).
  unauthorized,

  /// The academy's plan doesn't include video (402 → upgrade required).
  upgradeRequired,

  /// The role lacks `room.join` (403).
  forbidden,

  /// No such room for this tenant (404).
  notFound,

  /// No network / server unreachable.
  network,

  /// Anything else.
  unknown,
}

class TokenFetchException implements Exception {
  const TokenFetchException(this.kind, [this.message]);
  final TokenFetchError kind;
  final String? message;

  @override
  String toString() => 'TokenFetchException($kind${message == null ? '' : ': $message'})';
}

/// Exchanges a room id for short-lived, scoped [RoomCredentials] from the control plane.
///
/// The client never mints tokens or holds the LiveKit secret (V-SEC-1); it asks Laravel, which
/// derives the LiveKit grants from the caller's RBAC and signs the JWT server-side.
abstract interface class RoomTokenSource {
  Future<RoomCredentials> fetchToken(String roomId);
}

/// Real implementation: `POST /api/video/rooms/{id}/token` → `{ url, token, room, identity }`.
class HttpRoomTokenSource implements RoomTokenSource {
  HttpRoomTokenSource(this._dio);
  final Dio _dio;

  @override
  Future<RoomCredentials> fetchToken(String roomId) async {
    try {
      final Response<Map<String, dynamic>> res =
          await _dio.post<Map<String, dynamic>>('/api/video/rooms/$roomId/token');
      final Map<String, dynamic>? data = res.data;
      if (data == null) {
        throw const TokenFetchException(TokenFetchError.unknown, 'Empty token response');
      }
      return RoomCredentials(
        url: data['url'] as String,
        token: data['token'] as String,
        identity: data['identity'] as String,
        roomName: data['room'] as String,
      );
    } on DioException catch (e) {
      throw _map(e);
    }
  }

  TokenFetchException _map(DioException e) {
    final int? status = e.response?.statusCode;
    return switch (status) {
      401 => const TokenFetchException(TokenFetchError.unauthorized),
      402 => const TokenFetchException(TokenFetchError.upgradeRequired),
      403 => const TokenFetchException(TokenFetchError.forbidden),
      404 => const TokenFetchException(TokenFetchError.notFound),
      null => const TokenFetchException(TokenFetchError.network),
      _ => const TokenFetchException(TokenFetchError.unknown),
    };
  }
}

/// In-memory token source for the dev/sim flow — returns canned credentials so the lobby → room
/// path runs with no server.
class FakeRoomTokenSource implements RoomTokenSource {
  const FakeRoomTokenSource();

  @override
  Future<RoomCredentials> fetchToken(String roomId) async => RoomCredentials(
        url: 'wss://media.dev',
        token: 'dev-token',
        identity: 'teacher-1',
        roomName: roomId,
      );
}
