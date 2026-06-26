import 'package:academiq_mobile/core/design_system/tokens.dart';
import 'package:academiq_mobile/core/di/providers.dart';
import 'package:academiq_mobile/features/lobby/data/permission_gateway.dart';
import 'package:academiq_mobile/features/lobby/presentation/lobby_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_lobby_gateways.dart';

/// Phase 3c — the lobby screen drives the join gate from the fake gateways (no platform channels).
/// The media engine + token source default to the fakes via AppConfig (no dart-define in tests).
void main() {
  Widget host({
    required PermissionState mic,
    required bool online,
    TextDirection direction = TextDirection.ltr,
  }) {
    return ProviderScope(
      overrides: [
        permissionGatewayProvider.overrideWithValue(
          FakePermissionGateway(micStatus: mic),
        ),
        connectivityGatewayProvider.overrideWithValue(
          FakeConnectivityGateway(online: online),
        ),
      ],
      child: MaterialApp(
        theme: ThemeData(
          useMaterial3: true,
          extensions: const <ThemeExtension<dynamic>>[AppColors.light],
        ),
        home: Directionality(
          textDirection: direction,
          child: const LobbyScreen(roomId: 'demo-room', roomTitle: 'Quran 1:1'),
        ),
      ),
    );
  }

  FilledButton joinButton(WidgetTester tester) => tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Join class'),
      );

  testWidgets('Join is enabled when mic granted and online', (WidgetTester tester) async {
    await tester.pumpWidget(host(mic: PermissionState.granted, online: true));
    await tester.pumpAndSettle();

    expect(joinButton(tester).onPressed, isNotNull);
  });

  testWidgets('mic denied shows the permission CTA and disables Join', (WidgetTester tester) async {
    await tester.pumpWidget(host(mic: PermissionState.denied, online: true));
    await tester.pumpAndSettle();

    expect(find.text('Allow microphone & camera'), findsOneWidget);
    expect(joinButton(tester).onPressed, isNull);
  });

  testWidgets('offline shows a notice and disables Join', (WidgetTester tester) async {
    await tester.pumpWidget(host(mic: PermissionState.granted, online: false));
    await tester.pumpAndSettle();

    expect(find.textContaining('offline'), findsWidgets);
    expect(joinButton(tester).onPressed, isNull);
  });

  testWidgets('Join fetches a token and enters the room', (WidgetTester tester) async {
    await tester.pumpWidget(host(mic: PermissionState.granted, online: true));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Join class'));
    await tester.pumpAndSettle();

    // We're in the room now: the control bar's Leave button is present.
    expect(find.byIcon(Icons.call_end), findsOneWidget);
  });

  testWidgets('renders in RTL', (WidgetTester tester) async {
    await tester.pumpWidget(host(
      mic: PermissionState.granted,
      online: true,
      direction: TextDirection.rtl,
    ));
    await tester.pumpAndSettle();
    expect(find.text('Join class'), findsOneWidget);
  });
}
