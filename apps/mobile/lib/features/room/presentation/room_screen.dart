import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/design_system/components/connection_indicator.dart';
import '../../../core/design_system/components/control_bar.dart';
import '../../../core/design_system/components/participant_tile.dart';
import '../../../core/design_system/tokens.dart';
import '../../../core/di/providers.dart';
import '../../../core/media/media_models.dart';
import '../application/room_controller.dart';

/// The live class — calm, audio-first (V-AUD-1): a large active-speaker focus, a quiet participant
/// strip, an elegant control bar, and a clear connection indicator. Not Zoom's busy grid.
///
/// Drives the engine-agnostic [RoomController]; it works identically against the real
/// [LivekitMediaSession] and the `FakeMediaSession` (rule V-ARCH-1).
class RoomScreen extends ConsumerStatefulWidget {
  const RoomScreen({super.key, required this.credentials, this.roomTitle});

  final RoomCredentials credentials;
  final String? roomTitle;

  @override
  ConsumerState<RoomScreen> createState() => _RoomScreenState();
}

class _RoomScreenState extends ConsumerState<RoomScreen> {
  RoomController get _controller => ref.read(roomControllerProvider);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _join());
  }

  Future<void> _join() async {
    try {
      await _controller.join(widget.credentials);
    } catch (_) {
      // The controller surfaces failure via MediaSessionState.failed; the UI renders a retry.
    }
  }

  Future<void> _leave() async {
    await _controller.leave();
    if (mounted) Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final AppColors colors = context.colors;
    final RoomController controller = ref.watch(roomControllerProvider);

    return Scaffold(
      backgroundColor: colors.surface,
      body: SafeArea(
        bottom: false,
        child: ListenableBuilder(
          listenable: controller,
          builder: (BuildContext context, _) {
            return Column(
              children: <Widget>[
                _Header(
                  title: widget.roomTitle ?? widget.credentials.roomName,
                  quality: controller.quality,
                ),
                if (controller.isReconnecting) const _ReconnectingBanner(),
                Expanded(child: _Stage(controller: controller, onRetry: _join)),
                _Strip(controller: controller),
                ControlBar(
                  isMicEnabled: controller.isMicEnabled,
                  isCameraEnabled: controller.isCameraEnabled,
                  isScreenSharing: false,
                  onToggleMic: controller.toggleMic,
                  onToggleCamera: controller.toggleCamera,
                  onSwitchCamera: () {},
                  onToggleScreenShare: () {},
                  onLeave: _leave,
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.title, required this.quality});

  final String title;
  final ConnectionQuality quality;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                    color: context.colors.onSurface,
                  ),
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          ConnectionIndicator(quality: quality),
        ],
      ),
    );
  }
}

class _ReconnectingBanner extends StatelessWidget {
  const _ReconnectingBanner();

  @override
  Widget build(BuildContext context) {
    final AppColors colors = context.colors;
    return Container(
      width: double.infinity,
      color: colors.accent.withValues(alpha: 0.15),
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.sm,
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(strokeWidth: 2, color: colors.accent),
          ),
          const SizedBox(width: AppSpacing.sm),
          // Audio is preserved across the reconnect (V-MOB-2) — reassure, don't alarm.
          Text(
            'Reconnecting… your audio is preserved',
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: colors.onSurface,
                ),
          ),
        ],
      ),
    );
  }
}

/// The centre stage: the active-speaker focus, or a state placeholder (connecting / failed / ended).
class _Stage extends StatelessWidget {
  const _Stage({required this.controller, required this.onRetry});

  final RoomController controller;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final AppColors colors = context.colors;

    switch (controller.state) {
      case MediaSessionState.idle:
      case MediaSessionState.connecting:
        return _Centered(
          icon: null,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              CircularProgressIndicator(color: colors.primary),
              const SizedBox(height: AppSpacing.lg),
              Text('Connecting…',
                  style: Theme.of(context).textTheme.bodyMedium),
            ],
          ),
        );
      case MediaSessionState.failed:
        return _Centered(
          icon: Icons.wifi_off_rounded,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text("Couldn't connect",
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: AppSpacing.md),
              FilledButton(onPressed: onRetry, child: const Text('Try again')),
            ],
          ),
        );
      case MediaSessionState.disconnected:
        return _Centered(
          icon: Icons.call_end_rounded,
          child: Text('Class ended',
              style: Theme.of(context).textTheme.titleMedium),
        );
      case MediaSessionState.connected:
      case MediaSessionState.reconnecting:
        final Participant? focus = _focusOf(controller);
        if (focus == null) {
          return _Centered(
            icon: Icons.hourglass_empty_rounded,
            child: Text('Waiting for others to join…',
                style: Theme.of(context).textTheme.bodyMedium),
          );
        }
        return Center(
          child: ParticipantTile(participant: focus, diameter: 132),
        );
    }
  }

  Participant? _focusOf(RoomController c) {
    if (c.activeSpeaker != null) return c.activeSpeaker;
    for (final Participant p in c.participants) {
      if (!p.isLocal) return p;
    }
    return c.participants.isNotEmpty ? c.participants.first : null;
  }
}

class _Centered extends StatelessWidget {
  const _Centered({required this.child, this.icon});

  final Widget child;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (icon != null) ...<Widget>[
            Icon(icon,
                size: 40,
                color: context.colors.onSurface.withValues(alpha: 0.5)),
            const SizedBox(height: AppSpacing.lg),
          ],
          child,
        ],
      ),
    );
  }
}

/// A quiet horizontal strip of the non-focused participants.
class _Strip extends StatelessWidget {
  const _Strip({required this.controller});

  final RoomController controller;

  @override
  Widget build(BuildContext context) {
    if (controller.state != MediaSessionState.connected &&
        controller.state != MediaSessionState.reconnecting) {
      return const SizedBox.shrink();
    }
    final Participant? focus =
        controller.activeSpeaker ?? _firstRemoteOrLocal(controller);
    final List<Participant> strip = controller.participants
        .where((Participant p) => p.identity != focus?.identity)
        .toList();
    if (strip.isEmpty) return const SizedBox.shrink();

    return SizedBox(
      height: 104,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
        itemCount: strip.length,
        separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.md),
        itemBuilder: (BuildContext context, int i) =>
            Center(child: ParticipantTile(participant: strip[i], diameter: 52)),
      ),
    );
  }

  Participant? _firstRemoteOrLocal(RoomController c) {
    for (final Participant p in c.participants) {
      if (!p.isLocal) return p;
    }
    return c.participants.isNotEmpty ? c.participants.first : null;
  }
}
