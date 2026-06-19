# Acadmyq — Self-Hosted Deployment (DigitalOcean)

Full, reproducible deployment of the Acadmyq monorepo (Laravel API + Next.js web)
onto a **single DigitalOcean droplet**, with per-academy **wildcard subdomains** and
shared-cookie auth. This file is the source of truth — any human or agent can deploy
or redeploy from it.

> Replaces the old Railway/Vercel/Supabase plan in `DEPLOY.md`. We now self-host
> everything (app + PostgreSQL) on one droplet.

---

## 1. Infrastructure inventory

| Item | Value |
|---|---|
| Droplet IP | `159.89.89.241` |
| OS | Ubuntu 24.04.3 LTS (hostname `acadmyq`) |
| Domain | `acadmyq.com` (DNS hosted on **DigitalOcean**) |
| SSH access | `ssh root@159.89.89.241` |
| App directory | `/var/www/acadmyq` |
| App OS user | `acadmyq` (system user, owns the app dir + runs web/queue) |
| GitHub repo | `git@github.com:Technest-Tech/acadmyq-lms.git` |
| Deploy key | `/root/.ssh/acadmyq_deploy` (+ `.pub`); added to repo → Settings → Deploy keys |
| Secrets file | `/root/acadmyq-secrets.env` (DB password, etc. — chmod 600, never committed) |

### DNS records (DigitalOcean → Networking → Domains → acadmyq.com)

| Type | Hostname | Value |
|---|---|---|
| A | `acadmyq.com` (`@`) | `159.89.89.241` |
| A | `*.acadmyq.com` | `159.89.89.241` |

The wildcard `*` makes **every** subdomain resolve to the droplet, so each academy
gets `<academy>.acadmyq.com` with zero per-tenant DNS work.

### Domain → app routing

| Hostname | Served by |
|---|---|
| `api.acadmyq.com` | Laravel API (nginx → PHP-FPM, docroot `apps/api/public`) |
| `acadmyq.com`, `app.acadmyq.com`, `*.acadmyq.com` | Next.js (nginx → `127.0.0.1:3000`) |

nginx matches the **exact** `api.acadmyq.com` vhost before the wildcard web vhost, so
API traffic is never swallowed by the wildcard. Next.js reads the `Host` header to
resolve which academy a tenant subdomain belongs to.

---

## 2. Runtime stack (installed on the droplet)

| Component | Version | Notes |
|---|---|---|
| PHP | 8.2 (FPM + CLI) | ondrej/php PPA; pinned by `.php-version` |
| Composer | 2.x | `/usr/local/bin/composer` |
| Node | 24 | NodeSource; pinned by `.nvmrc` |
| pnpm | 10 | via corepack |
| PostgreSQL | 16 | local, listens on `127.0.0.1:5432` |
| Redis | 7 | installed (available); app uses `database` drivers by default |
| nginx | 1.24 | reverse proxy + TLS termination |

Provision a fresh box in one shot with [`deploy/provision.sh`](deploy/provision.sh)
(idempotent, run as root). It installs everything above, creates the `acadmyq` user,
the PostgreSQL roles/DBs, the PHP-FPM pool, systemd units, and the scheduler cron.

### Multi-tenancy / database roles (Postgres RLS)

The app enforces tenant isolation with **Row-Level Security**, so two roles exist
(created by `provision.sh`, mirrors `apps/api/database/bootstrap/roles_and_databases.sql`):

- **`academiq_app`** — the only login role Laravel uses (migrations + runtime).
  `NOSUPERUSER, NOBYPASSRLS`, owns every table → fully subject to RLS.
- **`academiq_rls_bypass`** — `NOLOGIN, BYPASSRLS`; owns the few `SECURITY DEFINER`
  escape-hatch functions (public invoice lookup, admin academy list).

Databases `academiq` (prod) and `academiq_test` are owned by `academiq_app`.
The real password lives in `/root/acadmyq-secrets.env`.

---

## 3. Processes & services

| Service | Unit / mechanism | Purpose |
|---|---|---|
| API runtime | `php8.2-fpm` (pool `acadmyq`, socket `/run/php/php8.2-fpm-acadmyq.sock`) | serves Laravel |
| Web runtime | `acadmyq-web.service` (`pnpm start` → `next start` on :3000) | serves Next.js |
| Queue worker | `acadmyq-queue.service` (`php artisan queue:work`) | background jobs |
| Scheduler | cron `* * * * * php artisan schedule:run` (user `acadmyq`) | hourly alerts etc. |
| Web server | `nginx` | TLS + routing |

Config sources (committed, installed by `provision.sh`):
- nginx: [`deploy/nginx/`](deploy/nginx/)
- PHP-FPM pool: [`deploy/php-fpm/acadmyq-pool.conf`](deploy/php-fpm/acadmyq-pool.conf)
- systemd: [`deploy/systemd/`](deploy/systemd/)

---

## 4. First-time deployment (from a bare droplet)

```bash
# 0. SSH in
ssh root@159.89.89.241

# 1. Deploy key → GitHub  (one-time)
#    Public key already generated at /root/.ssh/acadmyq_deploy.pub
cat /root/.ssh/acadmyq_deploy.pub
#    → add at github.com/Technest-Tech/acadmyq-lms → Settings → Deploy keys (read-only is fine)
ssh -T git@github.com-acadmyq   # expect "Hi Technest-Tech/acadmyq-lms! You've successfully authenticated"

# 2. Clone (uses the github.com-acadmyq host alias from /root/.ssh/config)
git clone git@github.com-acadmyq:Technest-Tech/acadmyq-lms.git /var/www/acadmyq
chown -R acadmyq:acadmyq /var/www/acadmyq

# 3. Provision the box (idempotent — installs runtime, roles, services)
bash /var/www/acadmyq/deploy/provision.sh

# 4. Environment files
#    API:
cp /var/www/acadmyq/deploy/env/api.env.template /var/www/acadmyq/apps/api/.env
#    fill {{DB_PASSWORD}} from /root/acadmyq-secrets.env, then generate the app key:
cd /var/www/acadmyq/apps/api && php8.2 artisan key:generate
#    Web (NEXT_PUBLIC_* are inlined at build time):
cp /var/www/acadmyq/deploy/env/web.env.template /var/www/acadmyq/apps/web/.env.production

# 5. First build + migrate (then seeds, if desired)
sudo -u acadmyq APP_BRANCH=sprint-9-audit-gating-hardening /var/www/acadmyq/deploy/deploy.sh
cd /var/www/acadmyq/apps/api && sudo -u acadmyq php8.2 artisan db:seed --force   # optional demo data

# 6. Wildcard TLS certificate (see §5)

# 7. Enable nginx vhosts (after the cert exists)
ln -sf /var/www/acadmyq/deploy/nginx/api.acadmyq.com.conf /etc/nginx/sites-enabled/
ln -sf /var/www/acadmyq/deploy/nginx/web.acadmyq.com.conf /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# 8. Start app services
systemctl enable --now acadmyq-web acadmyq-queue
```

---

## 5. Wildcard TLS certificate (Let's Encrypt, DNS-01)

A wildcard cert (`*.acadmyq.com`) **requires** the DNS-01 challenge. Since DNS is on
DigitalOcean, use the certbot DO plugin for fully automatic issuance + renewal.

```bash
# Install certbot + DO DNS plugin
snap install certbot --classic
snap set certbot trust-plugin-with-root=ok
snap install certbot-dns-digitalocean

# DO API token (read+write) → DigitalOcean → API → Tokens
printf 'dns_digitalocean_token = %s\n' 'YOUR_DO_API_TOKEN' > /root/certbot-do.ini
chmod 600 /root/certbot-do.ini

# Issue the cert (covers apex + every single-level subdomain)
certbot certonly --dns-digitalocean \
  --dns-digitalocean-credentials /root/certbot-do.ini \
  --dns-digitalocean-propagation-seconds 60 \
  -d 'acadmyq.com' -d '*.acadmyq.com' \
  -m admin@acadmyq.com --agree-tos --no-eff-email

# Cert lands at /etc/letsencrypt/live/acadmyq.com/{fullchain,privkey}.pem
certbot renew --dry-run     # confirm auto-renewal works
```

> The nginx vhosts reference `/etc/letsencrypt/live/acadmyq.com/`. Obtain the cert
> **before** enabling them (step 7 above) or nginx will fail to start.

---

## 6. Recurring deploys (after the first one)

```bash
sudo -u acadmyq APP_BRANCH=sprint-9-audit-gating-hardening /var/www/acadmyq/deploy/deploy.sh
```

[`deploy/deploy.sh`](deploy/deploy.sh) pulls the branch, `pnpm install` + builds web,
`composer install --no-dev`, caches config/routes/views, runs `migrate --force`, and
restarts `php8.2-fpm`, `acadmyq-web`, `acadmyq-queue`.

> `acadmyq` needs passwordless sudo for those three `systemctl restart` calls. Grant via
> `/etc/sudoers.d/acadmyq`:
> `acadmyq ALL=(root) NOPASSWD: /usr/bin/systemctl restart php8.2-fpm, /usr/bin/systemctl restart acadmyq-web, /usr/bin/systemctl restart acadmyq-queue`

---

## 7. Auth model (cross-subdomain cookies)

Sanctum SPA cookie auth needs the API and web to share a registrable parent domain.
Everything lives under `.acadmyq.com`, so:

- API `.env`: `SESSION_DOMAIN=.acadmyq.com`, `SESSION_SECURE_COOKIE=true`,
  `SANCTUM_STATEFUL_DOMAINS=acadmyq.com,app.acadmyq.com,*.acadmyq.com`,
  `FRONTEND_URL=https://app.acadmyq.com`.
- Web build: `NEXT_PUBLIC_API_URL=https://api.acadmyq.com`, `NEXT_PUBLIC_AUTH_MODE=cookie`.

The session cookie is then first-party across the apex and every academy subdomain.

---

## 8. Health checks & troubleshooting

```bash
curl -s https://api.acadmyq.com/api/health          # → {"app":"ok","db":"ok",...}
curl -sI https://app.acadmyq.com                     # → 200, served by Next.js
systemctl status php8.2-fpm acadmyq-web acadmyq-queue nginx postgresql
journalctl -u acadmyq-web -n 50                      # Next.js logs (also /var/log/acadmyq-web.log)
tail -n 50 /var/log/acadmyq-queue.log                # queue logs
tail -n 50 /var/www/acadmyq/apps/api/storage/logs/laravel.log
```

| Symptom | Check |
|---|---|
| 502 on api | `php8.2-fpm` running? socket path matches nginx `fastcgi_pass`? |
| 502 on web | `acadmyq-web` running? `journalctl -u acadmyq-web` |
| `db: error` on /api/health | `.env` DB_PASSWORD matches `/root/acadmyq-secrets.env`? `php artisan config:cache` after edits |
| login fails cross-subdomain | `SESSION_DOMAIN=.acadmyq.com` + HTTPS + `SANCTUM_STATEFUL_DOMAINS` wildcard |
| nginx won't start | cert missing — run §5 before enabling vhosts |
| tenant subdomain 404 | app-level academy resolution from `Host` (see §9) |

---

## 9. Outstanding: app-level tenant resolution

Infra routes every `*.acadmyq.com` to Next.js, but the **application** must read the
incoming `Host` header (or `X-Forwarded-Host`), extract the subdomain, and resolve it
to an Academy. If not yet implemented, that is the remaining product work to make the
wildcard subdomains meaningful — the deployment itself is complete without it.
