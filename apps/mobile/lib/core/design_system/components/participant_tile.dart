import 'package:flutter/material.dart';

import '../../media/media_models.dart';
import '../tokens.dart';

/// A participant rendered audio-first: an initials avatar with a speaking ring and a muted badge.
///
/// Video is intentionally absent here for now — the v1 call is audio-first and the [FakeMediaSession]
/// has no tracks. When real video is wired (live device phase), the avatar is replaced by the video
/// view *behind the same [Participant] contract*, so no caller changes (rule V-ARCH-1).
class ParticipantTile extends StatelessWidget {
  const ParticipantTile({
    super.key,
    required this.participant,
    this.diameter = 56,
    this.showName = true,
  });

  final Participant participant;
  final double diameter;
  final bool showName;

  @override
  Widget build(BuildContext context) {
    final AppColors colors = context.colors;
    final bool speaking = participant.isSpeaking;
    final Color ring = speaking ? colors.primary : Colors.transparent;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.all(3),
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: ring, width: 3),
          ),
          child: Stack(
            children: <Widget>[
              Container(
                width: diameter,
                height: diameter,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: _avatarColor(colors),
                ),
                alignment: Alignment.center,
                child: Text(
                  _initials(),
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                    fontSize: diameter * 0.36,
                  ),
                ),
              ),
              if (!participant.audioEnabled)
                PositionedDirectional(
                  end: 0,
                  bottom: 0,
                  child: Container(
                    padding: const EdgeInsets.all(3),
                    decoration: BoxDecoration(
                      color: colors.danger,
                      shape: BoxShape.circle,
                      border: Border.all(color: colors.surface, width: 1.5),
                    ),
                    child: Icon(Icons.mic_off,
                        size: diameter * 0.22, color: Colors.white),
                  ),
                ),
            ],
          ),
        ),
        if (showName) ...<Widget>[
          const SizedBox(height: AppSpacing.sm),
          SizedBox(
            width: diameter + 24,
            child: Text(
              _name(),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: colors.onSurface,
                  ),
            ),
          ),
        ],
      ],
    );
  }

  String _name() {
    final String? n = participant.displayName;
    if (n != null && n.trim().isNotEmpty) return n;
    return participant.identity;
  }

  String _initials() {
    final String source = _name().trim();
    if (source.isEmpty) return '?';
    final List<String> parts =
        source.split(RegExp(r'\s+')).where((String p) => p.isNotEmpty).toList();
    if (parts.length == 1) {
      return parts.first.characters.first.toUpperCase();
    }
    return (parts.first.characters.first + parts.last.characters.first)
        .toUpperCase();
  }

  /// Deterministic avatar tint from the identity, so a participant keeps the same colour.
  Color _avatarColor(AppColors colors) {
    if (participant.isLocal) return colors.primary;
    final List<Color> palette = <Color>[
      colors.accent,
      const Color(0xFF6366F1), // indigo
      const Color(0xFF0EA5E9), // sky
      const Color(0xFFEC4899), // pink
      const Color(0xFF14B8A6), // teal
    ];
    return palette[participant.identity.hashCode.abs() % palette.length];
  }
}
