/**
 * Idempotent DDL for the gateway's own database (local Postgres 16 on the gateway droplet).
 * `gen_random_uuid()` is built into Postgres 13+ — no extension required. Run via `pnpm migrate`.
 *
 *   wa_sessions       — one row per academy session: identity, minted-token hash, lifecycle + creds
 *   wa_signal_keys    — Baileys signal protocol keys (pre-keys, sessions, sender-keys, app-state…)
 *   wa_webhook_outbox — durable retry buffer for webhooks that failed to reach Laravel
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
`
