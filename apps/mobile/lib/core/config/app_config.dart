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

  /// Base URL of the Laravel control plane (no trailing slash).
  String get controlPlaneBaseUrl => _baseUrl;

  /// Sanctum bearer token for the host (teacher). Null in the fake/dev flow.
  String? get authToken => _authToken.isEmpty ? null : _authToken;

  /// When true, the app runs on the in-memory [FakeMediaSession] and a fake token source — no
  /// server required. Flip to false (with a base URL + token) for the real LiveKit stack.
  bool get useFakeMedia => _useFakeMedia;
}
