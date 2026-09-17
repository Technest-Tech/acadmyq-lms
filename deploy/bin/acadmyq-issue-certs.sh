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
WEBROOT=/var/www/html
DB=academiq
EMAIL="${ACADMYQ_ACME_EMAIL:-admin@acadmyq.com}"
HOOK=/usr/local/bin/acadmyq-cert-link.sh

psql_do() { sudo -u postgres psql -qtAX -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }
# Single quotes are the only thing that can break out of the statements below.
sql_quote() { printf "%s" "${1//\'/\'\'}"; }
is_host() { [[ "$1" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]]; }

mkdir -p "$CERT_DIR"; chmod 0755 "$CERT_DIR"

# The certificate served to a client that sends no SNI, and to a host whose own certificate does
# not exist yet. Without it those handshakes are REFUSED outright (nginx: `cannot load
# certificate … Permission denied`), which is a worse failure than a warning because there is
# nothing for the visitor or the admin to read.
#
# Deliberately SELF-SIGNED rather than the platform wildcard. Whoever reaches this path is getting
# a browser warning either way — the whole point is that the name does not match — so pointing it
# at the real wildcard would buy nothing and would hand the wildcard's private key to www-data,
# which must be able to read every certificate this directory serves (see acadmyq-cert-link.sh).
# The `-L` arm is not redundant: an earlier version of this script made `_fallback` a SYMLINK into
# certbot's tree, and through that symlink the `-f` test below succeeds — so on an upgraded box the
# broken, unreadable shape would survive every run and every handshake would keep failing.
if [ -L "$CERT_DIR/_fallback" ] || [ ! -f "$CERT_DIR/_fallback/fullchain.pem" ]; then
    rm -rf "$CERT_DIR/_fallback"
    mkdir -p "$CERT_DIR/_fallback"
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
        -subj "/CN=unconfigured.invalid" \
        -keyout "$CERT_DIR/_fallback/privkey.pem" \
        -out    "$CERT_DIR/_fallback/fullchain.pem" >/dev/null 2>&1
    chown -R root:"${NGINX_GROUP:-www-data}" "$CERT_DIR/_fallback"
    chmod 0750 "$CERT_DIR/_fallback"
    chmod 0644 "$CERT_DIR/_fallback/fullchain.pem"
    chmod 0640 "$CERT_DIR/_fallback/privkey.pem"
    echo "acadmyq-issue-certs: generated the self-signed fallback certificate"
fi

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
        # The hook has already published the pair; this is the belt-and-braces path for a
        # certificate certbot considered "not due" and so did not run a deploy hook for. Same
        # script, called directly — nginx must read a COPY, never certbot's own root-only tree.
        [ -d "/etc/letsencrypt/live/$host" ] && "$HOOK" "$host" "/etc/letsencrypt/live/$host" >/dev/null

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
