import 'package:academiq_mobile/core/media/fake/fake_media_session.dart';
import 'package:academiq_mobile/core/media/media_models.dart';
import 'package:academiq_mobile/features/room/application/room_controller.dart';
import 'package:flutter_test/flutter_test.dart';

/// Phase 3 — the MediaSession contract + RoomController logic, exercised against a fake adapter
/// with no server and no SDK (TC-V3.1). Because the controller speaks only the [MediaSession]
/// abstraction, the same tests would pass against any engine (rule V-ARCH-1).
void main() {
  const RoomCredentials creds = RoomCredentials(
    url: 'wss://media.test',
    token: 'token',
    identity: 'owner-1',
    roomName: 'r-abc__academy-1',
  );

  /// Let queued broadcast-stream events reach the controller's listeners.
  Future<void> flush() => Future<void>.delayed(Duration.zero);

  test('join connects and adds the local participant', () async {
    final FakeMediaSession session = FakeMediaSession();
    final RoomController controller = RoomController(session);

    await controller.join(creds);
    await flush();

    expect(controller.state, MediaSessionState.connected);
    expect(controller.participants.where((Participant p) => p.isLocal).length, 1);

    controller.dispose();
    await session.dispose();
  });

  test('toggleMic flips the local microphone state', () async {
    final FakeMediaSession session = FakeMediaSession();
    final RoomController controller = RoomController(session);

    await controller.join(creds);
    expect(controller.isMicEnabled, isTrue);

    await controller.toggleMic();
    expect(controller.isMicEnabled, isFalse);

    controller.dispose();
    await session.dispose();
  });

  test('a remote participant join is reflected', () async {
    final FakeMediaSession session = FakeMediaSession();
    final RoomController controller = RoomController(session);

    await controller.join(creds);
    session.simulateRemoteJoin(
      const Participant(identity: 'teacher', displayName: 'Ustadh'),
    );
    await flush();

    expect(
      controller.participants.any((Participant p) => p.identity == 'teacher'),
      isTrue,
    );

    controller.dispose();
    await session.dispose();
  });

  test('reconnecting is exposed without leaving the room (V-MOB-2)', () async {
    final FakeMediaSession session = FakeMediaSession();
    final RoomController controller = RoomController(session);

    await controller.join(creds);
    session.simulateReconnecting();
    await flush();
    expect(controller.isReconnecting, isTrue);

    session.simulateReconnected();
    await flush();
    expect(controller.state, MediaSessionState.connected);

    controller.dispose();
    await session.dispose();
  });

  test('leave disconnects and clears participants', () async {
    final FakeMediaSession session = FakeMediaSession();
    final RoomController controller = RoomController(session);

    await controller.join(creds);
    await controller.leave();
    await flush();

    expect(controller.state, MediaSessionState.disconnected);
    expect(controller.participants, isEmpty);

    controller.dispose();
    await session.dispose();
  });
}
