import 'dart:async';

// The LiveKit SDK is imported HERE AND NOWHERE ELSE (rule V-ARCH-1, enforced by
// test/architecture_guard_test.dart). The `as lk` prefix keeps every SDK type behind a namespace so
// none of LiveKit's names (Room, Participant, ConnectionState, ConnectionQuality, …) leaks into or
// collides with our engine-agnostic contract in `core/media/`.
import 'package:livekit_client/livekit_client.dart' as lk;

import '../media_models.dart';
import '../media_session.dart';

/// The real [MediaSession], backed by `package:livekit_client`.
///
/// It translates the LiveKit SDK into our small engine-agnostic contract: the UI and
/// [RoomController] only ever see [MediaSessionState], [Participant], [ConnectionQuality] — never an
/// SDK type (rule V-ARCH-1). Swapping engines means writing one more class like this; nothing else
/// changes.
///
/// Audio is sacred (rule V-AUD-1): the room is configured for adaptive stream + dynacast + simulcast
/// video and DTX/RED audio, so under bandwidth pressure the SFU degrades video first and protects
/// the recitation. Reconnects (WiFi↔cellular handover, V-MOB-2) surface as
/// [MediaSessionState.reconnecting] without tearing down the room.
class LivekitMediaSession implements MediaSession {
  LivekitMediaSession();

  lk.Room? _room;
  lk.EventsListener<lk.RoomEvent>? _events;

  final StreamController<MediaSessionState> _stateController =
      StreamController<MediaSessionState>.broadcast();
  final StreamController<List<Participant>> _participantsController =
      StreamController<List<Participant>>.broadcast();
  final StreamController<Participant?> _activeSpeakerController =
      StreamController<Participant?>.broadcast();
  final StreamController<ConnectionQuality> _qualityController =
      StreamController<ConnectionQuality>.broadcast();

  MediaSessionState _state = MediaSessionState.idle;
  List<Participant> _participants = const <Participant>[];
  Participant? _activeSpeaker;
  ConnectionQuality _quality = ConnectionQuality.unknown;

  // Desired local-device intent, applied on connect and used as a pre-connect fallback. Audio-first
  // default: mic on, camera off (the lobby may override these before joining in Phase 3c).
  bool _micEnabled = true;
  bool _cameraEnabled = false;
  lk.CameraPosition _cameraPosition = lk.CameraPosition.front;

  // ── Reactive state ──────────────────────────────────────────────────────────

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
  bool get isMicEnabled =>
      _room?.localParticipant?.isMicrophoneEnabled() ?? _micEnabled;

  @override
  bool get isCameraEnabled =>
      _room?.localParticipant?.isCameraEnabled() ?? _cameraEnabled;

  @override
  List<Participant> get participants => _participants;

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  @override
  Future<void> connect(RoomCredentials credentials) async {
    // Tear down any previous room so a re-call is safe (idempotent join).
    await _teardownRoom();
    _setState(MediaSessionState.connecting);

    final lk.Room room = lk.Room(
      roomOptions: const lk.RoomOptions(
        adaptiveStream: true,
        dynacast: true,
        // V-AUD-1: keep audio resilient — DTX + RED (redundant audio) so packet loss doesn't
        // break the recitation; video carries simulcast so the SFU can shed video layers first.
        defaultAudioPublishOptions: lk.AudioPublishOptions(dtx: true, red: true),
        defaultVideoPublishOptions: lk.VideoPublishOptions(simulcast: true),
      ),
    );
    _room = room;

    // Room is a ChangeNotifier: it pings on connection-state, participant-membership, and
    // active-speaker changes. Recompute our snapshot from it on every ping.
    room.addListener(_onRoomChange);

    // The terminal disconnect carries a reason that connectionState alone can't express, so we read
    // it from the event to tell a clean leave (disconnected) from a failure (failed).
    final lk.EventsListener<lk.RoomEvent> events = room.createListener();
    _events = events;
    events.on<lk.RoomDisconnectedEvent>((lk.RoomDisconnectedEvent e) {
      final lk.DisconnectReason? reason = e.reason;
      _setState(
        reason == null || reason == lk.DisconnectReason.clientInitiated
            ? MediaSessionState.disconnected
            : MediaSessionState.failed,
      );
    });

    try {
      await room.connect(credentials.url, credentials.token);
      // Apply the audio-first device intent once connected.
      await room.localParticipant?.setMicrophoneEnabled(_micEnabled);
      if (_cameraEnabled) {
        await room.localParticipant?.setCameraEnabled(true);
      }
      _onRoomChange(); // initial snapshot
    } catch (_) {
      _setState(MediaSessionState.failed);
      await _teardownRoom();
      rethrow;
    }
  }

  @override
  Future<void> disconnect() async {
    final lk.Room? room = _room;
    if (room == null) return;
    await room.disconnect();
    _setState(MediaSessionState.disconnected);
    _participants = const <Participant>[];
    _participantsController.add(_participants);
    _activeSpeaker = null;
    _activeSpeakerController.add(null);
    await _teardownRoom();
  }

  // ── Local controls ──────────────────────────────────────────────────────────

  @override
  Future<void> setMicEnabled(bool enabled) async {
    _micEnabled = enabled;
    await _room?.localParticipant?.setMicrophoneEnabled(enabled);
  }

  @override
  Future<void> setCameraEnabled(bool enabled) async {
    _cameraEnabled = enabled;
    await _room?.localParticipant?.setCameraEnabled(enabled);
  }

  @override
  Future<void> switchCamera() async {
    final List<lk.LocalTrackPublication<lk.LocalVideoTrack>> pubs =
        _room?.localParticipant?.videoTrackPublications ??
            const <lk.LocalTrackPublication<lk.LocalVideoTrack>>[];
    if (pubs.isEmpty) return;
    final lk.LocalVideoTrack? track = pubs.first.track;
    if (track == null) return;
    _cameraPosition = _cameraPosition == lk.CameraPosition.front
        ? lk.CameraPosition.back
        : lk.CameraPosition.front;
    await track.setCameraPosition(_cameraPosition);
  }

  @override
  Future<void> startScreenShare() async {
    // Mobile screen share also needs platform plumbing (Android foreground service / iOS broadcast
    // extension); that is wired with the room UI in Phase 3c. The control itself lives here.
    await _room?.localParticipant?.setScreenShareEnabled(true);
  }

  @override
  Future<void> stopScreenShare() async {
    await _room?.localParticipant?.setScreenShareEnabled(false);
  }

  @override
  Future<void> dispose() async {
    await _teardownRoom();
    await _stateController.close();
    await _participantsController.close();
    await _activeSpeakerController.close();
    await _qualityController.close();
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  /// Rebuild the engine-agnostic snapshot from the LiveKit room on every change notification.
  void _onRoomChange() {
    final lk.Room? room = _room;
    if (room == null) return;

    // State. The terminal `disconnected` is owned by the RoomDisconnectedEvent handler (it knows
    // whether it was clean or a failure), so we don't override it here.
    switch (room.connectionState) {
      case lk.ConnectionState.connecting:
        _setState(MediaSessionState.connecting);
      case lk.ConnectionState.connected:
        _setState(MediaSessionState.connected);
      case lk.ConnectionState.reconnecting:
        _setState(MediaSessionState.reconnecting);
      case lk.ConnectionState.disconnected:
        break;
    }

    // Participants: local first, then remotes.
    final lk.LocalParticipant? local = room.localParticipant;
    final List<Participant> next = <Participant>[];
    if (local != null) next.add(_mapParticipant(local, isLocal: true));
    for (final lk.RemoteParticipant remote in room.remoteParticipants.values) {
      next.add(_mapParticipant(remote, isLocal: false));
    }
    _participants = List<Participant>.unmodifiable(next);
    _participantsController.add(_participants);

    // Active speaker (the loudest, if any).
    final List<lk.Participant> speakers = room.activeSpeakers;
    final lk.Participant? speaker = speakers.isNotEmpty ? speakers.first : null;
    final Participant? mappedSpeaker = speaker == null
        ? null
        : _mapParticipant(speaker, isLocal: speaker.identity == local?.identity);
    if (mappedSpeaker != _activeSpeaker) {
      _activeSpeaker = mappedSpeaker;
      _activeSpeakerController.add(mappedSpeaker);
    }

    // Connection quality, read from the local participant.
    final ConnectionQuality quality =
        _mapQuality(local?.connectionQuality ?? lk.ConnectionQuality.unknown);
    if (quality != _quality) {
      _quality = quality;
      _qualityController.add(quality);
    }
  }

  Participant _mapParticipant(lk.Participant p, {required bool isLocal}) {
    return Participant(
      identity: p.identity,
      displayName: p.name.isEmpty ? null : p.name,
      isSpeaking: p.isSpeaking,
      audioEnabled: p.isMicrophoneEnabled(),
      videoEnabled: p.isCameraEnabled(),
      // Role isn't reliably derivable on the client yet; the local host is the teacher in the common
      // case. Precise role (from token grants / metadata) is a later refinement.
      role: isLocal ? ParticipantRole.host : ParticipantRole.participant,
      isLocal: isLocal,
    );
  }

  ConnectionQuality _mapQuality(lk.ConnectionQuality q) {
    switch (q) {
      case lk.ConnectionQuality.excellent:
        return ConnectionQuality.excellent;
      case lk.ConnectionQuality.good:
        return ConnectionQuality.good;
      case lk.ConnectionQuality.poor:
        return ConnectionQuality.poor;
      case lk.ConnectionQuality.lost:
        return ConnectionQuality.lost;
      case lk.ConnectionQuality.unknown:
        return ConnectionQuality.unknown;
    }
  }

  void _setState(MediaSessionState next) {
    if (_state == next) return;
    _state = next;
    _stateController.add(next);
  }

  Future<void> _teardownRoom() async {
    final lk.Room? room = _room;
    final lk.EventsListener<lk.RoomEvent>? events = _events;
    _room = null;
    _events = null;
    room?.removeListener(_onRoomChange);
    await events?.dispose();
    await room?.dispose();
  }
}
