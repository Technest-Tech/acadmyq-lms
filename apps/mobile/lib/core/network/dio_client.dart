import 'package:dio/dio.dart';

import '../config/app_config.dart';

/// Builds the configured [Dio] for talking to the Laravel control plane.
///
/// The host's short-lived Sanctum bearer token is attached per request (V-SEC-1: the client never
/// holds a LiveKit secret — only this scoped session token, which it exchanges for a room token).
Dio buildControlPlaneDio(AppConfig config) {
  final Dio dio = Dio(
    BaseOptions(
      baseUrl: config.controlPlaneBaseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 15),
      headers: <String, String>{'Accept': 'application/json'},
    ),
  );

  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (RequestOptions options, RequestInterceptorHandler handler) {
        final String? token = config.authToken;
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
    ),
  );

  return dio;
}
