import 'package:flutter/material.dart';

import '../../media/media_models.dart';
import '../tokens.dart';

/// A calm, compact connection-quality pill — a coloured dot + short label.
///
/// Audio-first ethos (V-AUD-1): this is deliberately quiet chrome. It tells the user the line is
/// healthy without shouting; the loud signal is reserved for the reconnecting banner.
class ConnectionIndicator extends StatelessWidget {
  const ConnectionIndicator({super.key, required this.quality});

  final ConnectionQuality quality;

  @override
  Widget build(BuildContext context) {
    final AppColors colors = context.colors;
    final (Color color, String label) = switch (quality) {
      ConnectionQuality.excellent => (colors.success, 'Excellent'),
      ConnectionQuality.good => (colors.primary, 'Good'),
      ConnectionQuality.poor => (colors.accent, 'Weak'),
      ConnectionQuality.lost => (colors.danger, 'Reconnecting'),
      ConnectionQuality.unknown => (colors.onSurface.withValues(alpha: 0.4), '—'),
    };

    return Container(
      padding: const EdgeInsetsDirectional.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: colors.onSurface.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(AppRadii.lg),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: AppSpacing.sm),
          Text(
            label,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: colors.onSurface.withValues(alpha: 0.7),
                ),
          ),
        ],
      ),
    );
  }
}
