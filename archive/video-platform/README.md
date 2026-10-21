# Video platform — ARCHIVED (2026-10-20)

The self-hosted LiveKit video classroom ("Meet") is not in use. Its media server
(Contabo Server 2, `169.58.59.255`, `media.acadmyq.com` / `turn.acadmyq.com`) was torn down on
2026-10-20: the Docker stack and systemd units were removed, the two DNS-only Cloudflare records were
deleted, and the LiveKit server vars were dropped from the prod API `.env`.

What lives here:

- [`docs/`](docs/): the original blueprint (architecture, data model, deployment runbook, web/desktop
  clients). Was `docs/video-platform/`.
- [`infra/`](infra/): the local Docker stack (`infra/local`) and the prod provisioner (`infra/prod`).
  Was `infra/video/`.

What was **not** removed:

- The app code (`apps/web` video-classroom + `/r/...` join pages, `apps/api` Video controllers,
  `app/Services/Livekit`, migrations, tests, `apps/desktop`). It is dormant: with no `LIVEKIT_HOST`
  set and video off per academy, nothing calls a media server.
- **`LIVEKIT_S3_*` in the prod `.env`.** Those keys are the R2 store that LMS lesson media uses
  (`config/lms.php` falls back to them while `LMS_S3_*` is unset). Removing them breaks LMS uploads
  and playback.

To bring video back: provision a box from [`infra/prod/`](infra/prod/) by following
[`docs/07-DEPLOYMENT.md`](docs/07-DEPLOYMENT.md), add DNS-only `media`/`turn` A records, and restore
the `LIVEKIT_HOST/API_URL/API_KEY/API_SECRET/WEBHOOK_SECRET/TOKEN_TTL` vars on the API.
