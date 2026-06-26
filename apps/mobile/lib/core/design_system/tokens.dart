import 'package:flutter/material.dart';

/// Design tokens for the AcademIQ video client.
///
/// Brand-aligned with the web panel (emerald primary, gold accent) and a calm, audio-first
/// aesthetic. Exposed as a [ThemeExtension] so light/dark and future per-academy white-label are
/// config, not code (docs/video-platform/04-FLUTTER-CLIENT.md §5).
@immutable
class AppColors extends ThemeExtension<AppColors> {
  const AppColors({
    required this.primary,
    required this.accent,
    required this.surface,
    required this.onSurface,
    required this.danger,
    required this.success,
  });

  final Color primary;
  final Color accent;
  final Color surface;
  final Color onSurface;
  final Color danger;
  final Color success;

  static const AppColors light = AppColors(
    primary: Color(0xFF1E9E6A), // emerald
    accent: Color(0xFFE6B450), // gold
    surface: Color(0xFFFFFFFF),
    onSurface: Color(0xFF111827),
    danger: Color(0xFFDC2626),
    success: Color(0xFF059669),
  );

  static const AppColors dark = AppColors(
    primary: Color(0xFF34D399),
    accent: Color(0xFFF0C674),
    surface: Color(0xFF0F1115),
    onSurface: Color(0xFFE5E7EB),
    danger: Color(0xFFF87171),
    success: Color(0xFF34D399),
  );

  @override
  AppColors copyWith({
    Color? primary,
    Color? accent,
    Color? surface,
    Color? onSurface,
    Color? danger,
    Color? success,
  }) {
    return AppColors(
      primary: primary ?? this.primary,
      accent: accent ?? this.accent,
      surface: surface ?? this.surface,
      onSurface: onSurface ?? this.onSurface,
      danger: danger ?? this.danger,
      success: success ?? this.success,
    );
  }

  @override
  AppColors lerp(ThemeExtension<AppColors>? other, double t) {
    if (other is! AppColors) return this;
    return AppColors(
      primary: Color.lerp(primary, other.primary, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      onSurface: Color.lerp(onSurface, other.onSurface, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      success: Color.lerp(success, other.success, t)!,
    );
  }
}

/// Ergonomic access to the brand [AppColors] for the current theme: `context.colors.primary`.
extension AppColorsContext on BuildContext {
  AppColors get colors =>
      Theme.of(this).extension<AppColors>() ?? AppColors.light;
}

/// Spacing scale (4px base).
abstract final class AppSpacing {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
}

/// Corner radii.
abstract final class AppRadii {
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 20;
}
