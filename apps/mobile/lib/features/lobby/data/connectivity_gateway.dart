import 'package:connectivity_plus/connectivity_plus.dart';

/// Engine-agnostic connectivity surface for the lobby pre-flight. Depending on this (not on
/// `connectivity_plus` directly) keeps the lobby logic testable with a fake.
///
/// This is a coarse online/offline check — a fast "is there any network at all" gate. A true SFU
/// reachability probe (can we actually reach the media host?) lands with the live wiring in Phase
/// 3c-iii, where it can be verified against the real stack.
abstract interface class ConnectivityGateway {
  Future<bool> isOnline();
  Stream<bool> get onlineStream;
}

/// Real implementation backed by `connectivity_plus` (v7: results are a list).
class PlatformConnectivityGateway implements ConnectivityGateway {
  PlatformConnectivityGateway([Connectivity? connectivity])
      : _connectivity = connectivity ?? Connectivity();

  final Connectivity _connectivity;

  @override
  Future<bool> isOnline() async =>
      _isOnline(await _connectivity.checkConnectivity());

  @override
  Stream<bool> get onlineStream =>
      _connectivity.onConnectivityChanged.map(_isOnline);

  bool _isOnline(List<ConnectivityResult> results) =>
      results.any((ConnectivityResult r) => r != ConnectivityResult.none);
}
