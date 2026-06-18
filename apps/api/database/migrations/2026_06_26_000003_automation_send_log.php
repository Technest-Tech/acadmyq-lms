<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Append-only log of every WhatsApp send produced by the WhatsAppSender seam — manual bill/report
 * sends and (later) the scheduled automation jobs. Records the transport actually used (WASENDER
 * API vs a wa.me DEEPLINK fallback), the recipient, the referenced entity, and the outcome.
 *
 * Doubles as the idempotency ledger: a unique (academy_id, dedupe_key) lets the seam skip a logical
 * send that was already handled (e.g. one reminder per bill per day). Tenant-scoped RLS so each
 * academy's sends stay isolated and the owner can later review their own log.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table automation_send_log (
              id                  uuid primary key default uuid_generate_v7(),
              academy_id          uuid not null references academies(id) on delete cascade,
              automation_type     text not null default 'MANUAL'
                                    check (automation_type in ('TYPE1_BILLING', 'TYPE2_LESSON', 'MANUAL')),
              channel             text not null default 'WHATSAPP',
              transport           text not null
                                    check (transport in ('WASENDER', 'DEEPLINK')),
              recipient_kind      text not null
                                    check (recipient_kind in ('STUDENT', 'GUARDIAN', 'TEACHER', 'ACADEMY_OWNER')),
              recipient_id        uuid,
              recipient_phone     text,
              template_key        text,
              ref_type            text,
              ref_id              uuid,
              status              text not null
                                    check (status in ('QUEUED', 'SENT', 'FAILED', 'SKIPPED')),
              error               text,
              provider_message_id text,
              dedupe_key          text,
              created_at          timestamptz not null default now(),
              updated_at          timestamptz not null default now()
            );

            create unique index automation_send_log_dedupe_uidx
              on automation_send_log (academy_id, dedupe_key) where dedupe_key is not null;
            create index automation_send_log_academy_idx
              on automation_send_log (academy_id, created_at desc);

            alter table automation_send_log enable row level security;
            alter table automation_send_log force row level security;
            create policy tenant_isolation on automation_send_log
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on automation_send_log;
            drop table if exists automation_send_log;
        SQL);
    }
};
