/// Engine-agnostic value types for a live media session.
///
/// No LiveKit (or any SDK) type appears here — this is the contract the UI and controllers depend
/// on (rule V-ARCH-1, see docs/video-platform/04-FLUTTER-CLIENT.md). Swapping the media engine
/// means writing one new [MediaSession] implementation; nothing here changes.
library;

/// Credentials to connect to a room, minted by the control plane (Laravel `/video/rooms/{id}/token`).
class RoomCredentials {
  const RoomCredentials({
    required this.url,
    required this.token,
    required this.identity,
    required this.roomName,
  });

  /// The SFU websocket URL, e.g. `wss://media.example.com`.
  final String url;

  /// A short-lived, scoped LiveKit access token. The client never holds the API secret (V-SEC-1).
  final String token;

  final String identity;
  final String roomName;
}

/// Lifecycle of the session. [reconnecting] keeps trying without a full rejoin (V-MOB-2): audio
/// is preserved across a WiFi↔cellular handover rather than dropping the room.
enum MediaSessionState {
  idle,
  connecting,
  connected,
  reconnecting,
  disconnected,
  failed,
}

/// Coarse connection quality surfaced as an indicator. [lost] = no media flowing.
enum ConnectionQuality { excellent, good, poor, lost, unknown }

enum ParticipantRole { host, coHost, participant }

/// A participant in the room. The video track is rendered via a dedicated widget elsewhere — a raw
/// SDK track type never crosses this boundary.
class Participant {
  const Participant({
    required this.identity,
    this.displayName,
    this.isSpeaking = false,
    this.audioEnabled = true,
    this.videoEnabled = false,
    this.role = ParticipantRole.participant,
    this.isLocal = false,
  });

  final String identity;
  final String? displayName;
  final bool isSpeaking;
  final bool audioEnabled;
  final bool videoEnabled;
  final ParticipantRole role;
  final bool isLocal;

  Participant copyWith({
    String? displayName,
    bool? isSpeaking,
    bool? audioEnabled,
    bool? videoEnabled,
    ParticipantRole? role,
    bool? isLocal,
  }) {
    return Participant(
      identity: identity,
      displayName: displayName ?? this.displayName,
      isSpeaking: isSpeaking ?? this.isSpeaking,
      audioEnabled: audioEnabled ?? this.audioEnabled,
      videoEnabled: videoEnabled ?? this.videoEnabled,
      role: role ?? this.role,
      isLocal: isLocal ?? this.isLocal,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is Participant &&
      other.identity == identity &&
      other.displayName == displayName &&
      other.isSpeaking == isSpeaking &&
      other.audioEnabled == audioEnabled &&
      other.videoEnabled == videoEnabled &&
      other.role == role &&
      other.isLocal == isLocal;

  @override
  int get hashCode => Object.hash(
        identity,
        displayName,
        isSpeaking,
        audioEnabled,
        videoEnabled,
        role,
        isLocal,
      );
}
