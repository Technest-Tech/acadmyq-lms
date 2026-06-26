import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/app_config.dart';
import '../media/fake/fake_media_session.dart';
import '../media/livekit/livekit_media_session.dart';
import '../media/media_session.dart';
import '../network/dio_client.dart';
import '../network/room_token_source.dart';
import '../../features/lobby/application/lobby_controller.dart';
import '../../features/lobby/data/connectivity_gateway.dart';
import '../../features/lobby/data/permission_gateway.dart';
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
/// The engine is chosen by config: the fake for dev/sim, the real adapter for the live stack.
final Provider<MediaSession> mediaSessionProvider = Provider<MediaSession>((Ref ref) {
  final AppConfig config = ref.watch(appConfigProvider);
  final MediaSession session =
      config.useFakeMedia ? FakeMediaSession() : LivekitMediaSession();
  ref.onDispose(session.dispose);
  return session;
});

/// Build-time configuration (`--dart-define`).
final Provider<AppConfig> appConfigProvider =
    Provider<AppConfig>((Ref ref) => const AppConfig());

/// Configured Dio for the control plane (bearer auth, timeouts).
final Provider<Dio> dioProvider =
    Provider<Dio>((Ref ref) => buildControlPlaneDio(ref.watch(appConfigProvider)));

/// Exchanges a room id for scoped LiveKit credentials — real HTTP, or a canned fake in dev/sim.
final Provider<RoomTokenSource> roomTokenSourceProvider =
    Provider<RoomTokenSource>((Ref ref) {
  final AppConfig config = ref.watch(appConfigProvider);
  return config.useFakeMedia
      ? const FakeRoomTokenSource()
      : HttpRoomTokenSource(ref.watch(dioProvider));
});

/// The application-layer controller for the live room, bound to the active [MediaSession].
final Provider<RoomController> roomControllerProvider = Provider<RoomController>((Ref ref) {
  final RoomController controller = RoomController(ref.watch(mediaSessionProvider));
  ref.onDispose(controller.dispose);
  return controller;
});

// ── Lobby pre-flight ──────────────────────────────────────────────────────────

/// Device-permission surface (overridden with a fake in tests).
final Provider<PermissionGateway> permissionGatewayProvider =
    Provider<PermissionGateway>((Ref ref) => const PlatformPermissionGateway());

/// Coarse online/offline surface (overridden with a fake in tests).
final Provider<ConnectivityGateway> connectivityGatewayProvider =
    Provider<ConnectivityGateway>((Ref ref) => PlatformConnectivityGateway());

/// One fresh [LobbyController] per lobby visit (auto-disposed on leave) so it re-checks devices and
/// connectivity each time the user enters the pre-flight.
final lobbyControllerProvider = Provider.autoDispose<LobbyController>((Ref ref) {
  final LobbyController controller = LobbyController(
    ref.watch(permissionGatewayProvider),
    ref.watch(connectivityGatewayProvider),
  );
  ref.onDispose(controller.dispose);
  return controller;
});
