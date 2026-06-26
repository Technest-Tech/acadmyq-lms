import 'dart:async';

import '../media_models.dart';
import '../media_session.dart';

/// In-memory [MediaSession] for development and tests — no network, no SDK.
///
/// Lets us exercise the entire call flow (join, mute, participants, reconnect, leave) without a
/// server (TC-V3.1), and lets the UI run in a simulator before the LiveKit adapter exists. The
/// `simulate*` helpers inject remote events a real SFU would deliver.
class FakeMediaSession implements MediaSession {
  final StreamController<MediaSessionState> _stateController =
      StreamController<MediaSessionState>.broadcast();
  final StreamController<List<Participant>> _participantsController =
      StreamController<List<Participant>>.broadcast();
  final StreamController<Participant?> _activeSpeakerController =
      StreamController<Participant?>.broadcast();
  final StreamController<ConnectionQuality> _qualityController =
      StreamController<ConnectionQuality>.broadcast();

  MediaSessionState _state = MediaSessionState.idle;
  bool _mic = true;
  bool _camera = false;
  final List<Participant> _participants = <Participant>[];

  @override
  Stream<MediaSessionState> get stateStream => _stateController.stream;

  @override
  Stream<List<Participant>> get participantsStream =>
      _participantsController.stream;

  @override
  Stream<Participant?> get activeSpeakerStream => _activeSpeakerController.stream;

  @override
  Stream<ConnectionQuality> get connectionQualityStream =>
      _qualityController.stream;

  @override
  MediaSessionState get state => _state;

  @override
  bool get isMicEnabled => _mic;

  @override
  bool get isCameraEnabled => _camera;

  @override
  List<Participant> get participants => List<Participant>.unmodifiable(_participants);

  @override
  Future<void> connect(RoomCredentials credentials) async {
    _setState(MediaSessionState.connecting);
    _participants
      ..clear()
      ..add(
        Participant(
          identity: credentials.identity,
          displayName: 'You',
          isLocal: true,
          audioEnabled: _mic,
          videoEnabled: _camera,
          role: ParticipantRole.host,
        ),
      );
    _emitParticipants();
    _setState(MediaSessionState.connected);
    _qualityController.add(ConnectionQuality.good);
  }

  @override
  Future<void> disconnect() async {
    _participants.clear();
    _emitParticipants();
    _setState(MediaSessionState.disconnected);
  }

  @override
  Future<void> setMicEnabled(bool enabled) async {
    _mic = enabled;
    _updateLocal(audioEnabled: enabled);
  }

  @override
  Future<void> setCameraEnabled(bool enabled) async {
    _camera = enabled;
    _updateLocal(videoEnabled: enabled);
  }

  @override
  Future<void> switchCamera() async {}

  @override
  Future<void> startScreenShare() async {}

  @override
  Future<void> stopScreenShare() async {}

  // ── Test/dev hooks: simulate what a real SFU would deliver ──────────────────

  void simulateRemoteJoin(Participant participant) {
    _participants.add(participant);
    _emitParticipants();
  }

  void simulateRemoteLeave(String identity) {
    _participants.removeWhere((Participant p) => p.identity == identity);
    _emitParticipants();
  }

  void simulateReconnecting() => _setState(MediaSessionState.reconnecting);

  void simulateReconnected() => _setState(MediaSessionState.connected);

  void simulateQuality(ConnectionQuality quality) =>
      _qualityController.add(quality);

  @override
  Future<void> dispose() async {
    await _stateController.close();
    await _participantsController.close();
    await _activeSpeakerController.close();
    await _qualityController.close();
  }

  void _setState(MediaSessionState next) {
    _state = next;
    _stateController.add(next);
  }

  void _emitParticipants() =>
      _participantsController.add(List<Participant>.unmodifiable(_participants));

  void _updateLocal({bool? audioEnabled, bool? videoEnabled}) {
    final int index = _participants.indexWhere((Participant p) => p.isLocal);
    if (index == -1) return;
    _participants[index] = _participants[index].copyWith(
      audioEnabled: audioEnabled,
      videoEnabled: videoEnabled,
    );
    _emitParticipants();
  }
}
