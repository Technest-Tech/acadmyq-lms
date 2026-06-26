import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';

void main() {
  // The media engine + token source are chosen from AppConfig (`--dart-define`): the in-memory fake
  // by default (runs on a laptop, no server), the real LiveKit stack when USE_FAKE_MEDIA=false.
  runApp(const ProviderScope(child: AcademiqVideoApp()));
}
