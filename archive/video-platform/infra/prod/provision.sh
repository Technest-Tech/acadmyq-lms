#!/usr/bin/env bash
# AcademIQ media — idempotent provisioner. Run as root from /opt/academiq-video.
#   - generates strong secrets into .env on first run (never overwrites an existing .env)
#   - renders secret-bearing configs from *.template via envsubst
#   - applies the kernel/UDP-buffer tuning + ufw media-port rules (§7 — these used to be manual)
#   - pulls pinned images and brings up the core stack
#   - waits for Caddy to issue the TURN cert, syncs it into coturn, starts coturn
# Recording/egress is NOT started here (needs S3 storage): docker compose --profile recording up -d
set -euo pipefail
cd "$(dirname "$0")"
umask 077

command -v envsubst >/dev/null 2>&1 || { apt-get update -q && apt-get install -y gettext-base; }

# ---------- .env: generate strong secrets on first run only ----------
if [ ! -f .env ]; then
  echo "No .env found — generating from .env.example with fresh secrets..."
  cp .env.example .env
  LK_KEY="API$(openssl rand -hex 8)"
  LK_SECRET="$(openssl rand -hex 48)"
  RD_PW="$(openssl rand -hex 24)"
  TURN_SEC="$(openssl rand -hex 32)"
  GF_PW="$(openssl rand -hex 16)"
  sed -i \
    -e "s|^LIVEKIT_API_KEY=.*|LIVEKIT_API_KEY=${LK_KEY}|" \
    -e "s|^LIVEKIT_API_SECRET=.*|LIVEKIT_API_SECRET=${LK_SECRET}|" \
    -e "s|^LIVEKIT_WEBHOOK_API_KEY=.*|LIVEKIT_WEBHOOK_API_KEY=${LK_KEY}|" \
    -e "s|^LIVEKIT_WEBHOOK_API_SECRET=.*|LIVEKIT_WEBHOOK_API_SECRET=${LK_SECRET}|" \
    -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=${RD_PW}|" \
    -e "s|^TURN_STATIC_AUTH_SECRET=.*|TURN_STATIC_AUTH_SECRET=${TURN_SEC}|" \
    -e "s|^GRAFANA_ADMIN_PASSWORD=.*|GRAFANA_ADMIN_PASSWORD=${GF_PW}|" \
    .env
  echo "  → secrets generated. Storage (REC_S3_*) stays as placeholders until you pick a provider."
fi
chmod 600 .env
set -a; . ./.env; set +a
: "${WEBHOOK_URL:=}"

# ---------- render secret-bearing configs ----------
VARS='${DOMAIN_MEDIA} ${DOMAIN_TURN} ${EXTERNAL_IP} ${LIVEKIT_API_KEY} ${LIVEKIT_API_SECRET}'
VARS+=' ${LIVEKIT_WEBHOOK_API_KEY} ${WEBHOOK_URL} ${REDIS_PASSWORD} ${TURN_REALM} ${TURN_STATIC_AUTH_SECRET}'
VARS+=' ${TURN_MIN_PORT} ${TURN_MAX_PORT} ${REC_S3_ENDPOINT} ${REC_S3_REGION} ${REC_S3_BUCKET}'
VARS+=' ${REC_S3_ACCESS_KEY} ${REC_S3_SECRET} ${REC_S3_FORCE_PATH_STYLE}'
mkdir -p config coturn/certs caddy/data caddy/config
envsubst "$VARS" < config/livekit.yaml.template   > config/livekit.yaml
envsubst "$VARS" < config/egress.yaml.template     > config/egress.yaml
envsubst "$VARS" < coturn/turnserver.conf.template > coturn/turnserver.conf
chmod 600 config/livekit.yaml coturn/turnserver.conf
# livekit + coturn run as root, but livekit/egress runs as NON-root (uid 1001) and must read
# its own config — keep it non-world-readable (640) but owned by the egress uid.
chmod 640 config/egress.yaml
chown 1001:root config/egress.yaml 2>/dev/null || true

# ---------- host tuning (07-DEPLOYMENT.md §7) ----------
# These were hand-run steps, so nothing guaranteed they survived a rebuild/resize — and a box that
# comes up on Ubuntu's default net.core.rmem_max (212992, ~125x too small) makes Pion silently drop
# inbound UDP under load: video stutters while audio, being tiny and loss-tolerant, sounds fine.
# Provisioning them here makes the kernel config reproducible instead of remembered.
install -m 0644 sysctl/99-livekit.conf /etc/sysctl.d/99-livekit.conf
install -m 0644 limits/99-academiq-nofile.conf /etc/security/limits.d/99-academiq-nofile.conf
# nf_conntrack_max is unsettable until the module is loaded — load it now, and on every boot.
modprobe nf_conntrack 2>/dev/null || true
echo nf_conntrack > /etc/modules-load.d/academiq.conf
sysctl --system >/dev/null
echo "host tuning applied — net.core.rmem_max=$(sysctl -n net.core.rmem_max) (want 26214400)"

# ---------- firewall (07-DEPLOYMENT.md §7) ----------
# `ufw allow` is idempotent, so this just re-asserts the media ports every run. We deliberately do
# NOT run `ufw enable`: turning the firewall on non-interactively on a live box is how you lock
# yourself out of SSH. If it's inactive the ports are open anyway — we say so and move on.
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH          >/dev/null 2>&1 || true   # first, always — before any other rule
  ufw allow 80,443/tcp       >/dev/null   # Caddy: ACME + WSS signaling
  ufw allow 7881/tcp         >/dev/null   # LiveKit ICE/TCP fallback
  ufw allow 50000:60000/udp  >/dev/null   # LiveKit RTC media — the one that actually carries video
  ufw allow 3478             >/dev/null   # coturn STUN/TURN
  ufw allow 5349             >/dev/null   # coturn TURN/TLS
  ufw allow 49160:49200/udp  >/dev/null   # coturn relay range
  if ufw status | grep -q '^Status: active'; then
    echo "ufw rules ensured (media UDP 50000-60000 open)."
  else
    echo "ufw rules staged, but ufw is INACTIVE — ports are open regardless; 'ufw enable' to turn it on."
  fi
else
  echo "ufw not installed — skipping firewall rules (ports are open)."
fi

# ---------- core stack (coturn started last, once its cert exists) ----------
docker compose pull redis livekit caddy node-exporter prometheus grafana
docker compose up -d redis livekit caddy node-exporter prometheus grafana

echo "Waiting for Caddy to issue the TLS cert for ${DOMAIN_TURN} (up to 5 min)..."
for _ in $(seq 1 60); do
  if ls caddy/data/caddy/certificates/*/"${DOMAIN_TURN}"/"${DOMAIN_TURN}".crt >/dev/null 2>&1; then
    echo "  TURN cert issued."; break
  fi
  sleep 5
done

docker compose pull coturn
./scripts/sync-coturn-certs.sh || echo "  (coturn cert not ready yet — timer will retry)"
docker compose up -d coturn

echo "=== stack status ==="
docker compose ps
echo "Core stack up. Recording: 'docker compose --profile recording up -d' after configuring REC_S3_* in .env."
