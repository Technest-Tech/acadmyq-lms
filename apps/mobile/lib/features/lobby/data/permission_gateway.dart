import 'package:permission_handler/permission_handler.dart';

/// The device permissions the lobby cares about. Audio is sacred (V-AUD-1): the microphone is
/// required to join; the camera is optional.
enum DevicePermission { microphone, camera }

/// Our small permission state, decoupled from the plugin so the lobby logic is testable with a fake.
enum PermissionState { granted, denied, permanentlyDenied }

/// Engine-agnostic permission surface. The lobby depends on this, not on `permission_handler`, so its
/// logic can be exercised with a fake (no platform channels in tests).
abstract interface class PermissionGateway {
  Future<PermissionState> status(DevicePermission permission);
  Future<PermissionState> request(DevicePermission permission);

  /// Open the OS app-settings page (used when a permission is permanently denied).
  Future<void> openSettings();
}

/// Real implementation backed by `permission_handler`.
class PlatformPermissionGateway implements PermissionGateway {
  const PlatformPermissionGateway();

  Permission _permission(DevicePermission permission) => switch (permission) {
        DevicePermission.microphone => Permission.microphone,
        DevicePermission.camera => Permission.camera,
      };

  PermissionState _state(PermissionStatus status) {
    if (status.isGranted) return PermissionState.granted;
    if (status.isPermanentlyDenied || status.isRestricted) {
      return PermissionState.permanentlyDenied;
    }
    return PermissionState.denied;
  }

  @override
  Future<PermissionState> status(DevicePermission permission) async =>
      _state(await _permission(permission).status);

  @override
  Future<PermissionState> request(DevicePermission permission) async =>
      _state(await _permission(permission).request());

  @override
  Future<void> openSettings() => openAppSettings();
}
