#!/usr/bin/env bash
#
# certbot deploy-hook for client custom domains (docs/custom-domains).
# Installed to /usr/local/bin/acadmyq-cert-link.sh
#
# The catch-all vhost resolves a certificate by SNI out of a FLAT directory:
#
#     /etc/nginx/certs/<host>/{fullchain,privkey}.pem
#
# certbot's own layout is not flat — a lineage can land at `<host>-0001` after a
# re-issue, and the `live/` name is not always the domain. This hook is the one place
# that maps certbot's answer onto the layout nginx reads, and it runs on ISSUANCE AND
# ON EVERY RENEWAL, so a lineage that changes name repoints itself without anyone
# noticing it happened.
#
# certbot sets:
#   RENEWED_LINEAGE — /etc/letsencrypt/live/<name>
#   RENEWED_DOMAINS — space-separated list of names on the certificate
set -euo pipefail

CERT_DIR=/etc/nginx/certs

[ -n "${RENEWED_LINEAGE:-}" ] || { echo "acadmyq-cert-link: no RENEWED_LINEAGE; nothing to do" >&2; exit 0; }

mkdir -p "$CERT_DIR"

for domain in ${RENEWED_DOMAINS:-}; do
    # Refuse anything that is not a hostname before it becomes a path.
    [[ "$domain" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || continue

    ln -sfn "$RENEWED_LINEAGE" "$CERT_DIR/$domain"
    echo "acadmyq-cert-link: $domain -> $RENEWED_LINEAGE"
done

# Not needed for the custom-domain vhost — a variable `ssl_certificate` is re-read from
# disk every handshake, so the symlink flip above is live immediately. It IS needed for
# any vhost naming a certificate path directly (the acadmyq.com wildcard), which is why
# the reload is here and not skipped.
if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx || true
fi
