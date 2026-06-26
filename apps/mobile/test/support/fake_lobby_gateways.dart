import 'dart:async';

import 'package:academiq_mobile/features/lobby/data/connectivity_gateway.dart';
import 'package:academiq_mobile/features/lobby/data/permission_gateway.dart';

/// In-memory [PermissionGateway] for lobby tests — no platform channels.
class FakePermissionGateway implements PermissionGateway {
  FakePermissionGateway({
    this.micStatus = PermissionState.denied,
    this.camStatus = PermissionState.denied,
    this.micOnRequest,
    this.camOnRequest,
  });

  PermissionState micStatus;
  PermissionState camStatus;

  /// What [request] resolves the mic/camera to (defaults to granted).
  PermissionState? micOnRequest;
  PermissionState? camOnRequest;

  int openSettingsCalls = 0;

  @override
  Future<PermissionState> status(DevicePermission permission) async =>
      permission == DevicePermission.microphone ? micStatus : camStatus;

  @override
  Future<PermissionState> request(DevicePermission permission) async {
    if (permission == DevicePermission.microphone) {
      micStatus = micOnRequest ?? PermissionState.granted;
      return micStatus;
    }
    camStatus = camOnRequest ?? PermissionState.granted;
    return camStatus;
  }

  @override
  Future<void> openSettings() async => openSettingsCalls++;
}

/// In-memory [ConnectivityGateway] for lobby tests, with a hook to flip online/offline.
class FakeConnectivityGateway implements ConnectivityGateway {
  FakeConnectivityGateway({this.online = true});

  bool online;
  final StreamController<bool> _controller = StreamController<bool>.broadcast();

  @override
  Future<bool> isOnline() async => online;

  @override
  Stream<bool> get onlineStream => _controller.stream;

  void emit(bool value) {
    online = value;
    _controller.add(value);
  }

  Future<void> dispose() => _controller.close();
}
