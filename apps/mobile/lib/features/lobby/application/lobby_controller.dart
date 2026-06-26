import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../core/media/media_models.dart';
import '../../../core/network/room_token_source.dart';
import '../data/connectivity_gateway.dart';
import '../data/permission_gateway.dart';

/// Drives the lobby pre-flight: device permissions, the mic/camera intent the user will carry into
/// the room, and a coarse connectivity check — so problems are fixed *before* joining, not mid-class
/// (docs/video-platform/04-FLUTTER-CLIENT §4).
///
/// Audio is sacred (V-AUD-1): the microphone permission is required to join; the camera is optional.
class LobbyController extends ChangeNotifier {
  LobbyController(this._permissions, this._connectivity) {
    unawaited(_init());
  }

  final PermissionGateway _permissions;
  final ConnectivityGateway _connectivity;
  StreamSubscription<bool>? _onlineSub;

  bool _micEnabled = true; // audio-first default
  bool _cameraEnabled = false;
  PermissionState _micPermission = PermissionState.denied;
  PermissionState _cameraPermission = PermissionState.denied;
  bool _online = true;
  bool _checking = true;
  bool _joining = false;
  TokenFetchError? _joinError;

  bool get micEnabled => _micEnabled;
  bool get cameraEnabled => _cameraEnabled;
  PermissionState get micPermission => _micPermission;
  PermissionState get cameraPermission => _cameraPermission;
  bool get online => _online;
  bool get checking => _checking;

  /// True while a room token is being fetched (the Join button shows a spinner).
  bool get joining => _joining;

  /// The reason the last join attempt failed to get a token, if any.
  TokenFetchError? get joinError => _joinError;

  /// The microphone is mandatory (audio is sacred); the camera is not. Joining also requires a
  /// network.
  bool get canJoin =>
      _micPermission == PermissionState.granted && _online && !_checking;

  /// True once the user must be sent to OS settings to grant a permanently-denied mic.
  bool get micBlocked => _micPermission == PermissionState.permanentlyDenied;

  Future<void> _init() async {
    _micPermission = await _permissions.status(DevicePermission.microphone);
    _cameraPermission = await _permissions.status(DevicePermission.camera);
    _online = await _connectivity.isOnline();
    _onlineSub = _connectivity.onlineStream.listen((bool value) {
      _online = value;
      notifyListeners();
    });
    _checking = false;
    notifyListeners();
  }

  /// Ask for the microphone (always) and the camera (only if the user wants it on).
  Future<void> requestPermissions() async {
    _micPermission = await _permissions.request(DevicePermission.microphone);
    if (_cameraEnabled) {
      _cameraPermission = await _permissions.request(DevicePermission.camera);
    }
    notifyListeners();
  }

  void toggleMic() {
    _micEnabled = !_micEnabled;
    notifyListeners();
  }

  /// Turning the camera on requests its permission first; if denied, the camera stays off.
  Future<void> toggleCamera() async {
    final bool next = !_cameraEnabled;
    if (next && _cameraPermission != PermissionState.granted) {
      _cameraPermission = await _permissions.request(DevicePermission.camera);
      if (_cameraPermission != PermissionState.granted) {
        notifyListeners();
        return;
      }
    }
    _cameraEnabled = next;
    notifyListeners();
  }

  Future<void> openSettings() => _permissions.openSettings();

  /// Exchange the room id for scoped credentials, ready to hand to the room. Returns null (and sets
  /// [joinError]) if not joinable or the fetch fails — the screen stays in the lobby so the user can
  /// react. Guards against double-taps via [joining].
  Future<RoomCredentials?> resolveCredentials(
    RoomTokenSource source,
    String roomId,
  ) async {
    if (!canJoin || _joining) return null;
    _joining = true;
    _joinError = null;
    notifyListeners();
    try {
      return await source.fetchToken(roomId);
    } on TokenFetchException catch (e) {
      _joinError = e.kind;
      return null;
    } catch (_) {
      _joinError = TokenFetchError.unknown;
      return null;
    } finally {
      _joining = false;
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _onlineSub?.cancel();
    super.dispose();
  }
}
