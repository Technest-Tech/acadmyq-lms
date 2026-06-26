import 'package:academiq_mobile/core/design_system/tokens.dart';
import 'package:academiq_mobile/core/di/providers.dart';
import 'package:academiq_mobile/core/media/fake/fake_media_session.dart';
import 'package:academiq_mobile/core/media/media_models.dart';
import 'package:academiq_mobile/features/room/presentation/room_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// Phase 3c — the audio-first RoomScreen, driven entirely by the [FakeMediaSession] (no server, no
/// SDK). Because the screen speaks only the [RoomController] / [MediaSession] contract, these prove
/// the live UI flow without any media plane (rule V-ARCH-1, TC-V3.1/3.2).
void main() {
  const RoomCredentials creds = RoomCredentials(
    url: 'wss://media.test',
    token: 'token',
    identity: 'teacher-1',
    roomName: 'r-abc__academy-1',
  );

  Widget host(FakeMediaSession fake, {TextDirection direction = TextDirection.ltr}) {
    return ProviderScope(
      overrides: [
        mediaSessionProvider.overrideWithValue(fake),
      ],
      child: MaterialApp(
        theme: ThemeData(
          useMaterial3: true,
          extensions: const <ThemeExtension<dynamic>>[AppColors.light],
        ),
        home: Directionality(
          textDirection: direction,
          child: const RoomScreen(credentials: creds, roomTitle: 'Quran 1:1'),
        ),
      ),
    );
  }

  testWidgets('joins on mount and shows the room title + control bar', (WidgetTester tester) async {
    final FakeMediaSession fake = FakeMediaSession();
    await tester.pumpWidget(host(fake));
    await tester.pumpAndSettle();

    expect(find.text('Quran 1:1'), findsOneWidget);
    expect(find.byIcon(Icons.mic), findsOneWidget); // mic on
    expect(find.byIcon(Icons.call_end), findsOneWidget);
    expect(find.text('You'), findsOneWidget); // local participant on stage
  });

  testWidgets('tapping the mic toggles its state', (WidgetTester tester) async {
    final FakeMediaSession fake = FakeMediaSession();
    await tester.pumpWidget(host(fake));
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.mic), findsOneWidget);
    await tester.tap(find.byIcon(Icons.mic));
    await tester.pumpAndSettle();
    // mic_off now appears both on the control bar and as the participant's muted badge.
    expect(find.byIcon(Icons.mic_off), findsWidgets);
  });

  testWidgets('reconnecting shows the calm banner without leaving the room (V-MOB-2)',
      (WidgetTester tester) async {
    final FakeMediaSession fake = FakeMediaSession();
    await tester.pumpWidget(host(fake));
    await tester.pumpAndSettle();

    fake.simulateReconnecting();
    // Not pumpAndSettle: the banner's progress spinner animates forever and would time it out.
    await tester.pump(); // deliver the stream event + rebuild
    await tester.pump(const Duration(milliseconds: 100)); // advance the spinner
    expect(find.textContaining('Reconnecting'), findsWidgets);
    // The control bar is still present — the room was not torn down.
    expect(find.byIcon(Icons.call_end), findsOneWidget);
  });

  testWidgets('a remote participant appears in the room', (WidgetTester tester) async {
    final FakeMediaSession fake = FakeMediaSession();
    await tester.pumpWidget(host(fake));
    await tester.pumpAndSettle();

    fake.simulateRemoteJoin(
      const Participant(identity: 'student-1', displayName: 'Sara'),
    );
    await tester.pumpAndSettle();
    expect(find.text('Sara'), findsOneWidget);
  });

  testWidgets('renders in RTL', (WidgetTester tester) async {
    final FakeMediaSession fake = FakeMediaSession();
    await tester.pumpWidget(host(fake, direction: TextDirection.rtl));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.call_end), findsOneWidget);
  });
}
