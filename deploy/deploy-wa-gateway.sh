#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-wa-gateway.sh — pull, build, migrate, restart the WhatsApp gateway.
# Idempotent; safe to re-run. Run as root (or via sudo) on the gateway droplet:
#     APP_BRANCH=feat/whatsapp-gateway bash /opt/acadmyq/deploy/deploy-wa-gateway.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

WA_DIR="${WA_DIR:-/opt/acadmyq}"
APP_BRANCH="${APP_BRANCH:-feat/whatsapp-gateway}"
ENV_FILE="${ENV_FILE:-/etc/wa-gateway/wa-gateway.env}"
cd "$WA_DIR"

echo "▶ Pulling $APP_BRANCH ..."
git fetch --prune origin
git checkout "$APP_BRANCH"
git reset --hard "origin/$APP_BRANCH"

echo "▶ Installing gateway deps (filtered — not the whole monorepo) ..."
pnpm install --frozen-lockfile --filter @academiq/wa-gateway...

echo "▶ Building gateway ..."
pnpm --filter @academiq/wa-gateway build

echo "▶ Running gateway DB migrations ..."
cd "$WA_DIR/apps/wa-gateway"
set -a; . "$ENV_FILE"; set +a
node dist/migrate.js

echo "▶ Installing log rotation + the hourly database backup ..."
install -m 0644 "$WA_DIR/deploy/logrotate/wa-gateway" /etc/logrotate.d/wa-gateway
install -m 0755 "$WA_DIR/deploy/bin/wa-gateway-backup.sh" /usr/local/bin/wa-gateway-backup.sh
install -m 0644 "$WA_DIR/deploy/cron/wa-gateway-backup" /etc/cron.d/wa-gateway-backup

echo "▶ Fixing ownership + restarting service ..."
chown -R wagateway:wagateway "$WA_DIR"
systemctl restart wa-gateway

echo "▶ Health check ..."
sleep 2
curl -fsS "http://${BIND_ADDR:-127.0.0.1}:${PORT:-8088}/health" && echo
echo "✅ Gateway deploy complete."
