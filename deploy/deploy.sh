#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — pull latest code and (re)build/release both apps on the droplet.
# Idempotent; safe to re-run. Run it as the app user — NOT as root:
#     sudo -u acadmyq APP_BRANCH=feat/superadmin-reorg /var/www/acadmyq/deploy/deploy.sh
#
# Root is the wrong user even though `ssh academiq-s1` hands you a root shell: pnpm sees a
# node_modules tree owned by someone else and aborts with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY
# rather than purge it, and anything it did write would leave root-owned files under a tree the
# acadmyq-run services have to read and write. (Verified: a root run aborts cleanly at install,
# before touching the build — the live site is unaffected, so this is a safe mistake, just a
# wasted deploy.)
#
# As the app user the restart step needs a sudoers grant that DOES NOT EXIST YET:
#     /etc/sudoers.d/acadmyq-deploy, mode 0440, containing —
#     acadmyq ALL=(root) NOPASSWD: /usr/bin/systemctl restart php8.2-fpm, \
#                                  /usr/bin/systemctl restart acadmyq-web, \
#                                  /usr/bin/systemctl restart acadmyq-queue
# Until that file exists the deploy stops at the restart block below and prints the manual
# command — which is correct behaviour, not a regression: it is the difference between a deploy
# that admits it is unfinished and one that leaves a stale process serving a deleted build.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/acadmyq}"
APP_BRANCH="${APP_BRANCH:-sprint-9-audit-gating-hardening}"
cd "$APP_DIR"

echo "▶ Pulling $APP_BRANCH ..."
git fetch --prune origin
git checkout "$APP_BRANCH"
git reset --hard "origin/$APP_BRANCH"

# ── Preflight: the scheduler must exist, and must be running ─────────────────
# Everything recurring in this product lives behind one cron line: the daily session
# roll-forward, monthly invoice and payout close, hourly overdue-report flags and deductions,
# lesson reminders, trial expiry. On the Contabo box that line was never installed, and because
# nothing looked for it, the failure was invisible for two months — until an academy noticed its
# students' lessons had stopped appearing.
#
# Checked HERE, before anything is built or restarted, so a failure costs nothing: the old build
# is still running and still being served. At the end it would be worse than useless — the
# restart step exits first whenever the sudoers grant is missing, so the check would never run.
CRON_FILE=/etc/cron.d/acadmyq-scheduler
if [ ! -f "$CRON_FILE" ] && ! crontab -l 2>/dev/null | grep -q 'artisan schedule:run'; then
  echo >&2
  echo "✗ NO SCHEDULER — refusing to deploy. Nothing recurring runs without it: no session" >&2
  echo "  generation, no invoice or payout close, no overdue-report flags, no reminders. The" >&2
  echo "  app looks perfectly healthy and quietly stops producing lessons. Install it, as root:" >&2
  echo "    install -m 0644 $APP_DIR/deploy/cron/acadmyq-scheduler /etc/cron.d/acadmyq-scheduler" >&2
  exit 1
fi

# The file existing is not proof cron is executing it (a bad line, a stopped daemon). The
# scheduler appends to its log every minute, so a log older than 5 minutes means it is not.
SCHED_LOG=/var/log/acadmyq-schedule.log
if [ -f "$SCHED_LOG" ]; then
  log_age=$(( $(date +%s) - $(stat -c %Y "$SCHED_LOG") ))
  if [ "$log_age" -gt 300 ]; then
    echo "  ⚠ scheduler cron is installed but its log is ${log_age}s stale — check: systemctl status cron" >&2
  fi
fi

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
