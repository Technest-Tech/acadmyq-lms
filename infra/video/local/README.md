# Local video stack (Phase 0 · Part A)

A free, local LiveKit media stack to develop and test the AcademIQ video platform against — no Hetzner,
no cost. Brings up **LiveKit SFU + Redis + Egress + MinIO**. Two browser tabs (or two devices on your
WiFi) can hold a 1:1 call; recordings land in local MinIO.

Full context: [`docs/video-platform/02-INFRASTRUCTURE.md`](../../../docs/video-platform/02-INFRASTRUCTURE.md).

> ⚠️ **Dev keys only.** The key/secret here are throwaway. Never reuse them anywhere public.

---

## Prerequisites
- **Docker Desktop** running.
- **LiveKit CLI** for smoke tests: `brew install livekit-cli` (gives the `lk` command).

## 1. Start the stack
```bash
cd infra/video/local
cp .env.example .env          # optional; only needed for the LAN test
docker compose up -d
docker compose ps             # all services "running"; minio-init exits 0 after making the bucket
```
- MinIO console: http://localhost:9001  (login `minioadmin` / `minioadmin`) — you should see a `recordings` bucket.
- LiveKit signaling: `ws://localhost:7880`.

## 2. Smoke test — is the server reachable?
```bash
lk room list \
  --url http://localhost:7880 \
  --api-key devkey \
  --api-secret devsecret_local_only_change_me_0123456789
```
Empty list + no error = the SFU is up.

## 3. Prove media flows (two participants)
In **two terminals**, join the same room publishing a demo track (run `lk room join --help` for the exact
flags in your CLI version):
```bash
lk room join --url ws://localhost:7880 \
  --api-key devkey --api-secret devsecret_local_only_change_me_0123456789 \
  --identity alice --publish-demo test-room

# second terminal: same command with --identity bob
```
Then confirm both are connected:
```bash
lk room participants list --url http://localhost:7880 \
  --api-key devkey --api-secret devsecret_local_only_change_me_0123456789 test-room
```
Two participants = **AC-V0.1** (1:1) proven. Add more identities for **AC-V0.2** (1:3).

## 4. Visual test in a browser (optional)
Browsers block an HTTPS page from connecting to `ws://localhost` (mixed content), so run a LiveKit
example client **locally** (served over `http://localhost`) and point it at `ws://localhost:7880` with a
token from:
```bash
lk token create --api-key devkey --api-secret devsecret_local_only_change_me_0123456789 \
  --join --room test-room --identity alice --valid-for 24h
```
Open it in two tabs (alice / bob) for a real video call. We'll replace this with our own Flutter client in Phase 3.

## 5. Two real devices on your WiFi (optional)
```bash
ipconfig getifaddr en0                 # e.g. 192.168.1.50
echo "LIVEKIT_NODE_IP=192.168.1.50" > .env
docker compose up -d                   # recreate livekit with the LAN IP
```
Point both phones' client at `ws://192.168.1.50:7880`. Still no cloud.

## 6. Stop / reset
```bash
docker compose down          # stop
docker compose down -v       # stop and wipe recordings (MinIO volume)
```

---

## What this can and can't prove
✅ Token minting, 1:1 & 1:3 media, screen share, recording→MinIO→playback (**AC-V0.1 / V0.2 / V0.6**).
❌ Mobile-network reliability, WiFi↔cellular handover, UDP-blocked/TURN-443, MENA latency — those need
the **Hetzner** box (Part B in the infrastructure doc). Don't rent it until the walk-test.

## Troubleshooting
- **Call connects but no audio/video flows:** ICE can't reach the UDP ports. Confirm `--node-ip` matches
  how the client addresses the server (127.0.0.1 for same-machine, LAN IP for phones). On macOS, Docker
  Desktop must allow the published UDP range.
- **`minio-init` keeps restarting:** it's one-shot; it should exit 0 after "recordings bucket ready".
  Re-run `docker compose up -d` if MinIO was slow to start.
- **Egress container unhealthy:** it needs `cap_add: SYS_ADMIN` (already set) for headless Chrome.
- **Port already in use:** something else holds 7880/9000/6379 — stop it or edit the port mappings.
