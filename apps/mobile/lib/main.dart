import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'core/di/providers.dart';
import 'core/media/fake/fake_media_session.dart';
import 'core/media/media_session.dart';

void main() {
  runApp(
    ProviderScope(
      // Dev / simulator entrypoint: no server required — the UI is driven by the in-memory fake so
      // the whole call flow runs on a laptop. The live device build (Phase 3c-live) drops this
      // override, falling back to the real LiveKit adapter in [mediaSessionProvider].
      overrides: [
        mediaSessionProvider.overrideWith((ref) {
          final MediaSession session = FakeMediaSession();
          ref.onDispose(session.dispose);
          return session;
        }),
      ],
      child: const AcademiqVideoApp(),
    ),
  );
}
