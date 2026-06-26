import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Rule V-ARCH-1 / TC-V3.4: the LiveKit SDK may be imported by EXACTLY ONE file — the designated
/// adapter. Everything else speaks the [MediaSession] abstraction, so the engine stays swappable,
/// mockable, and testable. This guard fails the build if any other file reaches for LiveKit.
void main() {
  test('package:livekit_client is imported only in the LiveKit adapter', () {
    const String allowed = 'lib/core/media/livekit/livekit_media_session.dart';

    final List<String> offenders = <String>[];
    for (final FileSystemEntity entity in Directory('lib').listSync(recursive: true)) {
      if (entity is! File || !entity.path.endsWith('.dart')) continue;
      final String normalized = entity.path.replaceAll(r'\', '/');
      if (normalized == allowed) continue;
      if (entity.readAsStringSync().contains('package:livekit_client')) {
        offenders.add(normalized);
      }
    }

    expect(
      offenders,
      isEmpty,
      reason: 'LiveKit must be imported only in $allowed — found in: $offenders',
    );
  });
}
