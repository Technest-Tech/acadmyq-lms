#!/usr/bin/env bash
# Copy the Caddy-issued TLS cert for the TURN domain to a stable, CA-agnostic path that
# coturn mounts (./coturn/certs/turn.{crt,key}), and restart coturn if the cert changed.
# Run by provision.sh and by a weekly systemd timer (academiq-coturn-certs.timer) to pick up renewals.
set -euo pipefail
cd "$(dirname "$0")/.."          # → /opt/academiq-video
[ -f .env ] || { echo "missing .env"; exit 1; }
set -a; . ./.env; set +a

SRC_CRT=$(ls caddy/data/caddy/certificates/*/"${DOMAIN_TURN}"/"${DOMAIN_TURN}".crt 2>/dev/null | head -1 || true)
SRC_KEY=$(ls caddy/data/caddy/certificates/*/"${DOMAIN_TURN}"/"${DOMAIN_TURN}".key 2>/dev/null | head -1 || true)
if [ -z "${SRC_CRT}" ] || [ -z "${SRC_KEY}" ]; then
  echo "TURN cert for ${DOMAIN_TURN} not issued by Caddy yet — skipping."
  exit 0
fi

mkdir -p coturn/certs
changed=0
if ! cmp -s "${SRC_CRT}" coturn/certs/turn.crt 2>/dev/null; then changed=1; fi
cp "${SRC_CRT}" coturn/certs/turn.crt
cp "${SRC_KEY}" coturn/certs/turn.key
chmod 644 coturn/certs/turn.crt
chmod 600 coturn/certs/turn.key

if [ "${changed}" = "1" ]; then
  echo "TURN cert updated → restarting coturn"
  docker compose up -d coturn
  docker compose restart coturn || true
else
  echo "TURN cert unchanged"
fi
