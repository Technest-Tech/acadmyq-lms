#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# provision-wa-gateway.sh — first-time setup of the WhatsApp gateway droplet
# (104.248.54.92). Installs Node 24 + pnpm + local Postgres 16, creates the
# `wagateway` user + database, clones the repo, lays down the systemd unit, and
# firewalls the gateway so only the APP droplet can reach it over the VPC.
#
# Run as root on the gateway droplet:
#     APP_PRIVATE_IP=10.x.x.x  REPO_URL=git@github.com:you/academiq-sass.git \
#     APP_BRANCH=feat/whatsapp-gateway  bash provision-wa-gateway.sh
#
# After it finishes: fill /etc/wa-gateway/wa-gateway.env, then run deploy-wa-gateway.sh.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

WA_DIR="${WA_DIR:-/opt/acadmyq}"
APP_BRANCH="${APP_BRANCH:-feat/whatsapp-gateway}"
REPO_URL="${REPO_URL:?set REPO_URL to the git remote}"
APP_PRIVATE_IP="${APP_PRIVATE_IP:?set APP_PRIVATE_IP to the app droplet VPC IP (firewall allowlist)}"
GW_PORT="${GW_PORT:-8088}"
WA_DB_PASSWORD="${WA_DB_PASSWORD:-$(openssl rand -hex 16)}"

echo "▶ Installing base packages ..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ufw ca-certificates gnupg postgresql postgresql-contrib

echo "▶ Installing Node.js 24 (NodeSource) + pnpm 10 ..."
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" != "24" ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
corepack enable
corepack prepare pnpm@10 --activate

echo "▶ Creating system user wagateway ..."
id -u wagateway >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin wagateway

echo "▶ Creating local Postgres role + database ..."
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='wagateway'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE ROLE wagateway LOGIN PASSWORD '${WA_DB_PASSWORD}'"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='wa_gateway'" | grep -q 1; then
  sudo -u postgres createdb -O wagateway wa_gateway
fi

echo "▶ Cloning repo to ${WA_DIR} ..."
if [ ! -d "$WA_DIR/.git" ]; then
  git clone "$REPO_URL" "$WA_DIR"
fi
cd "$WA_DIR"
git fetch --prune origin
git checkout "$APP_BRANCH"
git reset --hard "origin/$APP_BRANCH"
chown -R wagateway:wagateway "$WA_DIR"

echo "▶ Laying down env template + log + systemd unit ..."
mkdir -p /etc/wa-gateway
if [ ! -f /etc/wa-gateway/wa-gateway.env ]; then
  cp "$WA_DIR/deploy/env/wa-gateway.env.template" /etc/wa-gateway/wa-gateway.env
  # Pre-fill the generated DB password; operator still fills the secrets + private IP.
  sed -i "s|{{WA_DB_PASSWORD}}|${WA_DB_PASSWORD}|g" /etc/wa-gateway/wa-gateway.env
  echo "  -> generated WA_DB_PASSWORD=${WA_DB_PASSWORD} (saved into the env file)"
fi
chmod 600 /etc/wa-gateway/wa-gateway.env
chown wagateway:wagateway /etc/wa-gateway/wa-gateway.env

touch /var/log/wa-gateway.log
chown wagateway:wagateway /var/log/wa-gateway.log

install -m 0644 "$WA_DIR/deploy/systemd/wa-gateway.service" /etc/systemd/system/wa-gateway.service
systemctl daemon-reload
systemctl enable wa-gateway

echo "▶ Firewall: allow SSH + gateway port ONLY from the app droplet (${APP_PRIVATE_IP}) ..."
ufw allow OpenSSH
ufw allow from "${APP_PRIVATE_IP}" to any port "${GW_PORT}" proto tcp
ufw --force enable

echo "✅ Provisioned. Next:"
echo "   1) Edit /etc/wa-gateway/wa-gateway.env - set BIND_ADDR (this droplet VPC IP),"
echo "      GATEWAY_ADMIN_SECRET, WEBHOOK_SIGNING_SECRET (must match the app droplet)."
echo "   2) Run: APP_BRANCH=${APP_BRANCH} bash ${WA_DIR}/deploy/deploy-wa-gateway.sh"
