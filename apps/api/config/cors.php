<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    |
    | Here you may configure your settings for cross-origin resource sharing
    | or "CORS". This determines what cross-origin operations may execute
    | in web browsers. You are free to adjust these settings as needed.
    |
    | To learn more: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
    |
    */

    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    // The Next.js frontend origin(s). Comma-separated in FRONTEND_URL.
    // e.g. local: http://localhost:3000 ; prod: https://app.academiq.com
    'allowed_origins' => array_filter(
        explode(',', (string) env('FRONTEND_URL', 'http://localhost:3000'))
    ),

    // Each client is served from its own subdomain (`<academy>.<root>`) — their course site or their
    // branded sign-in + panel (docs/lms/02) — so there is no fixed list of origins to enumerate: one
    // per client, added as clients sign up. Instead allow any single label under each configured
    // root. The roots mirror the web app's NEXT_PUBLIC_ROOT_DOMAIN (comma-separated, canonical
    // first) and may carry a dev port (`lvh.me:3000`); every label under them is an origin WE
    // control (wildcard DNS → our one app), so this widens nothing to third parties. No root ⇒ no
    // pattern (subdomain routing is off and both surfaces are reached on the apex origin, already
    // covered above).
    'allowed_origins_patterns' => array_values(array_map(
        static fn (string $root): string => '#^https?://[a-z0-9-]+\.'.preg_quote($root, '#').'$#i',
        array_filter(array_map('trim', explode(',', (string) env('LMS_SITE_ROOT_DOMAIN', ''))), static fn (string $r): bool => $r !== '')
    )),

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 0,

    // Required for Sanctum SPA cookie auth (credentials: 'include' on the client).
    'supports_credentials' => true,

];
