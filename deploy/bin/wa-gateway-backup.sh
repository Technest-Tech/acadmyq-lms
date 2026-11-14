#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# wa-gateway-backup.sh — dump the WhatsApp gateway's own Postgres.
#
# That database IS every client's linked WhatsApp device: the login keys in wa_sessions and
# wa_signal_keys. Lose it and every academy scans a QR again; nothing else on the box matters
# as much. Installed to /usr/local/bin and run hourly by /etc/cron.d/wa-gateway-backup.
#
# Hourly, not daily, because the keys move with every message: the older the dump you restore,
# the more chats start with an "unable to decrypt" before they heal. An hour-old dump restores
# cleanly enough; a week-old one is a last resort.
#
#   Local copies  $WA_BACKUP_DIR (default /var/backups/wa-gateway), root-only.
#                 Every hourly dump for WA_BACKUP_KEEP_HOURS (48), then one a day
#                 for WA_BACKUP_KEEP_DAYS (14).
#   Off the box   Set WA_BACKUP_REMOTE in the gateway env file to an rsync target
#                 (e.g. backup@10.0.0.2:/var/backups/wa-gateway/) and each dump is copied there.
#                 A backup that lives only on this server does not survive losing this server.
#   Encryption    If /etc/wa-gateway/backup.pass exists (chmod 600), dumps are encrypted with it
#                 (AES-256, openssl) before they are stored or copied anywhere. Do this before
#                 sending dumps to a machine you do not fully own: a dump is the keys to every
#                 client's WhatsApp account.
#
# RESTORE (on a gateway whose service is STOPPED):
#     openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/etc/wa-gateway/backup.pass \
#         -in wa_gateway-XXXX.dump.enc -out wa_gateway.dump        # only if encrypted
#     sudo -u postgres dropdb wa_gateway && sudo -u postgres createdb -O wagateway wa_gateway
#     sudo -u postgres pg_restore --no-owner --role=wagateway -d wa_gateway wa_gateway.dump
#     systemctl start wa-gateway
#
# NEVER start a second gateway from a copy of this database while the first still runs. Two
# sockets on the same keys knock each other off (WhatsApp's 440 "replaced") and can end in the
# numbers being logged out. When moving servers: stop the old one, dump, restore, start the new.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
umask 077

ENV_FILE="${ENV_FILE:-/etc/wa-gateway/wa-gateway.env}"
PASS_FILE="${WA_BACKUP_PASSFILE:-/etc/wa-gateway/backup.pass}"

if [ -f "$ENV_FILE" ]; then
  set -a; . "$ENV_FILE"; set +a
fi
: "${DATABASE_URL:?DATABASE_URL is not set (looked in $ENV_FILE)}"

BACKUP_DIR="${WA_BACKUP_DIR:-/var/backups/wa-gateway}"
KEEP_HOURS="${WA_BACKUP_KEEP_HOURS:-48}"
KEEP_DAYS="${WA_BACKUP_KEEP_DAYS:-14}"
REMOTE="${WA_BACKUP_REMOTE:-}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

stamp="$(date -u +%Y%m%d-%H%M)"
tmp="$BACKUP_DIR/.wa_gateway-$stamp.partial"
trap 'rm -f "$tmp" "$tmp.enc"' EXIT

# Custom format: compressed, and pg_restore can pull a single table out of it.
pg_dump --format=custom --no-owner --file="$tmp" "$DATABASE_URL"

# A dump that cannot be read back is not a backup. This also catches a truncated file.
pg_restore --list "$tmp" > /dev/null
if ! pg_restore --list "$tmp" | grep -q 'TABLE DATA .* wa_sessions'; then
  echo "$(date -u +%FT%TZ) backup FAILED: dump has no wa_sessions data" >&2
  exit 1
fi

if [ -f "$PASS_FILE" ]; then
  openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$PASS_FILE" -in "$tmp" -out "$tmp.enc"
  rm -f "$tmp"
  out="$BACKUP_DIR/wa_gateway-$stamp.dump.enc"
  mv "$tmp.enc" "$out"
else
  out="$BACKUP_DIR/wa_gateway-$stamp.dump"
  mv "$tmp" "$out"
fi

# Thin out: past KEEP_HOURS only the first dump of each day stays (the 00:xx one), and nothing
# stays past KEEP_DAYS.
find "$BACKUP_DIR" -maxdepth 1 -name 'wa_gateway-*.dump*' -mmin "+$((KEEP_HOURS * 60))" ! -name 'wa_gateway-*-00[0-9][0-9].dump*' -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'wa_gateway-*.dump*' -mtime "+$KEEP_DAYS" -delete

size="$(du -h "$out" | cut -f1)"
if [ -n "$REMOTE" ]; then
  # --delete mirrors the thinning above, so the remote does not grow for ever.
  if rsync -a --delete --include='wa_gateway-*.dump*' --exclude='*' -e 'ssh -o BatchMode=yes -o ConnectTimeout=20' "$BACKUP_DIR/" "$REMOTE"; then
    echo "$(date -u +%FT%TZ) backup ok: $out ($size), copied to $REMOTE"
  else
    echo "$(date -u +%FT%TZ) backup ok locally: $out ($size) — COPY TO $REMOTE FAILED" >&2
    exit 2
  fi
else
  echo "$(date -u +%FT%TZ) backup ok: $out ($size) — local only, WA_BACKUP_REMOTE is not set"
fi
