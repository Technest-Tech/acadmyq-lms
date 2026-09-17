#!/usr/bin/env bash
#
# Publish a certificate where nginx can actually read it (docs/custom-domains).
# Installed to /usr/local/bin/acadmyq-cert-link.sh
#
# Two entry points:
#   as a certbot deploy-hook  — reads $RENEWED_LINEAGE / $RENEWED_DOMAINS
#   called directly           — acadmyq-cert-link.sh <domain> <lineage-dir>
#
# WHY THIS COPIES INSTEAD OF SYMLINKING, which is the whole point of the script:
#
# The catch-all vhost resolves its certificate through a VARIABLE (`$acadmyq_cert_dir`), and that
# changes who opens the file. With a static path nginx's MASTER process — root — reads the
# certificate once, at config load. With a variable it is read per handshake by a WORKER, which
# runs as www-data. certbot keeps `/etc/letsencrypt/archive` at 0700 root:root and `live/` is
# nothing but symlinks into it, so a worker cannot traverse to the file: every handshake dies with
# `BIO_new_file() failed … Permission denied` and a TLS internal-error alert.
#
# Loosening /etc/letsencrypt is the wrong fix twice over — it would hand www-data the platform
# WILDCARD's private key, and certbot restores the permissions on renewal anyway. So each
# certificate is copied out to a directory nginx owns, with a key that is group-readable by
# www-data and nothing more. Runs on issuance AND on every renewal, so the copy never goes stale.
set -euo pipefail

CERT_DIR=/etc/nginx/certs
NGINX_GROUP="${NGINX_GROUP:-www-data}"

# Install one lineage as $CERT_DIR/<domain>/{fullchain,privkey}.pem.
#
# Written to a temporary directory and moved into place, because a handshake happening right now
# must never read a half-copied key.
put() {
    local domain="$1" lineage="$2"

    [[ "$domain" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || { echo "acadmyq-cert-link: refusing '$domain'" >&2; return 0; }
    [ -r "$lineage/fullchain.pem" ] && [ -r "$lineage/privkey.pem" ] || {
        echo "acadmyq-cert-link: $lineage has no readable pair; skipping $domain" >&2; return 0; }

    local tmp="$CERT_DIR/.$domain.new"
    rm -rf "$tmp"; mkdir -p "$tmp"

    install -o root -g "$NGINX_GROUP" -m 0644 "$lineage/fullchain.pem" "$tmp/fullchain.pem"
    install -o root -g "$NGINX_GROUP" -m 0640 "$lineage/privkey.pem"   "$tmp/privkey.pem"
    chown root:"$NGINX_GROUP" "$tmp"; chmod 0750 "$tmp"

    rm -rf "$CERT_DIR/$domain.old"
    # A symlink placeholder from an earlier, un-issued state has to go, or the move nests inside it.
    [ -L "$CERT_DIR/$domain" ] && rm -f "$CERT_DIR/$domain"
    [ -d "$CERT_DIR/$domain" ] && mv "$CERT_DIR/$domain" "$CERT_DIR/$domain.old"
    mv "$tmp" "$CERT_DIR/$domain"
    rm -rf "$CERT_DIR/$domain.old"

    echo "acadmyq-cert-link: $domain <- $lineage"
}

mkdir -p "$CERT_DIR"; chmod 0755 "$CERT_DIR"

if [ "$#" -ge 2 ]; then
    put "$1" "$2"
else
    [ -n "${RENEWED_LINEAGE:-}" ] || { echo "acadmyq-cert-link: nothing to do" >&2; exit 0; }
    for domain in ${RENEWED_DOMAINS:-}; do put "$domain" "$RENEWED_LINEAGE"; done
fi

# Not needed for the catch-all vhost — a variable certificate is re-read from disk on the next
# handshake, so the copy above is live immediately. It IS needed for any vhost naming a path
# directly (the acadmyq.com wildcard), which is why the reload is here rather than skipped.
if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx || true
fi
