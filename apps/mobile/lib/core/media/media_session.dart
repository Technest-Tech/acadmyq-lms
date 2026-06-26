import 'media_models.dart';

/// Engine-agnostic live media session — the keystone abstraction of the client.
///
/// The LiveKit SDK lives behind the ONLY implementation that touches it
/// (`core/media/livekit/livekit_media_session.dart`). No LiveKit type leaks through this API —
/// that is rule V-ARCH-1, enforced by `test/architecture_guard_test.dart`. Result: the engine can
/// be swapped, mocked ([FakeMediaSession]), or extended without touching the UI or controllers.
///
/// Audio is sacred (rule V-AUD-1): implementations degrade video first (resolution → freeze → drop)
/// and never drop audio first under bandwidth pressure.
abstract interface class MediaSession {
  /// Connect to a room with the given scoped credentials. Moves [state] through connecting →
  /// connected (or failed). Idempotent reconnects keep the room alive (V-MOB-2).
  Future<void> connect(RoomCredentials credentials);

  /// Leave the room and release local media.
  Future<void> disconnect();

  Stream<MediaSessionState> get stateStream;
  Stream<List<Participant>> get participantsStream;
  Stream<Participant?> get activeSpeakerStream;
  Stream<ConnectionQuality> get connectionQualityStream;

  Future<void> setMicEnabled(bool enabled);
  Future<void> setCameraEnabled(bool enabled);
  Future<void> switchCamera();
  Future<void> startScreenShare();
  Future<void> stopScreenShare();

  MediaSessionState get state;
  bool get isMicEnabled;
  bool get isCameraEnabled;
  List<Participant> get participants;

  /// Tear down streams and any engine resources.
  Future<void> dispose();
}
