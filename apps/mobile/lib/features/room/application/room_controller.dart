import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../core/media/media_models.dart';
import '../../../core/media/media_session.dart';

/// Application-layer controller for the live room.
///
/// Holds the engine-agnostic [MediaSession], mirrors its streams into a simple observable state for
/// the UI, and exposes the user actions (join / leave / toggle mic & camera). No LiveKit type ever
/// appears here — only the [MediaSession] contract (rule V-ARCH-1), so the same controller drives a
/// real call, a [FakeMediaSession] in a simulator, and the contract tests.
class RoomController extends ChangeNotifier {
  RoomController(this._session) {
    _stateSub = _session.stateStream.listen((MediaSessionState s) {
      _state = s;
      notifyListeners();
    });
    _participantsSub =
        _session.participantsStream.listen((List<Participant> p) {
      _participants = p;
      notifyListeners();
    });
    _qualitySub =
        _session.connectionQualityStream.listen((ConnectionQuality q) {
      _quality = q;
      notifyListeners();
    });
  }

  final MediaSession _session;
  late final StreamSubscription<MediaSessionState> _stateSub;
  late final StreamSubscription<List<Participant>> _participantsSub;
  late final StreamSubscription<ConnectionQuality> _qualitySub;

  MediaSessionState _state = MediaSessionState.idle;
  List<Participant> _participants = const <Participant>[];
  ConnectionQuality _quality = ConnectionQuality.unknown;

  MediaSessionState get state => _state;
  List<Participant> get participants => _participants;
  ConnectionQuality get quality => _quality;
  bool get isMicEnabled => _session.isMicEnabled;
  bool get isCameraEnabled => _session.isCameraEnabled;

  /// The UI shows a calm "reconnecting…" banner here while audio keeps trying (V-MOB-2).
  bool get isReconnecting => _state == MediaSessionState.reconnecting;

  Future<void> join(RoomCredentials credentials) => _session.connect(credentials);

  Future<void> leave() => _session.disconnect();

  Future<void> toggleMic() async {
    await _session.setMicEnabled(!_session.isMicEnabled);
    notifyListeners();
  }

  Future<void> toggleCamera() async {
    await _session.setCameraEnabled(!_session.isCameraEnabled);
    notifyListeners();
  }

  @override
  void dispose() {
    _stateSub.cancel();
    _participantsSub.cancel();
    _qualitySub.cancel();
    super.dispose();
  }
}
