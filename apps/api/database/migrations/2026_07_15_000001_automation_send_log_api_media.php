<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Extend automation_send_log for the external WhatsApp API (docs/whatsapp-api):
 *   - a new 'API' automation_type (sends originated by an external API client, distinct from the
 *     internal MANUAL / TYPE1_BILLING / TYPE2_LESSON producers),
 *   - nullable media_url / media_type columns so image sends are observable in the log.
 *
 * Plain ALTERs on an existing table — no RLS/force-rls DDL (that would poison the rollback test),
 * so this is safe to re-run through migrate/rollback. The inline check on automation_type was
 * created unnamed, so Postgres named it automation_send_log_automation_type_check; we swap it.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table automation_send_log
              drop constraint if exists automation_send_log_automation_type_check;
            alter table automation_send_log
              add constraint automation_send_log_automation_type_check
              check (automation_type in ('TYPE1_BILLING', 'TYPE2_LESSON', 'MANUAL', 'API'));

            -- API sends target arbitrary numbers, so add an EXTERNAL recipient kind.
            alter table automation_send_log
              drop constraint if exists automation_send_log_recipient_kind_check;
            alter table automation_send_log
              add constraint automation_send_log_recipient_kind_check
              check (recipient_kind in ('STUDENT', 'GUARDIAN', 'TEACHER', 'ACADEMY_OWNER', 'EXTERNAL'));

            alter table automation_send_log add column if not exists media_url  text;
            alter table automation_send_log add column if not exists media_type text;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table automation_send_log drop column if exists media_type;
            alter table automation_send_log drop column if exists media_url;

            alter table automation_send_log
              drop constraint if exists automation_send_log_recipient_kind_check;
            alter table automation_send_log
              add constraint automation_send_log_recipient_kind_check
              check (recipient_kind in ('STUDENT', 'GUARDIAN', 'TEACHER', 'ACADEMY_OWNER'));

            alter table automation_send_log
              drop constraint if exists automation_send_log_automation_type_check;
            alter table automation_send_log
              add constraint automation_send_log_automation_type_check
              check (automation_type in ('TYPE1_BILLING', 'TYPE2_LESSON', 'MANUAL'));
        SQL);
    }
};
