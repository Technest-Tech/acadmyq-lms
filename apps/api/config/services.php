<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'token' => env('POSTMARK_TOKEN'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'resend' => [
        'key' => env('RESEND_KEY'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    /*
    | Wasender WhatsApp gateway (per-academy automation). The auth token is NOT global — it is
    | stored per-academy (encrypted) in academy_automation_settings and passed per request, so
    | each academy's sends are fully isolated. Only the base URL and a request timeout are global.
    */
    'wasender' => [
        'base_url' => env('WASENDER_BASE_URL', 'https://wasenderapi.com'),
        'timeout' => (int) env('WASENDER_TIMEOUT', 15),
    ],

    /*
    | Live FX rates for the financial-statistics page. The owner sees every academy currency
    | converted into a single home currency (EGP by default) so multi-currency totals — and the
    | salaries computed from them — can be read in one number. open.er-api.com is free and needs
    | no key; the response is cached for `ttl` seconds so we never hammer the upstream.
    */
    'exchange' => [
        'base_url' => env('EXCHANGE_RATES_URL', 'https://open.er-api.com/v6/latest'),
        'home_currency' => env('EXCHANGE_HOME_CURRENCY', 'EGP'),
        'currencies' => ['USD', 'EUR', 'GBP', 'CAD', 'SAR', 'AED'],
        'ttl' => (int) env('EXCHANGE_RATES_TTL', 3600),
        'timeout' => (int) env('EXCHANGE_RATES_TIMEOUT', 8),
    ],

];
