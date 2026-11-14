/**
 * Idempotent DDL for the gateway's own database (local Postgres 16 on the gateway droplet).
 * `gen_random_uuid()` is built into Postgres 13+ — no extension required. Run via `pnpm migrate`.
 *
 *   wa_sessions       — one row per academy session: identity, minted-token hash, lifecycle + creds
 *   wa_signal_keys    — Baileys signal protocol keys (pre-keys, sessions, sender-keys, app-state…)
 *   wa_webhook_outbox — durable retry buffer for webhooks that failed to reach Laravel
 *   wa_send_queue     — the messages waiting to go out, so a restart does not lose them
 *   wa_numbers        — per-number age + today's send count (warm-up and daily cap survive restarts)
 *   wa_proxy_assignments — which proxy each academy dials through (sticky; only with PROXY_URLS)
 */
export const SCHEMA_SQL = `
create table if not exists wa_sessions (
  session_id        uuid primary key default gen_random_uuid(),
  academy_id        uuid not null,
  token_hash        text not null unique,
  phone_jid         text,
  state             text not null default 'qr',
  creds             jsonb,
  last_connected_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists wa_sessions_academy_idx on wa_sessions (academy_id);

create table if not exists wa_signal_keys (
  session_id uuid not null references wa_sessions(session_id) on delete cascade,
  key_type   text not null,
  key_id     text not null,
  key_data   jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (session_id, key_type, key_id)
);
create index if not exists wa_signal_keys_session_idx on wa_signal_keys (session_id);

create table if not exists wa_webhook_outbox (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid,
  event           text not null,
  payload         jsonb not null,
  attempts        int not null default 0,
  last_error      text,
  next_attempt_at timestamptz not null default now(),
  delivered_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists wa_webhook_outbox_pending_idx
  on wa_webhook_outbox (next_attempt_at) where delivered_at is null;

-- Singleton row of live, admin-editable send pacing (anti-ban knobs). Seeded from env on first run.
create table if not exists wa_settings (
  id                     int primary key default 1,
  send_min_interval_ms   int not null,
  send_max_interval_ms   int not null,
  send_daily_cap         int not null,
  warmup_days            int not null,
  warmup_daily_cap       int not null,
  warmup_min_interval_ms int not null,
  warmup_max_interval_ms int not null,
  updated_at             timestamptz not null default now(),
  constraint wa_settings_singleton check (id = 1)
);

-- The send queue's journal: a row from the moment a message is accepted until it is sent or failed.
-- The queue itself runs in memory; this is what it is rebuilt from after a restart.
create table if not exists wa_send_queue (
  message_id  text primary key,
  session_id  uuid not null references wa_sessions(session_id) on delete cascade,
  jid         text not null,
  payload     jsonb not null,
  enqueued_at timestamptz not null default now()
);
create index if not exists wa_send_queue_session_idx on wa_send_queue (session_id, enqueued_at);

-- One row per WhatsApp NUMBER (not per session): a re-scan makes a new session, but the number's age
-- (warm-up) and how much it has sent today must survive both the re-scan and a gateway restart.
create table if not exists wa_numbers (
  phone              text primary key,
  first_connected_at timestamptz not null default now(),
  sent_day           text,
  sent_count         int not null default 0,
  updated_at         timestamptz not null default now()
);

-- Which proxy an ACADEMY dials WhatsApp through (only used when PROXY_URLS is set). Per academy, not
-- per session, so a re-scan keeps the same address. proxy_key is user@host:port — never a password.
create table if not exists wa_proxy_assignments (
  academy_id  uuid primary key,
  proxy_key   text not null,
  assigned_at timestamptz not null default now()
);
`
