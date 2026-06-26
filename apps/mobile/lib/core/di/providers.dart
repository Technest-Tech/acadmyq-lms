import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../media/livekit/livekit_media_session.dart';
import '../media/media_session.dart';
import '../../features/room/application/room_controller.dart';

/// Composition root (Riverpod).
///
/// The whole app depends on the engine-agnostic [MediaSession] (rule V-ARCH-1). This file is the one
/// place that decides *which* implementation is wired in:
///   • production / device runs → [LivekitMediaSession] (the real SFU).
///   • dev simulator & tests    → override [mediaSessionProvider] with a `FakeMediaSession`.
///
/// Importing [LivekitMediaSession] here does NOT breach V-ARCH-1: this file references our adapter
/// class only — it never imports the LiveKit SDK directly, which still lives solely in the adapter.
final Provider<MediaSession> mediaSessionProvider = Provider<MediaSession>((Ref ref) {
  final MediaSession session = LivekitMediaSession();
  ref.onDispose(session.dispose);
  return session;
});

/// The application-layer controller for the live room, bound to the active [MediaSession].
final Provider<RoomController> roomControllerProvider = Provider<RoomController>((Ref ref) {
  final RoomController controller = RoomController(ref.watch(mediaSessionProvider));
  ref.onDispose(controller.dispose);
  return controller;
});
