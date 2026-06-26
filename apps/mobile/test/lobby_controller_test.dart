import 'package:academiq_mobile/features/lobby/application/lobby_controller.dart';
import 'package:academiq_mobile/features/lobby/data/permission_gateway.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_lobby_gateways.dart';

/// Phase 3c — lobby pre-flight logic, with fake gateways (no platform channels). Proves the join
/// gate: mic is mandatory (audio is sacred, V-AUD-1), camera is optional, and a network is required.
void main() {
  // Let the async _init() chain (status × 2 + isOnline) settle.
  Future<void> settle() async {
    for (int i = 0; i < 5; i++) {
      await Future<void>.delayed(Duration.zero);
    }
  }

  test('joinable once mic is granted and online', () async {
    final LobbyController c = LobbyController(
      FakePermissionGateway(micStatus: PermissionState.granted),
      FakeConnectivityGateway(),
    );
    await settle();
    expect(c.checking, isFalse);
    expect(c.canJoin, isTrue);
  });

  test('mic denied blocks join until requested and granted', () async {
    final FakePermissionGateway perm = FakePermissionGateway(
      micStatus: PermissionState.denied,
      micOnRequest: PermissionState.granted,
    );
    final LobbyController c = LobbyController(perm, FakeConnectivityGateway());
    await settle();
    expect(c.canJoin, isFalse);

    await c.requestPermissions();
    expect(c.micPermission, PermissionState.granted);
    expect(c.canJoin, isTrue);
  });

  test('offline disables join, recovering when back online', () async {
    final FakeConnectivityGateway conn = FakeConnectivityGateway(online: false);
    final LobbyController c = LobbyController(
      FakePermissionGateway(micStatus: PermissionState.granted),
      conn,
    );
    await settle();
    expect(c.canJoin, isFalse);

    conn.emit(true);
    await settle();
    expect(c.online, isTrue);
    expect(c.canJoin, isTrue);
  });

  test('turning the camera on requests permission; denied keeps it off', () async {
    final FakePermissionGateway perm = FakePermissionGateway(
      micStatus: PermissionState.granted,
      camStatus: PermissionState.denied,
      camOnRequest: PermissionState.denied,
    );
    final LobbyController c = LobbyController(perm, FakeConnectivityGateway());
    await settle();

    await c.toggleCamera();
    expect(c.cameraEnabled, isFalse); // denied → stays off

    perm.camOnRequest = PermissionState.granted;
    await c.toggleCamera();
    expect(c.cameraEnabled, isTrue);
  });

  test('permanently denied mic is surfaced as blocked', () async {
    final LobbyController c = LobbyController(
      FakePermissionGateway(micStatus: PermissionState.permanentlyDenied),
      FakeConnectivityGateway(),
    );
    await settle();
    expect(c.micBlocked, isTrue);
    expect(c.canJoin, isFalse);
  });

  test('toggleMic flips the carried intent', () async {
    final LobbyController c = LobbyController(
      FakePermissionGateway(micStatus: PermissionState.granted),
      FakeConnectivityGateway(),
    );
    await settle();
    expect(c.micEnabled, isTrue);
    c.toggleMic();
    expect(c.micEnabled, isFalse);
  });
}
