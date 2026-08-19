#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — pull latest code and (re)build/release both apps on the droplet.
# Idempotent; safe to re-run. Simplest invocation — as root, which is what `ssh academiq-s1`
# already gives you:
#     APP_BRANCH=feat/superadmin-reorg /var/www/acadmyq/deploy/deploy.sh
#
# Running it as the app user also works, but ONLY with the sudoers grant in
# /etc/sudoers.d/acadmyq-deploy (NOPASSWD on the three service restarts). Without that grant the
# restart step cannot succeed under non-interactive SSH — see the restart block at the bottom,
# which now aborts loudly rather than leaving a stale process serving a deleted build.
#     sudo -u acadmyq APP_BRANCH=feat/superadmin-reorg /var/www/acadmyq/deploy/deploy.sh
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
# --ignore-scripts: the deploy box never runs dependency build scripts. Every native dep here
# (sharp, esbuild, @swc/core, electron, …) ships prebuilt platform binaries via optional deps, so
# their install scripts are dead weight. Without this flag pnpm 11 exits non-zero
# (ERR_PNPM_IGNORED_BUILDS) on any real relink for builds it ignored — even when they're listed in
# `ignoredBuiltDependencies` — which aborts the deploy. (Old deploys only survived because their
# install was a no-op that never re-evaluated builds; adding apps/desktop forced a relink.)
pnpm install --frozen-lockfile --ignore-scripts

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

echo "▶ Syncing RBAC catalog (permissions + role grants) ..."
# Capabilities added to PermissionCatalog only reach a role via this sync. Idempotent + additive
# (never deletes), so custom grants survive. Without it, new capabilities (e.g. the video room.*
# caps) never land on prod and the feature is silently inaccessible.
php8.2 artisan db:seed --class=Database\\Seeders\\PermissionSeeder --force

echo "▶ Restarting services ..."
# This step is the whole deploy. Everything above only puts files on disk; until the
# long-running processes are replaced, `next start` keeps serving the PREVIOUS build from
# memory while its chunk files have already been deleted from .next — so every page still
# answers 200 and every JS asset 400, which looks like a working site and is not one.
#
# Run as root (plain `ssh academiq-s1` lands as root) → systemctl directly.
# Run as the acadmyq user → needs /etc/sudoers.d/acadmyq-deploy granting NOPASSWD on exactly
# these three restarts. `sudo -n` so a missing grant fails immediately instead of blocking on
# a password prompt that no non-interactive SSH session can ever answer.
if [ "$(id -u)" -eq 0 ]; then
  RESTART=(systemctl)
else
  RESTART=(sudo -n systemctl)
fi

for svc in php8.2-fpm acadmyq-web acadmyq-queue; do
  if ! "${RESTART[@]}" restart "$svc"; then
    echo >&2
    echo "✗ FAILED to restart $svc." >&2
    echo "  The new build is on disk but OLD processes are still serving it — the site is" >&2
    echo "  live and broken until this is done. Restart manually, as root:" >&2
    echo "    ssh academiq-s1 'systemctl restart php8.2-fpm acadmyq-web acadmyq-queue'" >&2
    exit 1
  fi
done

# Prove the running web service is newer than the build it is meant to serve, so a deploy can
# never again report success while a stale process is answering requests.
BUILD_ID_FILE="$APP_DIR/apps/web/.next/BUILD_ID"
if [ -f "$BUILD_ID_FILE" ]; then
  build_epoch=$(stat -c %Y "$BUILD_ID_FILE")
  web_started=$(systemctl show -p ActiveEnterTimestamp --value acadmyq-web)
  web_epoch=$(date -d "$web_started" +%s 2>/dev/null || echo 0)
  if [ "$web_epoch" -lt "$build_epoch" ]; then
    echo "✗ acadmyq-web started BEFORE the current build — it is serving stale code." >&2
    exit 1
  fi
  echo "  build $(cat "$BUILD_ID_FILE") · web restarted $web_started"
fi

echo "✅ Deploy complete."
