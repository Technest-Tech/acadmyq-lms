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

    // The LMS public course site (docs/lms/09) serves EACH client from its own subdomain
    // (`<academy>.<root>`), so there is no fixed list of origins to enumerate — one per client, added
    // as clients sign up. Instead allow any subdomain of the configured learner-site root domain.
    // The root mirrors the web app's NEXT_PUBLIC_ROOT_DOMAIN and may carry a dev port
    // (`localhost:3000`); every label under it is an origin WE control (wildcard DNS → our one app),
    // so this widens nothing to third parties. Empty root ⇒ no pattern (subdomain routing is off and
    // the site is reached at the apex origin's `/learn/<sub>` path, already covered above).
    'allowed_origins_patterns' => array_values(array_filter([
        ($lmsRoot = trim((string) env('LMS_SITE_ROOT_DOMAIN', ''))) !== ''
            ? '#^https?://[a-z0-9-]+\.'.preg_quote($lmsRoot, '#').'$#i'
            : null,
    ])),

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 0,

    // Required for Sanctum SPA cookie auth (credentials: 'include' on the client).
    'supports_credentials' => true,

];
