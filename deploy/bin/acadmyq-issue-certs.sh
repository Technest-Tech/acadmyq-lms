#!/usr/bin/env bash
#
# Issue Let's Encrypt certificates for client custom domains (docs/custom-domains).
# Installed to /usr/local/bin/acadmyq-issue-certs.sh, run from /etc/cron.d/acadmyq-certs.
#
# THE SECOND HALF of the feature. The application does the first half — `domains:verify`
# resolves each waiting host and marks the ones pointing at this server VERIFIED — and
# stops there, because asking certbot for a certificate needs root and a PHP-FPM pool
# must never have it. This script is the only thing that moves a domain to LIVE, and
# the only thing that needs privileges.
#
# It talks to Postgres directly, as the `postgres` superuser over the local socket:
#   - no application credentials to keep in a second place;
#   - superusers bypass RLS, and `academy_domains` is FORCE RLS with a Super-Admin-only
#     write policy, so a normal role would see nothing to do here.
#
# Renewal is NOT this script's job. `certbot certonly` writes a renewal config per
# domain and the packaged `certbot.timer` renews it twice a day, firing the same
# deploy-hook that keeps /etc/nginx/certs pointing at the right lineage.
set -euo pipefail

CERT_DIR=/etc/nginx/certs
FALLBACK=/etc/letsencrypt/live/acadmyq.com
WEBROOT=/var/www/html
DB=academiq
EMAIL="${ACADMYQ_ACME_EMAIL:-admin@acadmyq.com}"
HOOK=/usr/local/bin/acadmyq-cert-link.sh

psql_do() { sudo -u postgres psql -qtAX -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }
# Single quotes are the only thing that can break out of the statements below.
sql_quote() { printf "%s" "${1//\'/\'\'}"; }
is_host() { [[ "$1" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]]; }

mkdir -p "$CERT_DIR"

# The certificate served to a client that sends no SNI, and to a host whose own
# certificate does not exist yet. A name mismatch is an honest, readable failure;
# a missing file is a refused handshake with nothing to read.
[ -e "$CERT_DIR/_fallback" ] || ln -sfn "$FALLBACK" "$CERT_DIR/_fallback"

# Every host that is not live yet gets that placeholder, so the moment DNS points here
# the address answers — badly, but visibly, and the panel explains why.
while read -r host; do
    [ -n "$host" ] || continue
    is_host "$host" || continue
    [ -e "$CERT_DIR/$host" ] || ln -sfn "$CERT_DIR/_fallback" "$CERT_DIR/$host"
done < <(psql_do "select host from academy_domains where status <> 'LIVE'")

# VERIFIED = DNS already resolves to this box (the app checked), so the ACME http-01
# challenge can reach the webroot the :80 catch-all serves.
while IFS='|' read -r id host; do
    [ -n "${id:-}" ] && [ -n "${host:-}" ] || continue
    if ! is_host "$host"; then
        echo "acadmyq-issue-certs: refusing suspicious host '$host'" >&2
        continue
    fi

    psql_do "update academy_domains set status = 'ISSUING', updated_at = now() where id = '$(sql_quote "$id")'" >/dev/null

    if err=$(certbot certonly --non-interactive --agree-tos -m "$EMAIL" \
                --webroot -w "$WEBROOT" -d "$host" \
                --deploy-hook "$HOOK" 2>&1); then
        # The hook has already pointed $CERT_DIR/$host at the new lineage; this is the
        # belt-and-braces path for a certificate certbot considered "not due" and so
        # did not run a deploy hook for.
        [ -d "/etc/letsencrypt/live/$host" ] && ln -sfn "/etc/letsencrypt/live/$host" "$CERT_DIR/$host"

        psql_do "update academy_domains
                    set status = 'LIVE', issued_at = now(), last_error = null, updated_at = now()
                  where id = '$(sql_quote "$id")'" >/dev/null
        echo "acadmyq-issue-certs: $host LIVE"
    else
        # Keep only the tail: certbot's failure output is long and the panel shows this
        # to whoever is on the phone with the client.
        reason=$(printf "%s" "$err" | tail -c 500)
        psql_do "update academy_domains
                    set status = 'FAILED', last_error = '$(sql_quote "$reason")', updated_at = now()
                  where id = '$(sql_quote "$id")'" >/dev/null
        echo "acadmyq-issue-certs: $host FAILED — $reason" >&2
    fi
done < <(psql_do "select id || '|' || host from academy_domains where status = 'VERIFIED' order by created_at")
