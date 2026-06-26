/// Build-time configuration, supplied via `--dart-define`.
///
/// Defaults target a local dev simulator with the in-memory fake (no server). For the live device
/// join (Phase 3c-iv) pass, e.g.:
/// - `--dart-define=USE_FAKE_MEDIA=false`
/// - `--dart-define=CONTROL_PLANE_URL=http://LAN-IP:8000`
/// - `--dart-define=AUTH_TOKEN=<sanctum-personal-access-token>`
class AppConfig {
  const AppConfig();

  static const String _baseUrl = String.fromEnvironment(
    'CONTROL_PLANE_URL',
    defaultValue: 'http://10.0.2.2:8000', // Android emulator → host machine
  );
  static const String _authToken = String.fromEnvironment('AUTH_TOKEN');
  static const bool _useFakeMedia =
      bool.fromEnvironment('USE_FAKE_MEDIA', defaultValue: true);

  // Direct credentials: skip the control-plane fetch and connect to LiveKit with a pre-minted token.
  // Used for the device bring-up test, and the shape the guest-join (signed WhatsApp link) will use.
  static const String _directToken = String.fromEnvironment('LIVEKIT_DIRECT_TOKEN');
  static const String _directUrl = String.fromEnvironment('LIVEKIT_URL');
  static const String _directRoom = String.fromEnvironment('LIVEKIT_ROOM');
  static const String _directIdentity =
      String.fromEnvironment('LIVEKIT_IDENTITY', defaultValue: 'host');

  /// Base URL of the Laravel control plane (no trailing slash).
  String get controlPlaneBaseUrl => _baseUrl;

  /// Sanctum bearer token for the host (teacher). Null in the fake/dev flow.
  String? get authToken => _authToken.isEmpty ? null : _authToken;

  /// When true, the app runs on the in-memory [FakeMediaSession] and a fake token source — no
  /// server required. Flip to false (with a base URL + token) for the real LiveKit stack.
  bool get useFakeMedia => _useFakeMedia;

  /// When a pre-minted LiveKit token is supplied, the app connects directly (no control-plane call).
  bool get useDirectToken => _directToken.isNotEmpty;
  String? get directToken => _directToken.isEmpty ? null : _directToken;
  String get directUrl => _directUrl;
  String get directRoom => _directRoom;
  String get directIdentity => _directIdentity;
}
