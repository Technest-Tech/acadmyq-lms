import 'package:flutter/material.dart';

import 'core/design_system/tokens.dart';
import 'core/media/media_models.dart';
import 'features/room/presentation/room_screen.dart';

/// Root of the AcademIQ video client. Mobile-first, Arabic/RTL-ready, light + dark.
class AcademiqVideoApp extends StatelessWidget {
  const AcademiqVideoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AcademIQ Video',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: AppColors.light.primary,
        extensions: const <ThemeExtension<dynamic>>[AppColors.light],
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        colorSchemeSeed: AppColors.dark.primary,
        extensions: const <ThemeExtension<dynamic>>[AppColors.dark],
      ),
      home: const _DevLanding(),
    );
  }
}

/// A throwaway dev entry point so the call screen is reachable in the simulator. Replaced by the
/// lobby pre-flight (Phase 3c-ii) and, ultimately, a guest/host deep-link route.
class _DevLanding extends StatelessWidget {
  const _DevLanding();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              'AcademIQ Video',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: AppSpacing.xl),
            FilledButton.icon(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const RoomScreen(
                    credentials: RoomCredentials(
                      url: 'wss://media.dev',
                      token: 'dev-token',
                      identity: 'teacher-1',
                      roomName: 'Demo class',
                    ),
                    roomTitle: 'Demo class',
                  ),
                ),
              ),
              icon: const Icon(Icons.videocam_rounded),
              label: const Text('Enter demo room'),
            ),
          ],
        ),
      ),
    );
  }
}
