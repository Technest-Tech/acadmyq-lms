<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Lesson reminders into WhatsApp groups (`whatsapp.group_reminders`, switched on per client by a
 * Super Admin). An academy assigns a WhatsApp group to a student and to a teacher, and every lesson
 * of theirs is announced there: once ahead of time and once when it starts.
 *
 *   - `whatsapp_groups.kind`            — STAFF is what a Super Admin linked for staff alerts and
 *                                         shows on their panel; LESSON came from an assignment and
 *                                         does not, or a 300-student academy would bury that card.
 *                                         One WhatsApp group is one row whatever it is used for.
 *   - `students/teachers.whatsapp_group_id` — the assignment. Unlinking a group forgets it rather
 *                                         than blocking the unlink.
 *   - `academy_automation_settings.lesson_reminder_*` — when to send, and in which language.
 *   - the alert ledger learns the two new types, so a reminder gets the staff alerts' idempotency,
 *     retries and delivery tracking instead of a second copy of them.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table whatsapp_groups
              add column kind text not null default 'STAFF'
                constraint whatsapp_groups_kind_chk check (kind in ('STAFF', 'LESSON'));

            alter table students
              add column whatsapp_group_id uuid references whatsapp_groups(id) on delete set null;
            alter table teachers
              add column whatsapp_group_id uuid references whatsapp_groups(id) on delete set null;
            create index students_whatsapp_group_idx on students (whatsapp_group_id) where whatsapp_group_id is not null;
            create index teachers_whatsapp_group_idx on teachers (whatsapp_group_id) where whatsapp_group_id is not null;

            alter table academy_automation_settings
              add column lesson_reminder_lead_minutes smallint not null default 30
                constraint academy_automation_reminder_lead_chk check (lesson_reminder_lead_minutes between 0 and 1440),
              add column lesson_reminder_at_start boolean not null default true,
              add column lesson_reminder_language text not null default 'ar'
                constraint academy_automation_reminder_language_chk check (lesson_reminder_language in ('ar', 'en'));

            alter table whatsapp_group_alerts drop constraint whatsapp_group_alerts_event_chk;
            alter table whatsapp_group_alerts add constraint whatsapp_group_alerts_event_chk check (event_type in (
              'SESSION_STARTED', 'SESSION_NOT_MARKED', 'REPORT_OVERDUE', 'TRIAL_STARTED', 'TRIAL_NOT_MARKED',
              'PACKAGE_LOW', 'PACKAGE_ENDED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'TEST',
              'LESSON_REMINDER', 'LESSON_STARTING'
            ));
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table whatsapp_group_alerts no force row level security;
            delete from whatsapp_group_alerts where event_type in ('LESSON_REMINDER', 'LESSON_STARTING');
            alter table whatsapp_group_alerts force row level security;

            alter table whatsapp_group_alerts drop constraint whatsapp_group_alerts_event_chk;
            alter table whatsapp_group_alerts add constraint whatsapp_group_alerts_event_chk check (event_type in (
              'SESSION_STARTED', 'SESSION_NOT_MARKED', 'REPORT_OVERDUE', 'TRIAL_STARTED', 'TRIAL_NOT_MARKED',
              'PACKAGE_LOW', 'PACKAGE_ENDED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'TEST'
            ));

            alter table academy_automation_settings
              drop column if exists lesson_reminder_lead_minutes,
              drop column if exists lesson_reminder_at_start,
              drop column if exists lesson_reminder_language;

            drop index if exists students_whatsapp_group_idx;
            drop index if exists teachers_whatsapp_group_idx;
            alter table students drop column if exists whatsapp_group_id;
            alter table teachers drop column if exists whatsapp_group_id;

            alter table whatsapp_groups no force row level security;
            delete from whatsapp_groups where kind = 'LESSON';
            alter table whatsapp_groups force row level security;
            alter table whatsapp_groups drop column if exists kind;
        SQL);
    }
};
