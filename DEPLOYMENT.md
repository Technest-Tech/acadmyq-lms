# Acadmyq — Self-Hosted Deployment (Contabo)

Full, reproducible deployment of the Acadmyq monorepo (Laravel API + Next.js web)
onto a **single Contabo VPS**, with per-academy **wildcard subdomains** and
shared-cookie auth. This file is the source of truth — any human or agent can deploy
or redeploy from it.

> Replaces the old Railway/Vercel/Supabase plan in `DEPLOY.md`. We now self-host
> everything (app + PostgreSQL) on one VPS.
>
> **Migration history:** originally on a DigitalOcean droplet (`159.89.89.241`, NYC, 2 vCPU);
> migrated to **Contabo** on 2026-07-22 when the DO free credits ran out. DNS also moved from
> DigitalOcean to **Cloudflare** (registrar: Hostinger), and the wildcard-TLS challenge moved
> from the certbot DO plugin to the **Cloudflare** plugin. The cutover was a zero-downtime,
> zero-data-loss `pg_dump`/restore + a Cloudflare A-record IP flip (reversible). See §1 for
> current facts and §5 for TLS.

---

## 1. Infrastructure inventory

| Item | Value |
|---|---|
| Server | **Contabo Cloud VPS 4** — 4 vCPU / 8 GB / ~96 GB SSD, Ubuntu 24.04 LTS, EU (Lauterbourg) |
| Public IP | `169.58.59.194` |
| Hostname | `vmi3458789` |
| Domain | `acadmyq.com` (DNS on **Cloudflare**; registrar **Hostinger**) |
| SSH access | `ssh academiq-s1` — **key-only**, root, identity `~/.ssh/contabo_academiq_s1` (password auth disabled) |
| App directory | `/var/www/acadmyq` |
| App OS user | `acadmyq` (system user, owns the app dir + runs web/queue) |
| GitHub repo | `git@github.com:Technest-Tech/acadmyq-lms.git` |
| Deploy key | `/root/.ssh/acadmyq_deploy` (+ `.pub`); added to repo → Settings → Deploy keys |
| Secrets file | `/root/acadmyq-secrets.env` (DB password, etc. — chmod 600, never committed) |
| Deployed branch | **`feat/superadmin-reorg`** (was `feat/video-platform` at the 2026-07-22 migration) |

> The **media/video plane is a second box** — Contabo VPS 6 `169.58.59.255`
> (`ssh academiq-s2`, `media.acadmyq.com` + `turn.acadmyq.com`). See
> [`docs/video-platform/07-DEPLOYMENT.md`](docs/video-platform/07-DEPLOYMENT.md).

### Connecting, and running anything by hand

`ssh academiq-s1` is the whole connection. It resolves from `~/.ssh/config` on the Mac:

```
Host academiq-s1
    HostName 169.58.59.194
    User root
    IdentityFile ~/.ssh/contabo_academiq_s1
    IdentitiesOnly yes
```

**You land as `root`, but almost nothing should be run as root.** The app is owned by the
`acadmyq` user; run app commands through it, or you will leave root-owned files behind that
break the next deploy.

```bash
# artisan / composer / pnpm — always as the app user
ssh academiq-s1 "cd /var/www/acadmyq/apps/api && sudo -u acadmyq php artisan <cmd>"

# a deploy (see §6)
ssh academiq-s1 'sudo -u acadmyq APP_BRANCH=feat/superadmin-reorg /var/www/acadmyq/deploy/deploy.sh'
```

> ⚠️ **Never run `git` as root in `/var/www/acadmyq`** — not even `git status`. It writes
> `.git/index` and loose objects as root, and the next deploy dies at the pull with
> `insufficient permission for adding an object to repository database .git/objects`
> (it fails *before* changing anything, so the live site stays up). Bit us 2026-09-20.
> Repair, non-destructive: `chown -R acadmyq:acadmyq /var/www/acadmyq/.git`, then confirm
> `sudo -u acadmyq git fetch origin` works. Prefix every read too: `sudo -u acadmyq git status`.

#### Querying the database

The database is **`academiq`**. There is no database called `acadmyq` — that is the *app*
directory, the OS user and the domain, and reaching for it is the most common wasted minute here.

```bash
# cross-tenant diagnostics — superuser, BYPASSES RLS, sees every academy
ssh academiq-s1 "sudo -u postgres psql -d academiq -c '<sql>'"
```

Every tenant table is `FORCE ROW LEVEL SECURITY`. Connecting as `academiq_app` (the role the app
uses) returns **zero rows** from `whatsapp_groups`, `sessions`, `invoices` … unless the tenant GUC
is set first — and an empty result reads exactly like "nothing is configured", which is the trap:

```sql
set local app.current_academy_id = '<academy-uuid>';   -- inside a transaction
```

So: use `postgres` to diagnose, `academiq_app` only to reproduce what the app itself sees.

Backups before anything destructive (`/root` is not writable by postgres):

```bash
sudo -u postgres pg_dump -Fc -d academiq -f /var/backups/acadmyq/academiq-$(date +%Y%m%d-%H%M%S).dump
```

### DNS records (Cloudflare → acadmyq.com)

| Type | Hostname | Value | Proxy |
|---|---|---|---|
| A | `acadmyq.com` (`@`) | `169.58.59.194` | **Proxied** (orange) |
| A | `www.acadmyq.com` | `169.58.59.194` | **Proxied** (orange) |
| A | `*.acadmyq.com` | `169.58.59.194` | **Proxied** (orange) |
| A | `media.acadmyq.com` | `169.58.59.255` (Server 2) | **DNS-only** (grey) |
| A | `turn.acadmyq.com` | `169.58.59.255` (Server 2) | **DNS-only** (grey) |

The wildcard `*` makes **every** subdomain resolve to Server 1, so each academy gets
`<academy>.acadmyq.com` with zero per-tenant DNS work. The app records are **proxied**
(Cloudflare CDN + SSL + DDoS).

⚠️ The `media`/`turn` records are explicit **DNS-only** overrides pointing at the media box
(Server 2) — they must **never** be proxied (Cloudflare's proxy can't carry WebRTC/UDP).
Because a proxied wildcard would otherwise swallow them and break video, these explicit
grey-cloud records are mandatory.

> **Cutover / rollback:** the origin holds a real Let's Encrypt wildcard cert (§5), so
> Cloudflare "Full (strict)" works. Moving to a new origin is just editing the A-record IPs
> in Cloudflare (proxied → instant + reversible; no nameserver change).

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

> **⚠️ Contabo apt gotcha — do this BEFORE `provision.sh` (and it's not in the script):**
> the default `archive.ubuntu.com` (and `mirror.contabo.net`) are **unreachable** from the
> Lauterbourg boxes, so `apt` hangs forever mid-install. Repoint apt at a working mirror +
> force IPv4 first, and install `git` (also not installed by default):
> ```bash
> sed -i 's|http://archive.ubuntu.com/ubuntu|http://de.archive.ubuntu.com/ubuntu|g; \
>         s|http://security.ubuntu.com/ubuntu|http://de.archive.ubuntu.com/ubuntu|g' \
>   /etc/apt/sources.list.d/ubuntu.sources
> printf 'Acquire::ForceIPv4 "true";\n' > /etc/apt/apt.conf.d/99force-ipv4
> apt-get update && apt-get install -y git
> ```

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
| Scheduler | cron `* * * * * php artisan schedule:run` (user `acadmyq`) | drives **every** recurring job, down to per-minute ones (see `apps/api/routes/console.php`) |
| WhatsApp gateway | `wa-gateway.service` (user `acadmyq`, `127.0.0.1:8088`, own PG db `wa_gateway`) | self-hosted Baileys; sends every academy's WhatsApp |
| Web server | `nginx` | TLS + routing |

Config sources (committed, installed by `provision.sh`):
- nginx: [`deploy/nginx/`](deploy/nginx/)
- PHP-FPM pool: [`deploy/php-fpm/acadmyq-pool.conf`](deploy/php-fpm/acadmyq-pool.conf)
- systemd: [`deploy/systemd/`](deploy/systemd/)

---

## 4. First-time deployment (from a bare droplet)

```bash
# 0. SSH in  (key-only; alias in ~/.ssh/config on the Mac)
ssh academiq-s1        # = root@169.58.59.194, identity ~/.ssh/contabo_academiq_s1

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
#    ⚠️ MIGRATING an existing box (not a fresh install)? Do NOT key:generate — copy the
#    existing apps/api/.env verbatim (same APP_KEY) and reuse /root/acadmyq-secrets.env,
#    or encrypted DB data + live sessions break. And restore a pg_dump instead of running
#    fresh migrations/seed (see the 2026-07-22 DO→Contabo migration in §History).
#    Web (NEXT_PUBLIC_* are inlined at build time):
cp /var/www/acadmyq/deploy/env/web.env.template /var/www/acadmyq/apps/web/.env.production

# 5. First build + migrate (then seeds, if desired)
sudo -u acadmyq APP_BRANCH=feat/video-platform /var/www/acadmyq/deploy/deploy.sh
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

## 5. Wildcard TLS certificate (Let's Encrypt, DNS-01 via Cloudflare)

A wildcard cert (`*.acadmyq.com`) **requires** the DNS-01 challenge. DNS is on **Cloudflare**,
so use the certbot **Cloudflare** plugin for fully automatic issuance + renewal.

```bash
# Install certbot + Cloudflare DNS plugin (apt, not snap)
apt-get install -y certbot python3-certbot-dns-cloudflare

# Cloudflare API token with Zone:DNS:Edit (+ Zone:Read) on acadmyq.com
printf 'dns_cloudflare_api_token = %s\n' 'YOUR_CF_API_TOKEN' > /root/certbot-cf.ini
chmod 600 /root/certbot-cf.ini

# Issue the cert (covers apex + every single-level subdomain)
certbot certonly --non-interactive --agree-tos -m admin@acadmyq.com \
  --dns-cloudflare --dns-cloudflare-credentials /root/certbot-cf.ini \
  --dns-cloudflare-propagation-seconds 30 \
  -d 'acadmyq.com' -d '*.acadmyq.com' \
  --cert-name acadmyq.com

# Cert lands at /etc/letsencrypt/live/acadmyq.com/{fullchain,privkey}.pem
certbot renew --dry-run     # confirm auto-renewal works (certbot.timer runs it 2x/day)
```

> The nginx vhosts reference `/etc/letsencrypt/live/acadmyq.com/`. Obtain the cert
> **before** enabling them (step 7 above) or nginx will fail to start.
>
> **Gotcha:** if a placeholder cert (e.g. a temporary self-signed one) already occupies
> `/etc/letsencrypt/live/acadmyq.com/`, remove that dir first — certbot refuses to write
> into a `live/` dir it didn't create ("live directory exists for acadmyq.com").
>
> **Why not a Cloudflare Origin cert?** The app is proxied, so a CF Origin cert would also
> work — but a real LE cert is publicly-trusted, works in *any* Cloudflare SSL mode, and needs
> no dashboard step. (A plain `Zone:DNS:Edit` token can't mint Origin certs anyway — that
> needs the account-level Origin CA permission, which returns `1016 not authorized` otherwise.)
>
> The token lives at `/root/certbot-cf.ini` for auto-renewal — treat it as a secret and
> rotate it if it's ever exposed (update the file after rotating).

---

## 6. Recurring deploys (after the first one)

```bash
ssh academiq-s1 'sudo -u acadmyq APP_BRANCH=feat/superadmin-reorg /var/www/acadmyq/deploy/deploy.sh'
```

**Always pass `APP_BRANCH` explicitly** — the script's own default is still the old
`sprint-9-audit-gating-hardening`. It does `git reset --hard origin/$APP_BRANCH`, so local work
deploys **only after commit + push**. Takes ~10 min (the Next build dominates); run it in the
background and read the log.

[`deploy/deploy.sh`](deploy/deploy.sh) pulls the branch, `pnpm install` + builds web,
`composer install --no-dev`, caches config/routes/views, runs `migrate --force`, and
restarts `php8.2-fpm`, `acadmyq-web`, `acadmyq-queue`.

> The passwordless-sudo grant for those three restarts is **installed** (since 2026-09-14) at
> `/etc/sudoers.d/acadmyq-deploy`, so the script finishes on its own. If it ever stops at
> `sudo: a password is required`, the grant was lost — finish by hand with
> `ssh academiq-s1 'systemctl restart php8.2-fpm acadmyq-web acadmyq-queue'` and confirm
> `acadmyq-web`'s `ActiveEnterTimestamp` is later than the mtime of `apps/web/.next/BUILD_ID`.

> **`deploy.sh` does not touch the WhatsApp gateway.** After a deploy that changed
> `apps/wa-gateway`, run as root:
> ```bash
> cd /var/www/acadmyq && sudo -u acadmyq pnpm --filter @academiq/wa-gateway build \
>   && sudo -u acadmyq bash -c 'set -a; . /etc/wa-gateway/wa-gateway.env; set +a; cd apps/wa-gateway && node dist/migrate.js' \
>   && systemctl restart wa-gateway
> ```

> **nginx is not in the deploy either.** `deploy/nginx/*.conf` are copies you apply by hand;
> after changing one, `nginx -t` **before** `systemctl reload nginx`. A broken config keeps
> serving from memory and only takes the site down at the next reload (a certbot renewal, a reboot).

---

## 7. Auth model (cross-subdomain cookies)

Sanctum SPA cookie auth needs the API and web to share a registrable parent domain.
Everything lives under `.acadmyq.com`, so:

- API `.env`: `SESSION_DOMAIN=.acadmyq.com`, `SESSION_SECURE_COOKIE=true`,
  `SANCTUM_STATEFUL_DOMAINS=acadmyq.com,app.acadmyq.com,*.acadmyq.com`,
  `FRONTEND_URL=https://acadmyq.com` (apex is the canonical app entry).
- Web build: `NEXT_PUBLIC_API_URL=https://api.acadmyq.com`, `NEXT_PUBLIC_AUTH_MODE=cookie`.

The session cookie is then first-party across the apex and every academy subdomain.

---

## 8. Health checks & troubleshooting

```bash
curl -s https://api.acadmyq.com/api/health          # → {"app","db","scheduler":{"age_seconds"},...}
curl -sI https://acadmyq.com                         # → 200, served by Next.js
curl -s localhost:8088/health                        # WhatsApp gateway (on the box; loopback only)
systemctl status php8.2-fpm acadmyq-web acadmyq-queue nginx postgresql
journalctl -u acadmyq-web -n 50                      # Next.js logs (also /var/log/acadmyq-web.log)
tail -n 50 /var/log/acadmyq-queue.log                # queue logs
tail -n 50 /var/www/acadmyq/apps/api/storage/logs/laravel.log
```

| Symptom | Check |
|---|---|
| `/api/health` returns a Next.js 404 page | you asked **`acadmyq.com`**, which is the web app. The API is only on **`api.acadmyq.com`**. (`web.acadmyq.com` is a stub that 404s — not a broken deploy.) |
| a scheduled job never fires | `scheduler.age_seconds` on `/api/health` — one cron line drives them all, so if it is stale *nothing* recurring is running |
| a new authed route "is missing" | it proves itself with **401** (or 405 on a wrong verb), never 404. `sudo -u acadmyq php artisan route:list --path=<x>` confirms the route cache picked it up |
| 502 on api | `php8.2-fpm` running? socket path matches nginx `fastcgi_pass`? |
| 502 on web | `acadmyq-web` running? `journalctl -u acadmyq-web` |
| `db: error` on /api/health | `.env` DB_PASSWORD matches `/root/acadmyq-secrets.env`? `php artisan config:cache` after edits |
| login fails cross-subdomain | `SESSION_DOMAIN=.acadmyq.com` + HTTPS + `SANCTUM_STATEFUL_DOMAINS` wildcard |
| nginx won't start | cert missing — run §5 before enabling vhosts |
| tenant subdomain 404 | app-level academy resolution from `Host` (see §9) |
| `Session store not set on request.` on login | the sign-in host is not in `SANCTUM_STATEFUL_DOMAINS` — Sanctum saw a stateless request and bound no session. Needs the `*.acadmyq.com` wildcard (locally: see docs/lms/02 §"Local development" — `*.localhost` cannot work) |
| client subdomain shows the course site (or a 404) instead of their sign-in | the client resolves as a course-platform client — check `GET /api/site` with `X-Academy: <handle>`; it reports `LMS` only when the LMS is their whole product |

---

## 9. Tenant resolution (client subdomains)

Infra routes every `*.acadmyq.com` to Next.js; the **application** turns that subdomain into
a tenant. `apps/web/src/middleware.ts` reads the `Host` header, asks the API which product that
handle serves (`GET /api/site`, memoised per handle), and routes accordingly (docs/lms/02):

- **course-platform client** (the LMS is their whole product) → rewrites
  `<academy>.acadmyq.com/<path>` → `/learn/<academy>/<path>`, their public course site;
- **management client** (everyone else) → the management app on their own host: `/` renders their
  BRANDED sign-in (their name + logo, resolved server-side) and every other path passes straight
  through to the normal app routes. After signing in they land on `/dashboard` **on their own
  subdomain** — the session cookie is set on `.acadmyq.com`, so nothing bounces to `app.`.

An unknown handle 404s. `www`, `app`, `api`, `admin`, `mail`, `static`, `assets` and `cdn`
are reserved and never treated as academy handles.

A client's own door is theirs alone: the sign-in posts the handle, and the API refuses a user
who belongs to another academy (a platform Super Admin is exempt). `app.acadmyq.com/login` stays
the unbranded platform door for everyone.

⚠️ **Both root-domain vars must be set, or the feature silently no-ops.** The middleware is a
deliberate pass-through when `NEXT_PUBLIC_ROOT_DOMAIN` is empty — so `<academy>.acadmyq.com`
serves the *main app* instead of the course site, with no error anywhere. This bit us on the
2026-07-27 deploy.

| App | Variable | Value | Notes |
|---|---|---|---|
| Web | `NEXT_PUBLIC_ROOT_DOMAIN` | `acadmyq.com` | **Inlined at build time** — set it *before* `pnpm build`, then rebuild |
| API | `LMS_SITE_ROOT_DOMAIN` | `acadmyq.com` | Then `php8.2 artisan config:cache` |

Both default the scheme to `https`; only override (`NEXT_PUBLIC_ROOT_SCHEME` /
`LMS_SITE_SCHEME`) for local http. They are mirrors — set **both or neither**. Left empty, the
API reports the in-app path (`/learn/<subdomain>`), which serves the same site, so the
dashboard's "visit your site" link still works.

One more consequence of the split: for a client who runs the management panel AND sells courses,
`/` on their host is their sign-in, so their course-site link is `https://<sub>.acadmyq.com/learn/<sub>`.
`App\Support\LmsSite::ownsRoot()` is the single place that decides this, and the routing above
reads the same predicate — they cannot disagree.

A client's subdomain is Super-Admin-owned: `PUT /api/admin/lms/academies/{id}/subdomain`
(lowercase alnum + hyphens, ≤63 chars, unique). No per-tenant DNS work — the wildcard covers it.

---

## 10. Custom domains (a client's own address)

A client answering on `portal.theirschool.com` as well as on their handle. Full design in
[`docs/custom-domains/00-SPEC.md`](docs/custom-domains/00-SPEC.md); this is the install.

Certificates are Let's Encrypt on this box — no per-hostname SaaS bill. The trick is that nginx
accepts **variables in `ssl_certificate`**, so one catch-all vhost picks a cert by SNI out of a flat
directory: adding a client domain is two symlinks and **no nginx reload, no generated vhost**.

**The split that matters:** the application only ever marks a domain VERIFIED (it resolves DNS,
which needs no privileges). A **root cron** runs certbot and is the only thing that makes a domain
LIVE. PHP-FPM never needs root.

### Install (once)

```bash
# 1. The DNS-only CNAME target clients may point at (grey cloud — a proxied record breaks ACME).
#    Cloudflare → acadmyq.com → A  connect  169.58.59.194  DNS only

# 2. Scripts
install -m 755 deploy/bin/acadmyq-cert-link.sh   /usr/local/bin/acadmyq-cert-link.sh
install -m 755 deploy/bin/acadmyq-issue-certs.sh /usr/local/bin/acadmyq-issue-certs.sh
install -m 644 deploy/cron/acadmyq-certs         /etc/cron.d/acadmyq-certs

# 3. Cert directory + the fallback the vhost falls back to
mkdir -p /etc/nginx/certs
ln -sfn /etc/letsencrypt/live/acadmyq.com /etc/nginx/certs/_fallback

# 4. The catch-all vhost (it is `default_server`; the named vhosts still win for acadmyq.com)
cp deploy/nginx/custom-domains.conf /etc/nginx/sites-available/custom-domains.conf
ln -sfn /etc/nginx/sites-available/custom-domains.conf /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default        # Debian's default_server would collide
nginx -t && systemctl reload nginx

# 5. Switch it on — API
#    CUSTOM_DOMAINS_ENABLED=true
#    CUSTOM_DOMAINS_ORIGIN_IP=169.58.59.194
#    CUSTOM_DOMAINS_CNAME_TARGET=connect.acadmyq.com
php8.2 artisan config:cache

# 6. Switch it on — Web (INLINED AT BUILD TIME, so rebuild after)
#    NEXT_PUBLIC_CUSTOM_DOMAINS=1
pnpm --filter web build && systemctl restart acadmyq-web
```

⚠️ Do **not** set `CUSTOM_DOMAINS_ENABLED=true` before steps 2–4. A domain can then be marked live
with nowhere to terminate TLS — a client promised an address that cannot work.

### Adding one

Super Admin → Clients → *client* → Settings → **Domains**. The client needs a subdomain handle
first; the custom domain points at it and does not replace it.

Tell the client to create **one DNS-only record**:

| Type | Value |
|---|---|
| A | `169.58.59.194` |
| *or* CNAME | `connect.acadmyq.com` |

Add the domain in the panel **first**, then have them create the record: a host we hold no row for
refuses the TLS handshake outright, whereas one we do serves the fallback (a warning, but it loads).

Then: `domains:verify` runs every 10 minutes and flips it to VERIFIED once DNS points here
(**Check DNS** in the panel does it now), and the cert cron runs every 5 minutes and takes it to
LIVE. Whole thing is usually live within ~15 minutes of the record propagating.

### When it does not work

| Symptom | Cause |
|---|---|
| Stuck on `PENDING_DNS`, error names someone else's IPs | The record is **proxied** (orange cloud / a CDN). ACME cannot reach us. Switch it to DNS-only. |
| Stuck on `VERIFIED` | The cert cron is not installed or not running — `tail /var/log/acadmyq-certs.log` |
| `FAILED` | `last_error` in the panel is certbot's own message. Retried automatically once an hour (the ACME failure budget is 5/hostname/hour). |
| Certificate warning on the client's host | Expected before issuance — it is being served the self-signed `_fallback`. |
| Hard TLS error (not a warning) on the client's host | The host is in no domain row yet, so no certificate exists to offer. Add it in the panel — the cert cron gives it the fallback within 5 minutes. Add the domain **before** the client points DNS to avoid this. |
| Signed in on `app.acadmyq.com` but not on their domain | Correct: one session per origin, they are different sites. |

```bash
tail -f /var/log/acadmyq-certs.log                 # the cert cron
sudo -u acadmyq php8.2 artisan domains:verify -v   # the DNS sweep, by hand
certbot certificates | grep -A3 theirschool        # what was actually issued
```

Custom domains **bypass Cloudflare** (they must, for ACME), so they get no CDN or DDoS shielding and
the origin IP becomes publicly known.
