import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/design_system/tokens.dart';
import '../../../core/di/providers.dart';
import '../../../core/media/media_models.dart';
import '../../../core/network/room_token_source.dart';
import '../../room/presentation/room_screen.dart';
import '../application/lobby_controller.dart';
import '../data/permission_gateway.dart';

/// The pre-flight before a class: set mic/camera, grant permissions, confirm you're online — so the
/// user fixes problems here, not mid-lesson (docs/video-platform/04-FLUTTER-CLIENT §4). On Join it
/// fetches a scoped room token from the control plane, then enters the room.
class LobbyScreen extends ConsumerWidget {
  const LobbyScreen({super.key, required this.roomId, this.roomTitle});

  /// The persistent room (`video_rooms.id`) to fetch a token for.
  final String roomId;
  final String? roomTitle;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final LobbyController controller = ref.watch(lobbyControllerProvider);
    final AppColors colors = context.colors;

    return Scaffold(
      backgroundColor: colors.surface,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        title: Text(roomTitle ?? 'Join class'),
      ),
      body: SafeArea(
        child: ListenableBuilder(
          listenable: controller,
          builder: (BuildContext context, _) {
            return Padding(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                children: <Widget>[
                  Expanded(child: _Preview(controller: controller)),
                  const SizedBox(height: AppSpacing.lg),
                  _DeviceToggles(controller: controller),
                  const SizedBox(height: AppSpacing.lg),
                  _StatusAndJoin(
                    controller: controller,
                    onJoin: () => _join(context, ref, controller),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  Future<void> _join(
    BuildContext context,
    WidgetRef ref,
    LobbyController controller,
  ) async {
    final RoomCredentials? creds = await controller.resolveCredentials(
      ref.read(roomTokenSourceProvider),
      roomId,
    );
    if (creds == null || !context.mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => RoomScreen(
          credentials: creds,
          roomTitle: roomTitle,
          initialMicEnabled: controller.micEnabled,
          initialCameraEnabled: controller.cameraEnabled,
        ),
      ),
    );
  }
}

class _Preview extends StatelessWidget {
  const _Preview({required this.controller});

  final LobbyController controller;

  @override
  Widget build(BuildContext context) {
    final AppColors colors = context.colors;
    final bool showCamera = controller.cameraEnabled &&
        controller.cameraPermission == PermissionState.granted;

    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: colors.onSurface.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(AppRadii.lg),
      ),
      alignment: Alignment.center,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          // Real camera preview is wired in Phase 3c-iv (behind the media abstraction, V-ARCH-1).
          showCamera
              ? Icon(Icons.videocam_rounded, size: 48, color: colors.primary)
              : CircleAvatar(
                  radius: 44,
                  backgroundColor: colors.primary,
                  child: const Icon(Icons.person, color: Colors.white, size: 44),
                ),
          const SizedBox(height: AppSpacing.md),
          Text(
            showCamera ? 'Camera preview' : 'Camera off',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: colors.onSurface.withValues(alpha: 0.6),
                ),
          ),
        ],
      ),
    );
  }
}

class _DeviceToggles extends StatelessWidget {
  const _DeviceToggles({required this.controller});

  final LobbyController controller;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: <Widget>[
        _Toggle(
          label: controller.micEnabled ? 'Mic on' : 'Mic off',
          icon: controller.micEnabled ? Icons.mic : Icons.mic_off,
          active: controller.micEnabled,
          onTap: controller.toggleMic,
        ),
        const SizedBox(width: AppSpacing.lg),
        _Toggle(
          label: controller.cameraEnabled ? 'Camera on' : 'Camera off',
          icon: controller.cameraEnabled ? Icons.videocam : Icons.videocam_off,
          active: controller.cameraEnabled,
          onTap: controller.toggleCamera,
        ),
      ],
    );
  }
}

class _Toggle extends StatelessWidget {
  const _Toggle({
    required this.label,
    required this.icon,
    required this.active,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppColors colors = context.colors;
    final Color bg =
        active ? colors.primary : colors.onSurface.withValues(alpha: 0.08);
    final Color fg = active ? Colors.white : colors.onSurface;

    return Semantics(
      button: true,
      label: label,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadii.lg),
        child: Padding(
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg, vertical: AppSpacing.md),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
                child: Icon(icon, color: fg),
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(label, style: Theme.of(context).textTheme.labelMedium),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusAndJoin extends StatelessWidget {
  const _StatusAndJoin({required this.controller, required this.onJoin});

  final LobbyController controller;
  final VoidCallback onJoin;

  @override
  Widget build(BuildContext context) {
    final AppColors colors = context.colors;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (controller.checking)
          const Padding(
            padding: EdgeInsets.only(bottom: AppSpacing.md),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2)),
                SizedBox(width: AppSpacing.sm),
                Text('Checking your devices…'),
              ],
            ),
          )
        else if (controller.micBlocked)
          _Notice(
            color: colors.danger,
            icon: Icons.mic_off,
            text: 'Microphone access is blocked. Enable it in Settings to join.',
            actionLabel: 'Open settings',
            onAction: controller.openSettings,
          )
        else if (controller.micPermission != PermissionState.granted)
          _Notice(
            color: colors.accent,
            icon: Icons.lock_open_rounded,
            text: 'AcademIQ needs your microphone to join the class.',
            actionLabel: 'Allow microphone & camera',
            onAction: controller.requestPermissions,
          ),
        if (!controller.online)
          _Notice(
            color: colors.danger,
            icon: Icons.wifi_off_rounded,
            text: "You're offline. Reconnect to join the class.",
          ),
        if (controller.joinError != null)
          _Notice(
            color: colors.danger,
            icon: Icons.error_outline_rounded,
            text: _joinErrorMessage(controller.joinError!),
          ),
        const SizedBox(height: AppSpacing.sm),
        FilledButton.icon(
          onPressed:
              controller.canJoin && !controller.joining ? onJoin : null,
          icon: controller.joining
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white),
                )
              : const Icon(Icons.video_call_rounded),
          label: Text(controller.joining ? 'Joining…' : 'Join class'),
          style: FilledButton.styleFrom(
            backgroundColor: colors.primary,
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
          ),
        ),
      ],
    );
  }

  String _joinErrorMessage(TokenFetchError error) => switch (error) {
        TokenFetchError.unauthorized => 'Your session expired. Please sign in again.',
        TokenFetchError.upgradeRequired =>
          'Video classes aren\'t included in this plan.',
        TokenFetchError.forbidden => 'You don\'t have access to this room.',
        TokenFetchError.notFound => 'This room no longer exists.',
        TokenFetchError.network => 'Network error. Check your connection.',
        TokenFetchError.unknown => 'Something went wrong. Please try again.',
      };
}

class _Notice extends StatelessWidget {
  const _Notice({
    required this.color,
    required this.icon,
    required this.text,
    this.actionLabel,
    this.onAction,
  });

  final Color color;
  final IconData icon;
  final String text;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppRadii.md),
      ),
      child: Row(
        children: <Widget>[
          Icon(icon, color: color, size: 20),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Text(text, style: Theme.of(context).textTheme.bodySmall),
          ),
          if (actionLabel != null && onAction != null) ...<Widget>[
            const SizedBox(width: AppSpacing.sm),
            TextButton(onPressed: onAction, child: Text(actionLabel!)),
          ],
        ],
      ),
    );
  }
}
