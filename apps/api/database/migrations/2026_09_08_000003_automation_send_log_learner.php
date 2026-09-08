<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Widen the WhatsApp send log for the LMS (docs/lms/10 §2).
 *
 * The learner password-reset link is the first message this platform sends to a LEARNER — an actor
 * the send log did not know about, because it predates the LMS module. Two check constraints have to
 * learn about it:
 *
 *   • `recipient_kind` gains 'LEARNER' — a self-registered student of a course site, not a
 *     `students` row under a guardian. NOTE the list is rewritten whole, so it must carry every
 *     value an earlier migration added ('EXTERNAL', from the external WhatsApp API) — dropping one
 *     breaks that feature's inserts silently, inside a transaction it then poisons.
 *   • `automation_type` gains 'LMS' — sends that belong to the course platform rather than to
 *     billing (TYPE1) or lesson reminders (TYPE2).
 *
 * This is not cosmetic. `WhatsAppSender::record()` swallows logging failures so a logging problem can
 * never break a send — but a failed INSERT still poisons the surrounding Postgres transaction, and
 * every learner request runs inside one (ResolveAcademyContext). A rejected log row would therefore
 * take down the whole request it was only meant to observe.
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
              check (automation_type in ('TYPE1_BILLING', 'TYPE2_LESSON', 'MANUAL', 'API', 'LMS'));

            alter table automation_send_log
              drop constraint if exists automation_send_log_recipient_kind_check;
            alter table automation_send_log
              add constraint automation_send_log_recipient_kind_check
              check (recipient_kind in ('STUDENT', 'GUARDIAN', 'TEACHER', 'ACADEMY_OWNER', 'EXTERNAL', 'LEARNER'));
        SQL);
    }

    public function down(): void
    {
        // Drop the widened rows first: rolling back with LMS sends on file would fail the re-add.
        DB::unprepared(<<<'SQL'
            delete from automation_send_log
             where automation_type = 'LMS' or recipient_kind = 'LEARNER';

            alter table automation_send_log
              drop constraint if exists automation_send_log_automation_type_check;
            alter table automation_send_log
              add constraint automation_send_log_automation_type_check
              check (automation_type in ('TYPE1_BILLING', 'TYPE2_LESSON', 'MANUAL', 'API'));

            alter table automation_send_log
              drop constraint if exists automation_send_log_recipient_kind_check;
            alter table automation_send_log
              add constraint automation_send_log_recipient_kind_check
              check (recipient_kind in ('STUDENT', 'GUARDIAN', 'TEACHER', 'ACADEMY_OWNER', 'EXTERNAL'));
        SQL);
    }
};
