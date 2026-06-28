# 02 — Infrastructure & Phase-0 Runbook

The media plane: how we run LiveKit + TURN + Egress + storage. This doc is a **runbook** — follow it
top to bottom. It has two halves:

- **Part A — Local Docker** (start here today, free). Develop the whole product against this.
- **Part B — Hetzner** (later). The public server that proves the *hard* things local cannot.

Read [00-OVERVIEW](00-OVERVIEW.md) and [01-ARCHITECTURE](01-ARCHITECTURE.md) first. This doc fulfils
the Phase-0 scope in [05-ROADMAP](05-ROADMAP.md).

> **Golden rule:** local proves *functionality*; only a public server proves *reliability under real
> mobile conditions* (`AC-V0.3/0.4/0.5`). Don't pay for Hetzner until you reach the walk-test.

---

## 0. What runs where

| Component | Local (Part A) | Hetzner Stage 0 (Part B) | Why |
|---|---|---|---|
| LiveKit SFU | Docker | Docker | The media engine |
| Redis | Docker | Docker | Required for Egress + multi-node coordination |
| Egress (recording) | Docker | Docker | On-demand recording |
| TURN | LiveKit built-in (or skip locally) | LiveKit built-in TURN + TLS | NAT/firewall traversal |
| Object storage | **MinIO** (S3-compatible, Docker) | **Backblaze B2 / Wasabi** | Stores recordings |
| TLS / reverse proxy | not needed | **Caddy** (auto Let's Encrypt) | wss:// + https:// |

The **control plane** (Laravel `apps/api`) and **web panel** (`apps/web`) keep running where they do
today; only the env vars change (`LIVEKIT_HOST`, `LIVEKIT_API_KEY/SECRET`, …) to point at local vs Hetzner.

---

# Part A — Local Docker (do this first)

Goal: a working LiveKit + Egress + storage stack on your machine, so Phases 1–3 can be built and
tested for free. Two browser tabs (or two devices on your WiFi) can hold a 1:1 call.

### A.1 Files

Put these in `infra/video/local/` (new folder; not committed secrets — these are dev-only keys).

**`docker-compose.yml`**
```yaml
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports: ["6379:6379"]

  livekit:
    image: livekit/livekit-server:latest
    restart: unless-stopped
    command: --config /etc/livekit.yaml
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml
    ports:
      - "7880:7880"                     # signaling (HTTP/WS)
      - "7881:7881"                     # RTC over TCP (fallback)
      - "50000-50100:50000-50100/udp"   # RTC media (ICE/UDP)
    depends_on: [redis]

  egress:
    image: livekit/egress:latest
    restart: unless-stopped
    environment:
      EGRESS_CONFIG_FILE: /etc/egress.yaml
    volumes:
      - ./egress.yaml:/etc/egress.yaml
    cap_add: ["SYS_ADMIN"]              # Chrome (room-composite recording) needs this
    depends_on: [redis, livekit]

  minio:                                # local S3-compatible store for recordings
    image: minio/minio:latest
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ["9000:9000", "9001:9001"]   # 9000 API, 9001 web console
    volumes: ["minio-data:/data"]

volumes:
  minio-data:
```

**`livekit.yaml`** (dev keys — fine for local only)
```yaml
port: 7880
log_level: info
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50100
  use_external_ip: false        # localhost / LAN dev
redis:
  address: redis:6379
keys:
  devkey: devsecret_change_me_32chars_min   # api_key: api_secret
# turn: omitted locally — not needed on a trusted LAN. Enabled on Hetzner (Part B).
```

**`egress.yaml`**
```yaml
log_level: info
redis:
  address: redis:6379
api_key: devkey
api_secret: devsecret_change_me_32chars_min
ws_url: ws://livekit:7880
insecure: true                  # local only; never in prod
s3:
  access_key: minioadmin
  secret: minioadmin
  bucket: recordings
  endpoint: http://minio:9000
  force_path_style: true
```

### A.2 Bring it up
```bash
cd infra/video/local
docker compose up -d
# create the recordings bucket in MinIO (console at http://localhost:9001, login minioadmin/minioadmin)
```

### A.3 Smoke-test a call (no app code yet)
Install the LiveKit CLI (`lk`). Mint a token and join:
```bash
# mint a join token for room "test"
lk token create --api-key devkey --api-secret devsecret_change_me_32chars_min \
  --join --room test --identity alice --valid-for 24h

# quick connectivity check
lk room list --url http://localhost:7880 --api-key devkey --api-secret devsecret_change_me_32chars_min
```
For a **visual** check, run the LiveKit example "meet" client locally (or any LiveKit JS sample) pointed
at `ws://localhost:7880`, open it in **two browser tabs** with two identities → you have a 1:1 call.

### A.4 Two real devices on your WiFi (optional, still local)
Set `use_external_ip: false` but start LiveKit with your machine's **LAN IP** as node IP (e.g. add
`--node-ip 192.168.1.50` to the command, and use `ws://192.168.1.50:7880` from the phones on the same
WiFi). This proves device-to-device media without any cloud.

### A.5 What local CAN and CANNOT prove

| ✅ Local proves | ❌ Local CANNOT prove (needs Part B) |
|---|---|
| Token minting + room join works | Real mobile-network behaviour (`AC-V0.3/0.5`) |
| 1:1 and 1:3 media flow | WiFi↔cellular handover recovery (`AC-V0.3`) |
| Screen share | UDP-blocked carrier → TURN/TCP-443 (`AC-V0.4`) |
| On-demand recording → MinIO → playback (`AC-V0.6`) | MENA latency to a real datacenter |
| The whole backend/web/Flutter integration | True NAT traversal across the public internet |

Build everything against Part A. Move to Part B only for the walk-test.

---

# Part B — Hetzner Stage 0 (one public box, for the real-network proof)

Provision **one Hetzner CCX23** (4 dedicated vCPU / 16 GB) — runs LiveKit + built-in TURN + Egress for
the pilot (<50 concurrent). ~€25–30/mo. Use **dedicated** vCPU (CCX line), never shared, for the SFU.

### B.1 Prep
```bash
# on a fresh Ubuntu 24.04 CCX23
apt update && apt -y upgrade
curl -fsSL https://get.docker.com | sh         # Docker + compose plugin
# DNS: point media.example.com (A) and turn.example.com (A) at the box's IPv4
```

### B.2 TLS / reverse proxy (Caddy)
Caddy terminates TLS for signaling and auto-renews Let's Encrypt certs.

**`Caddyfile`**
```
media.example.com {
    reverse_proxy localhost:7880      # LiveKit signaling → wss://media.example.com
}
```
Run Caddy (Docker or apt). After this, clients connect to `wss://media.example.com` on 443.

### B.3 LiveKit config (prod, with built-in TURN + TLS)
**`livekit.yaml`**
```yaml
port: 7880
log_level: info
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true            # public NAT traversal
redis:
  address: redis:6379
keys:
  <GENERATE_API_KEY>: <GENERATE_LONG_SECRET>   # `lk create-token`/openssl; mirror into Laravel env
turn:
  enabled: true
  domain: turn.example.com
  tls_port: 5349                   # TURN/TLS
  udp_port: 3478
  external_tls: true               # Caddy/host provides the cert for turn.example.com
prometheus_port: 6789              # metrics scrape (observability)
webhook:
  api_key: <GENERATE_API_KEY>      # signs webhooks → Laravel /internal/livekit/webhook
```
> **TURN-over-443 nuance (`V-MOB-2`):** built-in TURN/TLS on 5349 + TCP fallback on 7881 covers most
> restrictive networks. For carriers/firewalls that allow **only** 443, add a standalone **coturn** on
> a second public IP listening TLS on 443 (Stage 1). At Stage 0, document any 443-only failure in the
> walk-test rather than over-engineering early.

Egress + Redis + MinIO→(Backblaze) come up the same as Part A, but `egress.yaml` uses `insecure: false`,
`ws_url: wss://media.example.com`, and real **Backblaze B2 / Wasabi** S3 credentials instead of MinIO.

### B.4 Ports & firewall (Hetzner Cloud Firewall + ufw)

| Port | Proto | Purpose | Exposure |
|---|---|---|---|
| 443 | tcp | HTTPS/WSS signaling (Caddy → LiveKit 7880) | public |
| 7881 | tcp | LiveKit RTC over TCP (fallback) | public |
| 50000–60000 | udp | LiveKit RTC media (ICE) | public |
| 3478 | udp/tcp | TURN | public |
| 5349 | tcp | TURN/TLS | public |
| 443 | tcp | *(optional)* standalone coturn TURN/TLS on 2nd IP (Stage 1) | public |
| 22 | tcp | SSH | **your IP only** |
| 6379 | tcp | Redis | **localhost only** (never public) |
| 6789 | tcp | Prometheus metrics | **private / VPN only** |
| 9000/9001 | tcp | MinIO | **local only — not used on Hetzner** (use B2/Wasabi) |

### B.5 Wire the control plane to Hetzner
In `apps/api/.env` (Phase 1):
```
LIVEKIT_HOST=wss://media.example.com
LIVEKIT_API_URL=https://media.example.com
LIVEKIT_API_KEY=<same as livekit.yaml>
LIVEKIT_API_SECRET=<same as livekit.yaml>
LIVEKIT_WEBHOOK_SECRET=<webhook api_key>
LIVEKIT_TOKEN_TTL=14400
```

### B.6 Walk-test (the whole point of Phase 0)
On a **real low-end Android over a mobile network** (`V-MOB-1`):
1. Join a 1:1 and a 1:3 call. (`AC-V0.1/0.2`)
2. Start on WiFi, walk out to cellular mid-call — audio must recover. (`AC-V0.3`)
3. Join from a network with UDP blocked (some corporate/carrier WiFi) — must connect via TURN. (`AC-V0.4`)
4. Throttle bandwidth — video degrades, audio stays clean. (`AC-V0.5`)
5. Record once → lands in B2/Wasabi → plays back. (`AC-V0.6`)
6. Note measured latency from MENA to the box.

Record results in the Phase-0 report (see §E checklist).

---

## C. Staged topology (where this goes after the pilot)

| Stage | Concurrency | Servers | Notes |
|---|---|---|---|
| **0 — pilot** | < ~50 | **1× CCX23** all-in-one (LiveKit + built-in TURN + Egress + Redis) | This doc. Storage = B2/Wasabi. |
| **1 — early prod** | up to few hundred | **1× CCX33** SFU (dedicated vCPU) · **1× CPX41** coturn · **1× CPX41** Egress · managed Redis | Separate coturn enables TURN/443; ≥… |
| **2 — scale** | thousands | LiveKit **cluster** (≥2 SFU + Redis) · Egress **pool** · beefy TURN · autoscaling | Only with real revenue. Add a Gulf region node if latency data demands. |

Redundancy target from Stage 1: **≥2 SFU nodes** so one failure never drops all calls (`AC-V6.1`).

---

## D. Observability (build early — it's how you survive support)

- **Metrics:** LiveKit exposes Prometheus on `prometheus_port`. Scrape with Prometheus → **Grafana**
  dashboards (participants, packet loss, bitrate, node CPU/bandwidth).
- **Alerts:** node down, high packet loss, bandwidth ceiling, Egress failures.
- **Per-call quality:** LiveKit webhooks/analytics → AcademIQ, so when a teacher says "it cut," support
  can *see* the packet loss for that session instead of guessing. (Feeds `AC-V6.2`.)
- **Egress health:** monitor concurrent recordings vs. Egress CPU; each concurrent recording ≈ 1–2 vCPU.

---

## E. Phase-0 exit checklist (maps to roadmap AC-V0.*)

- [ ] `AC-V0.1` 1:1 call works (local first, then Hetzner).
- [ ] `AC-V0.2` 1:3 call works.
- [ ] `AC-V0.3` Audio survives WiFi→cellular handover (Hetzner walk-test).
- [ ] `AC-V0.4` Connects from a UDP-blocked network via TURN/TCP (Hetzner).
- [ ] `AC-V0.5` Under throttling, video degrades but audio stays clean (`V-AUD-1`).
- [ ] `AC-V0.6` On-demand recording lands in storage and plays back.
- [ ] Measured MENA→box latency recorded.
- [ ] Results written into a short Phase-0 report; this doc updated with the exact keys/ports used.

> Local (Part A) clears `AC-V0.1`, `AC-V0.2`, `AC-V0.6`. The rest require Hetzner (Part B). That split
> is exactly why we develop free locally and rent the box only for the walk-test.

---

## F. Cost snapshot (Stage 0)

| Item | Est. monthly |
|---|---|
| Hetzner CCX23 | ~€25–30 |
| Object storage (Backblaze B2, ~first TB) | ~$6/TB stored + cheap egress |
| Bandwidth | ~20 TB **included** with the Hetzner box (≈ thousands of 1:1 lessons) |
| **Total pilot** | **≈ €30–40/mo** |

The 1:1/1:3 nature of the product keeps per-lesson bandwidth at cents — the reason self-hosting is
cheap here where webinars would not be. Recording (Egress CPU + stored bytes) is the cost that grows;
controlled by recording-by-choice (`V-REC-1`) + retention tiers (`V-REC-2`).
