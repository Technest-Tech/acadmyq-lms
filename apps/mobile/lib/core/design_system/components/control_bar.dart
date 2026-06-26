import 'package:flutter/material.dart';

import '../tokens.dart';

/// The elegant, minimal call control bar (V-AUD-1 ethos: calm, uncluttered).
///
/// Mic / camera / switch-camera / screen-share / leave. The leave button is visually distinct
/// (danger) and isolated so it's never tapped by accident. Pure presentation — all behaviour comes
/// in via callbacks from the [RoomController].
class ControlBar extends StatelessWidget {
  const ControlBar({
    super.key,
    required this.isMicEnabled,
    required this.isCameraEnabled,
    required this.isScreenSharing,
    required this.onToggleMic,
    required this.onToggleCamera,
    required this.onSwitchCamera,
    required this.onToggleScreenShare,
    required this.onLeave,
  });

  final bool isMicEnabled;
  final bool isCameraEnabled;
  final bool isScreenSharing;
  final VoidCallback onToggleMic;
  final VoidCallback onToggleCamera;
  final VoidCallback onSwitchCamera;
  final VoidCallback onToggleScreenShare;
  final VoidCallback onLeave;

  @override
  Widget build(BuildContext context) {
    final AppColors colors = context.colors;

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.md,
      ),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadii.lg)),
        boxShadow: <BoxShadow>[
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 16,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: <Widget>[
            _CircleButton(
              icon: isMicEnabled ? Icons.mic : Icons.mic_off,
              tooltip: isMicEnabled ? 'Mute' : 'Unmute',
              active: isMicEnabled,
              onTap: onToggleMic,
            ),
            _CircleButton(
              icon: isCameraEnabled ? Icons.videocam : Icons.videocam_off,
              tooltip: isCameraEnabled ? 'Turn camera off' : 'Turn camera on',
              active: isCameraEnabled,
              onTap: onToggleCamera,
            ),
            _CircleButton(
              icon: Icons.cameraswitch,
              tooltip: 'Switch camera',
              active: false,
              onTap: onSwitchCamera,
            ),
            _CircleButton(
              icon: isScreenSharing ? Icons.stop_screen_share : Icons.screen_share,
              tooltip: isScreenSharing ? 'Stop sharing' : 'Share screen',
              active: isScreenSharing,
              onTap: onToggleScreenShare,
            ),
            _CircleButton(
              icon: Icons.call_end,
              tooltip: 'Leave',
              active: false,
              danger: true,
              onTap: onLeave,
            ),
          ],
        ),
      ),
    );
  }
}

class _CircleButton extends StatelessWidget {
  const _CircleButton({
    required this.icon,
    required this.tooltip,
    required this.active,
    required this.onTap,
    this.danger = false,
  });

  final IconData icon;
  final String tooltip;
  final bool active;
  final bool danger;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppColors colors = context.colors;
    final Color bg;
    final Color fg;
    if (danger) {
      bg = colors.danger;
      fg = Colors.white;
    } else if (active) {
      bg = colors.primary;
      fg = Colors.white;
    } else {
      bg = colors.onSurface.withValues(alpha: 0.08);
      fg = colors.onSurface;
    }

    return Tooltip(
      message: tooltip,
      child: Semantics(
        button: true,
        label: tooltip,
        child: InkWell(
          onTap: onTap,
          customBorder: const CircleBorder(),
          child: Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
            child: Icon(icon, color: fg, size: 26),
          ),
        ),
      ),
    );
  }
}
