# 07 — Production Deployment (Contabo media server)

This is the **production** runbook for the AcademIQ self-hosted video media plane (LiveKit + TURN +
Egress + observability) on a Contabo VPS at **`media.acadmyq.com`**. It is written so a stranger
can redeploy the entire media plane **from zero** using only this file + the committed artifacts in
[`infra/video/prod/`](../../infra/video/prod/).

It is the production counterpart to [02-INFRASTRUCTURE](02-INFRASTRUCTURE.md) (local Docker stack +
Hetzner-flavoured notes). We deploy on **Contabo** (see §2) using the same Docker stack, hardened for
the internet.

> **Reproducibility contract:** every config below lives in `infra/video/prod/` with secrets as
> placeholders. `provision.sh` renders the real configs from a root-only `.env` on the box. Nothing secret
> is ever committed. The deploy is re-runnable from these files, not from memory.

> **Migration history:** originally a DigitalOcean droplet (`159.223.184.102`, NYC, 2 vCPU / 4 GB);
> migrated to **Contabo** on 2026-07-22 (DO credits ran out). Migration recipe: copy the old box's
> `/opt/academiq-video/.env` to the new box (so `LIVEKIT_API_KEY/SECRET` still match the app → **zero app
> change**), set `EXTERNAL_IP` to the new public IP, add **DNS-only** `media`/`turn` records at Cloudflare,
> host-prep + `provision.sh`. Note: after DNS moved to Cloudflare, the `media`/`turn` records had been lost
> (they fell through the proxied wildcard to the app box), so **video was broken until this migration
> re-created them as DNS-only** (§4).

**Live deployment facts (this box):**
- Server: **Contabo Cloud VPS 6**, **169.58.59.255**, Ubuntu 24.04 LTS, **6 vCPU / 12 GB / ~193 GB**, EU (Lauterbourg). Access: `ssh academiq-s2` = `root@169.58.59.255`, key-only (`~/.ssh/contabo_academiq_s2`).
- Domains: `media.acadmyq.com` (WSS via Caddy), `turn.acadmyq.com` (coturn TLS). **DNS on Cloudflare — both DNS-only (grey cloud).**
- Pinned images: livekit-server **v1.13.1**, egress **v1.13.0**, coturn **4.14.0**, caddy **2.11.4**,
  redis **7**, prometheus **v3.12.0**, node-exporter **v1.11.1**, grafana **11.6.16**.

---

## Table of contents
1. [Architecture (cross-provider) & why](#1-architecture-cross-provider--why)
2. [Prerequisites & why each choice](#2-prerequisites--why-each-choice)
3. [Sizing & capacity math](#3-sizing--capacity-math)
4. [DNS records](#4-dns-records)
5. [Step 1 — Access & backup SSH key](#5-step-1--access--backup-ssh-key)
6. [Step 2 — Security hardening](#6-step-2--security-hardening)
7. [Step 3 — Kernel / network tuning](#7-step-3--kernel--network-tuning)
8. [Step 4 — Docker + log rotation](#8-step-4--docker--log-rotation)
9. [Step 5 — Secrets & env file](#9-step-5--secrets--env-file)
10. [Step 6 — The production stack (configs in full)](#10-step-6--the-production-stack-configs-in-full)
11. [Step 7 — Bring up + TLS + boot self-heal](#11-step-7--bring-up--tls--boot-self-heal)
12. [Step 8 — Phase-0 smoke test](#12-step-8--phase-0-smoke-test)
13. [Step 9 — Wire the control plane (Laravel) + webhook](#13-step-9--wire-the-control-plane-laravel--webhook)
14. [Step 10 — Observability](#14-step-10--observability)
15. [Step 11 — Recording → durable object storage](#15-step-11--recording--durable-object-storage)
16. [Step 12 — The real internet call](#16-step-12--the-real-internet-call-success-criterion)
17. [Firewall / ports table](#17-firewall--ports-table)
18. [Decisions log (the WHY)](#18-decisions-log-the-why)
19. [Troubleshooting](#19-troubleshooting)
20. [Rollback / teardown](#20-rollback--teardown)
21. [Cost breakdown](#21-cost-breakdown)
22. [Maintenance](#22-maintenance)
23. [Scale-out path](#23-scale-out-path)
24. [Reproduce from zero — checklist](#24-reproduce-from-zero--checklist)

---

## 1. Architecture (cross-provider) & why

```
   STUDENT / TEACHER browser  ──HTTPS──►  apps/web (Next.js)         ┐
            │                                  │                     │  control plane
            │   mint short-lived JWT  ◄──────  apps/api (Laravel)    │  (Contabo Srv 1)
            │                                  │   ▲ webhook         ┘
            ▼ wss://media.acadmyq.com          │   │
   ┌─────────── MEDIA PLANE — media.acadmyq.com (169.58.59.255) ──┴─────┐
   │  Caddy :443 ──auto-TLS──► LiveKit SFU :7880   coturn :5349/3478     │
   │  Redis(127.0.0.1)   Egress→object store   Prometheus+Grafana+node   │
   └────────────────────────────────────────────────────────────────────┘
```

**The split:** the **control plane** (Laravel `apps/api` + Next.js `apps/web`) runs where the rest of
AcademIQ runs. The **media plane** (this droplet) runs LiveKit + TURN + Egress. They are glued by exactly
two things: **DNS** (`media.acadmyq.com`) and a **shared `LIVEKIT_API_KEY`/`SECRET`**.

**Why separate the media plane:**
- Media is CPU/network-heavy and fails/scales on a different curve than the app. A recording spike or SFU
  crash must never touch billing/login.
- Secrets never leave the media server; the app only **mints short-lived JWTs** signed with the shared
  secret (`V-SEC-1`). The SFU verifies the JWT — no shared DB, no shared session.
- The media plane can later become a *cluster* / move *regions* independently (see §23) with no app change.

---

## 2. Prerequisites & why each choice

| Prereq | Why |
|---|---|
| **Contabo VPS**, Ubuntu 24.04 LTS | The media host. **Why Contabo:** Hetzner banned the account (identity verification) and DigitalOcean got too expensive after the free credits ran out. Contabo is cheap, lenient on signup, and has EU regions. Shared vCPU — fine for the pilot; move to a **Cloud VDS** (dedicated cores) before sustained recording (§3, §18). No cloud firewall (ufw is the only one) and no built-in reserved-IP concept — plan the 443-TURN path accordingly. |
| A **domain with DNS you control** (`acadmyq.com`, DNS on **Cloudflare**) | Caddy needs the `media` A-record live **and DNS-only (grey)** to issue Let's Encrypt TLS via HTTP-01; coturn needs `turn` for its cert. |
| An **S3-compatible bucket** (Backblaze B2 / Wasabi / DO Spaces) | Durable recording storage (§15). Not needed until recording is enabled. |
| **LiveKit CLI** (`lk`) | Smoke tests + token minting. `curl -sSL https://get.livekit.io/cli | bash`. |
| The **Mac SSH key** `~/.ssh/id_ed25519` (+ backup `~/.ssh/academiq_video`) | Admin access; key-only after hardening. |

---

## 3. Sizing & capacity math

**This box:** 4 vCPU / 8 GB / 154 GB, Regular (shared) Intel, NYC1, + 2 GB swap.

**How an SFU scales:** an SFU **forwards** packets; it does not transcode. CPU per participant is small —
the binding constraints are **bandwidth** and (for recording) **egress CPU**, not SFU CPU.

| Workload | Per-participant | 4 vCPU / 8 GB headroom (rough) |
|---|---|---|
| Audio-only 1:1 (opus, DTX) | ~40–60 kbps each way | 100s of concurrent participants |
| Audio-first with video (simulcast, ~0.3–0.6 Mbps) | a few Mbps per small room | dozens of concurrent small rooms |
| **Room-composite recording (Egress)** | **~1–2 vCPU + ~1.5 GB each** | **1–2 concurrent recordings before it starves the SFU** |

**The recording caveat is the real limit.** One headless-Chrome recording can eat half this box. Recording
is therefore **gated behind a compose profile** (off by default), and the scale path is a **separate Egress
node** (§23). For sustained recording at scale, move to **CPU-Optimized (dedicated vCPU)** — shared vCPU
has CPU-steal/jitter that hurts real-time media.

**Bandwidth:** DO droplets include a monthly transfer allowance (TB-scale, pooled); overage ~$0.01/GB.
1:1/1:N lessons are cheap (cents). Egress to object storage is the cost that grows (§21).

**Resize path:** DO → Droplet → **Resize**. "CPU + RAM only" (disk preserved) needs a brief power-off
(~1–2 min). All host config (sysctl, swap, Docker, /opt/academiq-video) survives a resize. To move to
**dedicated** CPU, resize to a **CPU-Optimized** plan (e.g. `c-4`).

**Region note:** NYC1 is ~150 ms from MENA. DO **FRA1 (Frankfurt)** would be ~60–90 ms — better for
real-time audio. You cannot change a droplet's region by resizing; you snapshot → create a new droplet in
FRA1 → re-point DNS. Documented as a decision (§18); for the proof, NYC1 is fine.

---

## 4. DNS records

On Cloudflare → `acadmyq.com` → DNS. **Both must be DNS-only (grey cloud), NOT proxied:**

| Type | Hostname | Value | Proxy | TTL |
|---|---|---|---|---|
| A | `media` | `169.58.59.255` | **DNS-only (grey)** | Auto |
| A | `turn`  | `169.58.59.255` | **DNS-only (grey)** | Auto |

⚠️ These are **explicit overrides** of the proxied wildcard `*.acadmyq.com` (which points at the app
box, Server 1). They MUST be **grey-cloud**: Cloudflare's proxy can't carry WebRTC/UDP media, and Caddy's
ACME HTTP-01/TLS-ALPN needs a direct connection to the origin. A proxied `media`/`turn` = **broken video**
(and no cert). This is exactly the bug that took video down when DNS first moved to Cloudflare.

Add these **before** bringing up the stack — Caddy's Let's Encrypt issuance fails until `media` (and
`turn`) resolve to this box. Verify: `dig +short media.acadmyq.com @1.1.1.1` → `169.58.59.255`.

---

## 5. Step 1 — Access & backup SSH key

```bash
# from the Mac (key-only; alias in ~/.ssh/config)
ssh academiq-s2        # = root@169.58.59.255, identity ~/.ssh/contabo_academiq_s2
```

**Add a second (backup) key immediately** so a botched SSH change can never lock you out:

```bash
# on the box — append the backup public key, dedup-safe
KEY="ssh-ed25519 AAAA... academiq-video"
grep -qF "$KEY" ~/.ssh/authorized_keys || printf '%s\n' "$KEY" >> ~/.ssh/authorized_keys
```

Verify the backup key authenticates from the Mac **before** hardening:
`ssh -i ~/.ssh/academiq_video -o IdentitiesOnly=yes root@169.58.59.255 'echo ok'`.

**Add 2 GB swap** (the box ships with none; one memory spike → OOM kill without it):
```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
grep -qF /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

---

## 6. Step 2 — Security hardening

> **⚠️ Contabo apt gotcha — do this FIRST, before any `apt` command:** the default
> `archive.ubuntu.com` (and `mirror.contabo.net`) are **unreachable** from the Lauterbourg boxes, so
> `apt` hangs forever mid-install. Repoint apt at a working mirror + force IPv4:
> ```bash
> sed -i 's|http://archive.ubuntu.com/ubuntu|http://de.archive.ubuntu.com/ubuntu|g; \
>         s|http://security.ubuntu.com/ubuntu|http://de.archive.ubuntu.com/ubuntu|g' \
>   /etc/apt/sources.list.d/ubuntu.sources
> printf 'Acquire::ForceIPv4 "true";\n' > /etc/apt/apt.conf.d/99force-ipv4
> apt-get update
> ```

```bash
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
apt-get update -q && apt-get -y upgrade
apt-get -y install fail2ban
```

**Unattended security upgrades** — `/etc/apt/apt.conf.d/20auto-upgrades`:
```
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
```

**fail2ban** — `/etc/fail2ban/jail.d/sshd.local`:
```
[sshd]
enabled = true
mode = aggressive
maxretry = 5
findtime = 10m
bantime = 1h
```
`systemctl enable --now fail2ban`.

**ufw — allow SSH *before* enabling** (else you cut yourself off):
```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp           comment 'SSH'
ufw allow 80/tcp           comment 'HTTP ACME+redirect'
ufw allow 443/tcp          comment 'HTTPS/WSS Caddy'
ufw allow 7881/tcp         comment 'LiveKit ICE-TCP'
ufw allow 50000:60000/udp  comment 'LiveKit RTC media'
ufw allow 3478             comment 'coturn STUN/TURN'
ufw allow 5349             comment 'coturn TURN/TLS+DTLS'
ufw allow 49160:49200/udp  comment 'coturn relay'
ufw --force enable
```

**SSH key-only** — drop-in `/etc/ssh/sshd_config.d/00-academiq-hardening.conf` (the `00-` prefix wins,
since sshd uses the *first* value found):
```
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
PermitEmptyPasswords no
MaxAuthTries 4
X11Forwarding no
```
Validate and confirm the **effective** config *before* restarting:
```bash
sshd -t && sshd -T | grep -iE 'passwordauthentication|permitrootlogin'
systemctl restart ssh
```
Then verify from a **fresh** terminal that both keys work and password auth is refused
(`ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no root@HOST` → `Permission denied (publickey)`).

> SSH is allowed from anywhere (key-only + fail2ban). To tighten further, restrict 22 to a static admin
> IP/VPN once you have one (`ufw allow from <IP> to any port 22`).

---

## 7. Step 3 — Kernel / network tuning

WebRTC pushes a lot of small UDP packets; Pion (LiveKit's WebRTC stack) **drops packets and warns** if the
UDP socket buffers are too small. Install [`infra/video/prod/sysctl/99-livekit.conf`](../../infra/video/prod/sysctl/99-livekit.conf)
as `/etc/sysctl.d/99-livekit.conf` and `sysctl --system`. Key values:

| sysctl | Value | Why |
|---|---|---|
| `net.core.rmem_max` / `wmem_max` | 26214400 (25 MB) | UDP socket buffers for media bursts |
| `net.core.somaxconn` | 65535 | accept backlog |
| `net.ipv4.udp_mem` | 65536 131072 262144 | UDP memory pool |
| `fs.file-max` / `fs.nr_open` | 2097152 | many concurrent sockets |
| `net.netfilter.nf_conntrack_max` | 1048576 | many concurrent UDP media flows |
| `vm.swappiness` | 10 | prefer RAM over the 2 GB swap |

Also raise open-file limits — [`infra/video/prod/limits/99-academiq-nofile.conf`](../../infra/video/prod/limits/99-academiq-nofile.conf)
→ `/etc/security/limits.d/` (`nofile 1048576`), and `echo nf_conntrack > /etc/modules-load.d/academiq-conntrack.conf`
so `nf_conntrack_max` is settable at boot. Containers also get explicit `ulimits: nofile` in compose.

---

## 8. Step 4 — Docker + log rotation

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable docker
```

`/etc/docker/daemon.json` — bounded logs so the disk never fills + survive a daemon restart:
```json
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" }, "live-restore": true }
```
`systemctl restart docker`. Every container uses `restart: unless-stopped`.

---

## 9. Step 5 — Secrets & env file

Secrets live **only** in `/opt/academiq-video/.env` (`chmod 600 root:root`), never in the repo.
`provision.sh` generates strong values on first run. The variable contract is
[`infra/video/prod/.env.example`](../../infra/video/prod/.env.example).

| Var | Generated by | Also lives in |
|---|---|---|
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | `openssl` (provision.sh) | **Laravel `apps/api` env** (mirror exactly) |
| `LIVEKIT_WEBHOOK_API_KEY` / `_SECRET` | = the API key/secret | Laravel `LIVEKIT_WEBHOOK_SECRET` |
| `REDIS_PASSWORD` | `openssl` | rendered livekit.yaml + egress.yaml |
| `TURN_STATIC_AUTH_SECRET` | `openssl` | rendered livekit.yaml (`turn_servers.secret`) + coturn |
| `GRAFANA_ADMIN_PASSWORD` | `openssl` | Grafana login |
| `REC_S3_*` | **you** (storage provider) | rendered egress.yaml |
| `DOMAIN_MEDIA` / `DOMAIN_TURN` / `EXTERNAL_IP` / `ACME_EMAIL` / `WEBHOOK_URL` | set in .env | various |

Read them back any time (root): `grep LIVEKIT_API /opt/academiq-video/.env`.

---

## 10. Step 6 — The production stack (configs in full)

All artifacts are in [`infra/video/prod/`](../../infra/video/prod/). The secret-bearing ones are
**templates** (`*.template`) rendered by `provision.sh` via `envsubst`. Highlights:

- **`docker-compose.yml`** — the stack. **Media services run on the HOST network** (LiveKit's recommended
  Docker model): this avoids publishing a 10 000-port UDP range through docker-proxy and keeps ICE
  candidates correct. Internal ports (7880, 6789, 6379, 9090/9100/3000) are not in the ufw allow-list, so
  they're unreachable from the internet; several also bind `127.0.0.1`.
- **`config/livekit.yaml.template`** — `use_external_ip: true`, redis (password), the API key, a
  `turn_servers` entry pointing at coturn with the shared `secret` (LiveKit mints short-lived TURN REST
  creds from it), `prometheus_port: 6789`, and the `webhook` block.
- **`Caddyfile`** — auto-HTTPS for `media.acadmyq.com` → `127.0.0.1:7880`, plus a `turn.acadmyq.com` block
  so Caddy **also issues the TURN cert** (reused by coturn).
- **`coturn/turnserver.conf.template`** — standalone coturn: realm, `use-auth-secret` +
  `static-auth-secret`, `relay-ip`/`external-ip`, relay port range, TLS on 5349, hardening
  (deny private ranges, `no-cli`, `no-tcp-relay`). ⚠️ **coturn has no inline comments** — keep `#` on its
  own lines (see §19).
- **`config/egress.yaml.template`** — recording → S3-compatible storage (compose profile `recording`).
- **`prometheus/`**, **`grafana/`** — scrape config + alert rules + datasource/dashboard provisioning.
- **`systemd/academiq-video.service`** — brings the stack up on boot.
- **`provision.sh`** — the idempotent end-to-end provisioner.

---

## 11. Step 7 — Bring up + TLS + boot self-heal

> **The media box needs NO repo access.** It is never a git checkout and holds no GitHub credentials —
> smaller attack surface. The repo is the source of truth on *your* machine; you **push** the artifacts to
> the box (tar-over-SSH / rsync / scp) and run `provision.sh` there. To update later: edit locally →
> re-push → `./provision.sh` (idempotent). This is why `/opt/academiq-video` is a plain copy, not a clone.

```bash
# upload the artifacts to the box (COPYFILE_DISABLE avoids macOS AppleDouble junk)
cd infra/video/prod
COPYFILE_DISABLE=1 tar czf - . | ssh root@169.58.59.255 \
  'mkdir -p /opt/academiq-video && tar xzf - -C /opt/academiq-video && chown -R root:root /opt/academiq-video'

# provision (generates .env + secrets, renders configs, pulls pinned images, brings up the stack,
# waits for the TURN cert, syncs it into coturn, starts coturn)
ssh root@169.58.59.255 'cd /opt/academiq-video && ./provision.sh'

# enable boot self-heal + weekly TURN-cert sync
ssh root@169.58.59.255 'cd /opt/academiq-video &&
  cp systemd/academiq-video.service systemd/academiq-coturn-certs.{service,timer} /etc/systemd/system/ &&
  systemctl daemon-reload &&
  systemctl enable academiq-video.service &&
  systemctl enable --now academiq-coturn-certs.timer'
```

**Verify TLS:**
```bash
curl https://media.acadmyq.com/                       # → OK   (LiveKit health via Caddy)
echo | openssl s_client -connect turn.acadmyq.com:5349 -servername turn.acadmyq.com 2>/dev/null \
  | openssl x509 -noout -subject -dates                # → CN = turn.acadmyq.com, Let's Encrypt
```

**Reboot self-heal test (must recover with zero manual steps):**
```bash
ssh root@169.58.59.255 systemctl reboot
# wait ~40s, reconnect:
ssh root@169.58.59.255 'cd /opt/academiq-video && docker compose ps'   # all Up; curl https still OK
```

> **coturn cert renewal:** Caddy renews ~30 days before expiry; the weekly
> `academiq-coturn-certs.timer` re-copies the renewed cert into coturn and restarts it.

---

## 12. Step 8 — Phase-0 smoke test

```bash
cd /opt/academiq-video && set -a && . ./.env && set +a
lk room list   --url https://media.acadmyq.com --api-key "$LIVEKIT_API_KEY" --api-secret "$LIVEKIT_API_SECRET"
lk room create --url https://media.acadmyq.com --api-key "$LIVEKIT_API_KEY" --api-secret "$LIVEKIT_API_SECRET" smoke-test-room
lk token create --api-key "$LIVEKIT_API_KEY" --api-secret "$LIVEKIT_API_SECRET" --join --room smoke-test-room --identity alice --valid-for 1h
```
A clean `room list` (no error) + a created room proves **TLS + API auth over the public internet**.
✅ Verified on this box (smoke-test-room `RM_eReBbBMhQnTv`, opus codec).

---

## 13. Step 9 — Wire the control plane (Laravel) + webhook

Set these in the **production `apps/api` env** (mirror from `/opt/academiq-video/.env`):
```
LIVEKIT_HOST=wss://media.acadmyq.com
LIVEKIT_API_URL=https://media.acadmyq.com
LIVEKIT_API_KEY=<LIVEKIT_API_KEY>
LIVEKIT_API_SECRET=<LIVEKIT_API_SECRET>
LIVEKIT_WEBHOOK_SECRET=<LIVEKIT_API_SECRET>
LIVEKIT_TOKEN_TTL=900
```
The LiveKit `webhook.urls` already points at `WEBHOOK_URL`
(`https://api.acadmyq.com/api/internal/livekit/webhook` — note the `/api` prefix; verified via prod
`route:list`).

> ✅ **DONE (2026-06-27; control plane MIGRATED 2026-07-22).** The control plane runs where the rest of
> AcademIQ runs — now **Contabo Server 1** `169.58.59.194` (`api.acadmyq.com` via the proxied Cloudflare
> wildcard; self-hosted nginx + PHP 8.2-FPM + Postgres 16, app dir `/var/www/acadmyq`, branch deploys via
> `deploy/deploy.sh` — see the root `DEPLOYMENT.md`). It was originally the DO droplet `159.89.89.241`; the
> `LIVEKIT_*` wiring below is **unchanged** by the move (the keys carried over verbatim). Original steps:
> 1. Pushed `feat/video-platform` to `origin` (the video backend wasn't deployed before — prod ran
>    `feat/whatsapp-gateway`).
> 2. **Backed up** the prod DB (`pg_dump -Fc`) + `apps/api/.env` to `/root/backups/` first.
> 3. Appended the `LIVEKIT_*` block to `/var/www/acadmyq/apps/api/.env` (WhatsApp `WA_*`/`WASENDER_*`
>    env left untouched — that gateway was already live).
> 4. `sudo -u acadmyq APP_BRANCH=feat/video-platform deploy/deploy.sh` → built web, `config/route:cache`,
>    ran the two video migrations, restarted php-fpm/web/queue.
> 5. Verified: `/api/health` ok, all `api/video/*` routes registered, `media.acadmyq.com` baked into the
>    cached config, a bogus join token returns 404 (stack loads, no 500).

---

## 14. Step 10 — Observability

- **Prometheus** (`127.0.0.1:9090`) scrapes LiveKit metrics (`:6789`), node-exporter (`:9100`), itself.
- **Grafana** (`127.0.0.1:3000`, localhost-only) — datasource + a starter "AcademIQ Media — Overview"
  dashboard auto-provisioned (CPU, mem/swap, network, disk, LiveKit/node up). Reach it via SSH tunnel:
  `ssh -L 3000:127.0.0.1:3000 root@169.58.59.255` → http://localhost:3000 (admin / `GRAFANA_ADMIN_PASSWORD`).
- **Alert rules** (`prometheus/alerts.yml`): NodeExporterDown, LiveKitDown, HighCPU, HighMemory, LowDisk,
  SwapHeavilyUsed. To **deliver** alerts, add an Alertmanager target in `prometheus.yml` (email/Slack).
- TODO: packet-loss + cert-expiry alerts (need LiveKit metric-name confirmation + a blackbox/x509 exporter).
- Rich community dashboards: import **Node Exporter Full (1860)** + the official LiveKit dashboard in the UI.

---

## 15. Step 11 — Recording → durable object storage

Egress is gated behind the `recording` compose profile (it needs S3 storage + ~1–2 vCPU/recording).
1. Create an S3-compatible bucket; get an access key/secret + endpoint + region.
2. Fill `REC_S3_*` in `/opt/academiq-video/.env`; re-render: `./provision.sh` (idempotent).
3. Start it: `docker compose --profile recording up -d`.
4. **Retention/lifecycle:** the app purges old recordings (`LIVEKIT_RECORDING_RETENTION_DAYS`, default 90,
   via `PurgeExpiredRecordingsJob`, `V-REC-2`). Optionally also add a bucket lifecycle rule as a backstop.

> ✅ **DONE (2026-06-27) — Cloudflare R2.** Bucket `acadmyq-meet`, endpoint
> `https://<account>.r2.cloudflarestorage.com`, `region=auto`, `force_path_style=true`. Chosen for the
> **10 GB free tier + $0 egress** (recordings get downloaded; R2 never bills egress). Validated R2
> read/write/delete with `mc` before starting egress; egress connected to Redis and reports **service ready**.
>
> ⚠️ **Gotcha:** `livekit/egress` runs as **non-root (uid 1001)**, unlike livekit/coturn (root). The
> rendered `config/egress.yaml` must be readable by that uid — `provision.sh` sets it `chmod 640` +
> `chown 1001:root` (a `chmod 600 root` config makes egress crash-loop with `permission denied`).

---

## 16. Step 12 — The real internet call (success criterion)

> **Note:** the proof below was measured on **2026-06-27 on the original DO box (`159.223.184.102`)**.
> The current media box is Contabo **`169.58.59.255`** — on the 2026-07-22 migration the `lk` smoke test
> (room list/create over `https://media.acadmyq.com`), coturn TLS (5349), and the webhook path were
> re-verified; re-run the full two-browser call there to re-confirm end-to-end media.

✅ **PROVEN (2026-06-27).** Two browsers joined the same room via the web client (`apps/web`
`/r/{token}`) and exchanged **real two-way audio + video** through the production SFU over the internet.

**Setup used for the proof** (control plane stays where it runs today — here, locally — only the media
plane is the prod box):
1. Point the running `apps/api` at prod media: in `apps/api/.env` set `LIVEKIT_HOST=wss://media.acadmyq.com`,
   `LIVEKIT_API_URL=https://media.acadmyq.com`, and the prod `LIVEKIT_API_KEY/SECRET`; `php artisan config:clear`.
2. Confirm the public join endpoint mints a prod token:
   `curl -X POST http://localhost:8000/api/video/join/<join_token> -d '{"display_name":"Test"}'`
   → `{ "url": "wss://media.acadmyq.com", "role": "guest", ... }`.
3. Open `http://localhost:3000/r/<join_token>` in **two browsers**, enter a name, Join. (A phone on
   cellular + a laptop is the strongest two-location variant — both hit `wss://media.acadmyq.com`.)

**Measured result** (RTCStats read from both browsers):

| Participant | Inbound (receives other) | Outbound (publishes) | ICE selected remote |
|---|---|---|---|
| Alice | audio ✓, video ✓ | audio + video (1.37 MB) | **159.223.184.102** (host/UDP) |
| Bob | audio ✓, video ✓ | audio + video | **159.223.184.102** (host/UDP) |

- **Two-way audio + video confirmed** between two browsers over the public internet.
- The selected ICE candidate's **remote address is the prod box (159.223.184.102)** — the media really
  traverses the self-hosted SFU. Direct `host`/UDP candidate (clean NAT traversal); coturn is the
  configured fallback for UDP-blocked networks (TLS endpoint verified separately, §11).

> Because the join page runs on `localhost` (a secure context) and connects to `wss://` (secure), there's
> no mixed-content/secure-context issue — camera/mic work and the SFU connects. For a phone over the LAN
> IP you'd need HTTPS on the page too (§19); the prod-deployed app serves it over HTTPS natively.

---

## 17. Firewall / ports table

| Port | Proto | Purpose | Exposure |
|---|---|---|---|
| 22 | tcp | SSH | public (key-only + fail2ban; tighten to admin IP later) |
| 80 | tcp | HTTP — ACME challenge + HTTPS redirect | public |
| 443 | tcp | HTTPS/WSS signaling (Caddy → LiveKit 7880) | public |
| 7881 | tcp | LiveKit ICE/TCP fallback | public |
| 50000–60000 | udp | LiveKit RTC media (ICE) | public |
| 3478 | udp/tcp | coturn STUN/TURN | public |
| 5349 | tcp/udp | coturn TURN/TLS (+DTLS) | public |
| 49160–49200 | udp | coturn relay range | public |
| 7880 | tcp | LiveKit signaling (behind Caddy) | **internal** (ufw-blocked) |
| 6789 | tcp | LiveKit Prometheus metrics | **internal** (ufw-blocked) |
| 6379 | tcp | Redis | **localhost-only** |
| 9090 / 9100 / 3000 | tcp | Prometheus / node-exporter / Grafana | **localhost-only** (SSH tunnel) |

---

## 18. Decisions log (the WHY)

- **Provider = Contabo** (since 2026-07-22). Hetzner banned the account; DigitalOcean got too expensive
  after the free credits ran out. Contabo is cheap and lenient on signup — trade-offs: shared vCPU (move to
  a **Cloud VDS** for dedicated cores before heavy recording), **no cloud firewall** (ufw is the only one),
  and **no reserved-IP** concept (rethink the future 443-TURN path). *(Originally DigitalOcean, chosen
  because Hetzner verification failed; DO had simple DNS/API, snapshots, and reserved IPs.)*
- **Size = 4 vCPU / 8 GB Regular** for the proof + pilot. Dedicated (CPU-Optimized) recommended before
  sustained recording at scale (CPU-steal hurts real-time media). Resize is a quick power-off (§3).
- **Region = NYC1** (the box exists). FRA1 recommended for a MENA-serving production node (snapshot+migrate).
- **TURN = standalone coturn** (not LiveKit's built-in) per requirement — full config (realm,
  static-auth-secret, relay range, TLS). LiveKit integrates via `rtc.turn_servers.secret` (shares the
  coturn `static-auth-secret`; LiveKit mints short-lived REST creds).
- **TURN TLS on 5349** (looks like HTTPS to DPI) + LiveKit ICE/TCP on 7881 covers most restrictive
  networks. **True 443-only TURN** needs a second IP (Caddy owns 443) — planned as a DO **Reserved IP**
  bound to coturn:443 (documented, ready to flip; not built yet).
- **Host networking** for media containers — avoids a 10 000-port docker-proxy explosion and keeps ICE
  correct. Internal ports protected by ufw default-deny + localhost binds.
- **Caddy issues the TURN cert too**, synced to coturn at a stable CA-agnostic path — one ACME story,
  auto-renew, no second ACME client.
- **Pinned image versions** (no `:latest`) — the local stack's stale `:latest` (v1.9.9) caused client-skew;
  prod pins v1.13.1.
- **Recording behind a compose profile** — off by default so it never starves the SFU before a separate
  Egress node exists.
- **Secrets via templates + envsubst** — one source of truth (committed templates), real values rendered
  from a root-only `.env`, nothing secret committed.

---

## 19. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| **coturn restart-loops, "Invalid port value: 3478 # ..."** | coturn has **no inline comments** — a `# comment` after a value is parsed as the value. Put comments on their own lines. |
| **TLS not issuing** (Caddy keeps retrying) | `media`/`turn` A-records not live yet, or port 80/443 blocked. Check `dig +short media.acadmyq.com`, ufw allows 80+443, and `docker logs academiq-video-caddy-1`. LE has rate limits — fix the cause before hammering. |
| **`curl https://media...` hangs / refused** | Caddy not up, or DO has an external cloud firewall. Check `docker compose ps caddy` + ufw. |
| **Call connects but no media** | UDP not reaching the box: confirm ufw opens 50000–60000/udp, `use_external_ip: true`, and the client isn't on a UDP-blocked network (then TURN must engage). |
| **UDP-blocked network can't connect** | Verify coturn TLS on 5349 (`openssl s_client -connect turn.acadmyq.com:5349`) and that LiveKit `turn_servers.secret` matches coturn `static-auth-secret`. |
| **Mixed content** (HTTPS page, `ws://` SFU) | The page is HTTPS so the SFU must be `wss://` — always use `wss://media.acadmyq.com` (never `ws://`) from the browser. |
| **SSH lockout risk** | A second key is installed (§5); recover via the DO web **Console** (Droplet → Access). Never disable password auth until both keys are verified. |
| **High CPU / jitter** | Likely a recording (or shared-vCPU steal). Move egress to its own node / resize to dedicated CPU. Watch Grafana. |

---

## 20. Rollback / teardown

```bash
cd /opt/academiq-video
docker compose down                 # stop the stack (keeps volumes + certs)
docker compose down -v              # also wipe prometheus/grafana volumes
systemctl disable --now academiq-video.service academiq-coturn-certs.timer
```
Full teardown: the above, then `rm -rf /opt/academiq-video` and delete the droplet + DNS records.
Recordings in object storage are independent and survive a teardown.

---

## 21. Cost breakdown (pilot)

| Item | Est. monthly |
|---|---|
| DO droplet 4 vCPU / 8 GB (Regular) | ~$48 |
| (alt) CPU-Optimized 4 vCPU / 8 GB for heavy recording | ~$84 |
| Object storage (B2 ~$6/TB stored; Spaces $5/250 GB) | a few $ |
| Bandwidth | mostly within the droplet allowance for 1:1/1:N |
| **Total pilot** | **~$50–60/mo** |

---

## 22. Maintenance

- **Bump LiveKit (or any image):** edit the pinned tag in `infra/video/prod/docker-compose.yml`, re-upload,
  `docker compose pull <svc> && docker compose up -d <svc>`. Bump server+egress together.
- **Rotate secrets:** edit `/opt/academiq-video/.env`, `./provision.sh` to re-render, `docker compose up -d
  --force-recreate`, and **mirror the new `LIVEKIT_API_KEY/SECRET` into Laravel**.
- **Certs:** auto — Caddy renews; the weekly timer syncs the TURN cert into coturn. Nothing manual.
- **Backups/DR:** schedule **DO snapshots** (weekly) of the droplet; recordings are already durable in
  object storage. Rebuild = new droplet + this runbook + restore `.env` (or re-provision fresh secrets).
- **OS:** unattended security upgrades are on; reboot occasionally for kernel updates (self-heals).

---

## 23. Scale-out path

| Stage | Concurrency | Topology |
|---|---|---|
| **0 — now** | < ~50 | this single box (LiveKit + coturn + Egress profile + Redis + observability) |
| **1 — early prod** | hundreds | dedicated-CPU SFU · **separate coturn** (enables TURN/443 on its own IP) · **separate Egress** node · managed Redis |
| **2 — scale** | thousands | LiveKit **cluster** (≥2 SFU + shared Redis) behind a load balancer · Egress **pool** · regional node (e.g. FRA1) for MENA |

Redundancy target from Stage 1: **≥2 SFU nodes** so one failure never drops all calls. Multi-node LiveKit
just needs all nodes on the **same Redis** + the same keys; clients are routed by the LiveKit signaling.

---

## 24. Reproduce from zero — checklist

- [ ] Create Ubuntu 24.04 droplet; add `media`/`turn` A-records (§4); `dig` confirms.
- [ ] SSH in; add backup key; add 2 GB swap (§5).
- [ ] Harden: upgrade, fail2ban, unattended-upgrades, ufw (SSH first!), SSH key-only (§6).
- [ ] sysctl + nofile tuning (§7).
- [ ] Install Docker + `daemon.json` log rotation (§8).
- [ ] Upload `infra/video/prod/` → `/opt/academiq-video`; `./provision.sh` (generates secrets, TLS,
      brings up the stack) (§11).
- [ ] Enable `academiq-video.service` + `academiq-coturn-certs.timer`; **reboot test** = self-heals (§11).
- [ ] `curl https://media.acadmyq.com` → OK; coturn TLS on 5349 valid (§11).
- [ ] Phase-0 smoke test: `lk room list/create` over HTTPS (§12).
- [ ] Mirror `LIVEKIT_*` into Laravel; confirm webhook (§13).
- [ ] (when needed) configure `REC_S3_*` + `--profile recording up -d` + lifecycle (§15).
- [ ] Real 2-browser call over the internet via `/r/{token}` (§16).
