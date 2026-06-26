import 'package:flutter/material.dart';

import 'core/design_system/tokens.dart';

/// Root of the AcademIQ video client. Mobile-first, Arabic/RTL-ready, light + dark. The live room
/// experience (Phase 3c) mounts here; for now it shows a minimal placeholder so the app boots.
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
      home: const _Placeholder(),
    );
  }
}

class _Placeholder extends StatelessWidget {
  const _Placeholder();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Text(
          'AcademIQ Video',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
      ),
    );
  }
}
