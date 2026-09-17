<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | Custom domains (docs/custom-domains)
    |--------------------------------------------------------------------------
    |
    | A client answering on an address they own. Everything here is about the
    | ONE thing a custom domain needs that a platform subdomain does not: proof
    | that the host points at us, which is both the ownership check and the
    | precondition for Let's Encrypt's HTTP-01 challenge.
    |
    | Certificates are issued OUTSIDE the application — a root cron drop-in runs
    | certbot (deploy/bin/acadmyq-issue-certs.sh). PHP never needs root, and the
    | app's only job is to say which hosts are ready for one.
    |
    */

    // Master switch. OFF means the feature is invisible: no admin routes, no host
    // resolution, and the middleware behaves exactly as it did before. Leave it off
    // until the nginx catch-all vhost and the cert cron are actually installed, or a
    // domain will go LIVE with nowhere to terminate TLS.
    'enabled' => (bool) env('CUSTOM_DOMAINS_ENABLED', false),

    // The public IP a client's A record must resolve to for us to accept the host.
    // This is the verification gate — see the migration for why there is no TXT token.
    'origin_ip' => (string) env('CUSTOM_DOMAINS_ORIGIN_IP', ''),

    // The friendlier alternative we hand clients who would rather CNAME than A-record.
    // It MUST be a DNS-only (grey-cloud) record pointing at `origin_ip`: a proxied target
    // makes the ACME challenge unreachable and serves a Cloudflare error instead of the
    // site. Named in the panel's setup instructions verbatim.
    'cname_target' => (string) env('CUSTOM_DOMAINS_CNAME_TARGET', ''),

    // How long a resolved host (and the live-host list) is cached. Short, because it is
    // read on every request to every tenant host and a newly issued domain should start
    // working without a deploy.
    'cache_seconds' => (int) env('CUSTOM_DOMAINS_CACHE_SECONDS', 60),

];
