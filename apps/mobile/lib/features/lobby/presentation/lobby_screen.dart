import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/design_system/tokens.dart';
import '../../../core/di/providers.dart';
import '../../../core/media/media_models.dart';
import '../../room/presentation/room_screen.dart';
import '../application/lobby_controller.dart';
import '../data/permission_gateway.dart';

/// The pre-flight before a class: set mic/camera, grant permissions, confirm you're online — so the
/// user fixes problems here, not mid-lesson (docs/video-platform/04-FLUTTER-CLIENT §4).
class LobbyScreen extends ConsumerWidget {
  const LobbyScreen({super.key, required this.credentials, this.roomTitle});

  final RoomCredentials credentials;
  final String? roomTitle;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final LobbyController controller = ref.watch(lobbyControllerProvider);
    final AppColors colors = context.colors;

    return Scaffold(
      backgroundColor: colors.surface,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        title: Text(roomTitle ?? credentials.roomName),
      ),
      body: SafeArea(
        child: ListenableBuilder(
          listenable: controller,
          builder: (BuildContext context, _) {
            return Padding(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                children: <Widget>[
                  Expanded(
                    child: _Preview(
                      controller: controller,
                      identity: credentials.identity,
                    ),
                  ),
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

  void _join(BuildContext context, WidgetRef ref, LobbyController controller) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => RoomScreen(
          credentials: credentials,
          roomTitle: roomTitle,
          initialMicEnabled: controller.micEnabled,
          initialCameraEnabled: controller.cameraEnabled,
        ),
      ),
    );
  }
}

class _Preview extends StatelessWidget {
  const _Preview({required this.controller, required this.identity});

  final LobbyController controller;
  final String identity;

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
      child: showCamera
          // Real camera preview is wired in Phase 3c-iii (behind the media abstraction, V-ARCH-1).
          ? Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Icon(Icons.videocam_rounded, size: 48, color: colors.primary),
                const SizedBox(height: AppSpacing.md),
                Text('Camera preview',
                    style: Theme.of(context).textTheme.bodyMedium),
              ],
            )
          : Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                CircleAvatar(
                  radius: 44,
                  backgroundColor: colors.primary,
                  child: Text(
                    _initial(identity),
                    style: const TextStyle(
                        color: Colors.white,
                        fontSize: 34,
                        fontWeight: FontWeight.w600),
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                Text('Camera off',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: colors.onSurface.withValues(alpha: 0.6),
                        )),
              ],
            ),
    );
  }

  String _initial(String s) =>
      s.trim().isEmpty ? '?' : s.trim().characters.first.toUpperCase();
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
        const SizedBox(height: AppSpacing.sm),
        FilledButton.icon(
          onPressed: controller.canJoin ? onJoin : null,
          icon: const Icon(Icons.video_call_rounded),
          label: const Text('Join class'),
          style: FilledButton.styleFrom(
            backgroundColor: colors.primary,
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
          ),
        ),
      ],
    );
  }
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
