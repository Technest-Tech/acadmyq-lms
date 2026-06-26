import 'package:academiq_mobile/core/design_system/components/connection_indicator.dart';
import 'package:academiq_mobile/core/design_system/components/control_bar.dart';
import 'package:academiq_mobile/core/design_system/components/participant_tile.dart';
import 'package:academiq_mobile/core/design_system/tokens.dart';
import 'package:academiq_mobile/core/media/media_models.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// TC-V3.2 — design-system widgets render in light + dark and in RTL (Arabic) without layout errors.
void main() {
  Widget host(
    Widget child, {
    Brightness brightness = Brightness.light,
    TextDirection direction = TextDirection.ltr,
  }) {
    final AppColors colors =
        brightness == Brightness.dark ? AppColors.dark : AppColors.light;
    return MaterialApp(
      theme: ThemeData(
        useMaterial3: true,
        brightness: brightness,
        extensions: <ThemeExtension<dynamic>>[colors],
      ),
      home: Directionality(
        textDirection: direction,
        child: Scaffold(body: Center(child: child)),
      ),
    );
  }

  ControlBar buildControlBar({bool mic = true, bool cam = false}) => ControlBar(
        isMicEnabled: mic,
        isCameraEnabled: cam,
        isScreenSharing: false,
        onToggleMic: () {},
        onToggleCamera: () {},
        onSwitchCamera: () {},
        onToggleScreenShare: () {},
        onLeave: () {},
      );

  testWidgets('ConnectionIndicator shows a label for each quality', (WidgetTester tester) async {
    await tester.pumpWidget(
      host(const ConnectionIndicator(quality: ConnectionQuality.good)),
    );
    expect(find.text('Good'), findsOneWidget);

    await tester.pumpWidget(
      host(const ConnectionIndicator(quality: ConnectionQuality.poor),
          brightness: Brightness.dark),
    );
    expect(find.text('Weak'), findsOneWidget);
  });

  testWidgets('ControlBar renders all controls (light, dark, RTL)', (WidgetTester tester) async {
    await tester.pumpWidget(host(buildControlBar()));
    expect(find.byIcon(Icons.mic), findsOneWidget);
    expect(find.byIcon(Icons.videocam_off), findsOneWidget);
    expect(find.byIcon(Icons.cameraswitch), findsOneWidget);
    expect(find.byIcon(Icons.screen_share), findsOneWidget);
    expect(find.byIcon(Icons.call_end), findsOneWidget);

    await tester.pumpWidget(host(buildControlBar(), brightness: Brightness.dark));
    expect(find.byIcon(Icons.call_end), findsOneWidget);

    await tester.pumpWidget(host(buildControlBar(), direction: TextDirection.rtl));
    expect(find.byIcon(Icons.call_end), findsOneWidget);
  });

  testWidgets('ParticipantTile shows initials and a muted badge', (WidgetTester tester) async {
    await tester.pumpWidget(
      host(const ParticipantTile(
        participant: Participant(
          identity: 'u1',
          displayName: 'Ahmed Omar',
          audioEnabled: false,
        ),
      )),
    );
    expect(find.text('AO'), findsOneWidget);
    expect(find.byIcon(Icons.mic_off), findsOneWidget);
    expect(find.text('Ahmed Omar'), findsOneWidget);
  });

  testWidgets('ParticipantTile renders in RTL', (WidgetTester tester) async {
    await tester.pumpWidget(
      host(
        const ParticipantTile(
          participant: Participant(identity: 'u2', displayName: 'سارة'),
        ),
        direction: TextDirection.rtl,
      ),
    );
    expect(find.text('سارة'), findsOneWidget);
  });
}
