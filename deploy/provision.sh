#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# provision.sh — one-time server provisioning for a bare Ubuntu 24.04 droplet.
# Run as root. Idempotent: safe to re-run. This is the exact stack used on
# 159.89.89.241 (acadmyq.com). See DEPLOYMENT.md for the full walkthrough.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

APP_DIR=/var/www/acadmyq
APP_USER=acadmyq

echo "▶ Base packages ..."
apt-get update -qq
apt-get install -y -qq software-properties-common ca-certificates curl gnupg unzip acl lsb-release apt-transport-https

echo "▶ PHP 8.2 (ondrej PPA) + extensions ..."
add-apt-repository -y ppa:ondrej/php >/dev/null 2>&1 || true
apt-get update -qq
apt-get install -y -qq php8.2-fpm php8.2-cli php8.2-pgsql php8.2-mbstring php8.2-xml \
  php8.2-curl php8.2-zip php8.2-bcmath php8.2-intl php8.2-gd php8.2-redis php8.2-opcache php8.2-readline

echo "▶ nginx, PostgreSQL 16, Redis ..."
apt-get install -y -qq nginx postgresql postgresql-contrib redis-server

echo "▶ Composer ..."
if ! command -v composer >/dev/null; then
  curl -fsSL https://getcomposer.org/installer -o /tmp/composer-setup.php
  php8.2 /tmp/composer-setup.php --install-dir=/usr/local/bin --filename=composer
  rm -f /tmp/composer-setup.php
fi

echo "▶ Node 24 + pnpm 10 ..."
if ! command -v node >/dev/null || [ "$(node -v | cut -dv -f2 | cut -d. -f1)" != "24" ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y -qq nodejs
fi
corepack enable
corepack prepare pnpm@10 --activate

echo "▶ App user + directory ..."
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
mkdir -p "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "▶ PostgreSQL roles + databases (strong password persisted to /root/acadmyq-secrets.env) ..."
if [ ! -f /root/acadmyq-secrets.env ]; then
  echo "DB_PASSWORD=$(openssl rand -hex 24)" > /root/acadmyq-secrets.env
  chmod 600 /root/acadmyq-secrets.env
fi
DB_PW=$(grep ^DB_PASSWORD= /root/acadmyq-secrets.env | cut -d= -f2)
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
do \$\$
begin
  if not exists (select 1 from pg_roles where rolname='academiq_rls_bypass') then
    create role academiq_rls_bypass nologin bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname='academiq_app') then
    create role academiq_app login password '${DB_PW}' nosuperuser nobypassrls createdb;
  else
    alter role academiq_app password '${DB_PW}';
  end if;
end \$\$;
grant academiq_rls_bypass to academiq_app;
SQL
sudo -u postgres psql -tAc "select 1 from pg_database where datname='academiq'"      | grep -q 1 || sudo -u postgres createdb -O academiq_app academiq
sudo -u postgres psql -tAc "select 1 from pg_database where datname='academiq_test'" | grep -q 1 || sudo -u postgres createdb -O academiq_app academiq_test

echo "▶ PHP-FPM pool ..."
install -m 0644 "$APP_DIR/deploy/php-fpm/acadmyq-pool.conf" /etc/php/8.2/fpm/pool.d/acadmyq.conf 2>/dev/null || true
systemctl restart php8.2-fpm || true

echo "▶ systemd services ..."
install -m 0644 "$APP_DIR/deploy/systemd/acadmyq-web.service"   /etc/systemd/system/ 2>/dev/null || true
install -m 0644 "$APP_DIR/deploy/systemd/acadmyq-queue.service" /etc/systemd/system/ 2>/dev/null || true
systemctl daemon-reload

echo "▶ Laravel scheduler cron ..."
CRON="* * * * * cd $APP_DIR/apps/api && /usr/bin/php8.2 artisan schedule:run >> /var/log/acadmyq-schedule.log 2>&1"
( crontab -u "$APP_USER" -l 2>/dev/null | grep -v 'artisan schedule:run' ; echo "$CRON" ) | crontab -u "$APP_USER" -

echo "✅ Provision complete. Next: configure .env, run deploy.sh, obtain wildcard cert, enable nginx vhosts."
