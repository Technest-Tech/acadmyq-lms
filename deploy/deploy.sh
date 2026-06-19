#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — pull latest code and (re)build/release both apps on the droplet.
# Idempotent; safe to re-run. Run as the `acadmyq` user from the repo root:
#     sudo -u acadmyq APP_BRANCH=sprint-9-audit-gating-hardening /var/www/acadmyq/deploy/deploy.sh
# Service restarts that need root are done via sudo (acadmyq is granted those, see DEPLOYMENT.md).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/acadmyq}"
APP_BRANCH="${APP_BRANCH:-sprint-9-audit-gating-hardening}"
cd "$APP_DIR"

echo "▶ Pulling $APP_BRANCH ..."
git fetch --prune origin
git checkout "$APP_BRANCH"
git reset --hard "origin/$APP_BRANCH"

echo "▶ Installing JS workspace deps ..."
pnpm install --frozen-lockfile

echo "▶ Building web (Next.js) ..."
pnpm --filter web build

echo "▶ Installing PHP deps ..."
cd "$APP_DIR/apps/api"
composer install --no-dev --optimize-autoloader --no-interaction

echo "▶ Caching Laravel config/routes/views ..."
php8.2 artisan config:cache
php8.2 artisan route:cache
php8.2 artisan view:cache

echo "▶ Running migrations ..."
php8.2 artisan migrate --force

echo "▶ Restarting services ..."
sudo systemctl restart php8.2-fpm
sudo systemctl restart acadmyq-web
sudo systemctl restart acadmyq-queue

echo "✅ Deploy complete."
