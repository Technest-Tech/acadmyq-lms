# Production media stack — `infra/video/prod/`

The **production**, internet-facing LiveKit media plane for the AcademIQ video platform, running on a
DigitalOcean droplet (`media.acadmyq.com`). This is the hardened sibling of the dev-only
[`../local/`](../local/) stack — it adds TLS, a real standalone TURN, durable object storage, secrets,
observability, and boot-time self-healing.

> **Full runbook:** [`docs/video-platform/07-DEPLOYMENT.md`](../../../docs/video-platform/07-DEPLOYMENT.md).
> Read it before touching anything — it is written so a stranger can redeploy from zero.

> ⚠️ **No secrets in this folder.** Configs read from a root-only `/opt/academiq-video/.env` (chmod 600,
> never committed). See [`.env.example`](.env.example) for the variable contract.

---

## What's here (reproducible artifacts)

| File | Purpose |
|---|---|
| `.env.example` | The env-var contract (placeholders). Copy → `.env` on the box, fill real values. |
| `docker-compose.yml` | The stack: LiveKit · Redis · Egress · Caddy · coturn · Prometheus · Grafana · node_exporter. |
| `livekit.yaml` | LiveKit SFU prod config (`use_external_ip`, redis, keys, turn_servers, prometheus, webhook). |
| `egress.yaml` | Recording → S3-compatible object storage. |
| `Caddyfile` | Auto-HTTPS (Let's Encrypt) reverse proxy for `media.acadmyq.com` → LiveKit 7880. |
| `coturn/turnserver.conf` | Standalone coturn (realm, static-auth-secret, relay range, TLS). |
| `sysctl/99-livekit.conf` | Kernel/network tuning (UDP buffers, somaxconn) → `/etc/sysctl.d/`. |
| `systemd/academiq-video.service` | Brings the whole stack up on boot; auto-restart. |
| `prometheus/prometheus.yml` | Scrape config (LiveKit metrics + node_exporter). |
| `prometheus/alerts.yml` | Alert rules (node down, high CPU, packet loss, disk, cert expiry). |
| `grafana/` | Datasource + dashboard provisioning. |
| `provision.sh` | **Idempotent** end-to-end provisioner — re-runnable from these files, not memory. |

## One-command (re)deploy

```bash
# on the droplet, as root, with /opt/academiq-video/.env populated:
cd /opt/academiq-video && ./provision.sh
```

See the deployment doc's **"Reproduce from zero"** checklist for the full path from a blank droplet.
