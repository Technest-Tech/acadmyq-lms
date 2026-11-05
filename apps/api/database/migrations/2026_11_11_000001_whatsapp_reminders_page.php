<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The academy's WhatsApp page (`whatsapp.group_reminders`, switched on per client by a Super Admin):
 * the academy links its number, chooses how lesson reminders travel and who gets them, and launches
 * them itself.
 *
 *   - `academy_automation_settings.lesson_reminders_live` — the launch button. Nothing is sent until
 *     the academy presses it. An academy that already has a group assigned to a student or teacher
 *     was receiving reminders under the old "on as soon as a group is assigned" rule, so it starts
 *     launched and nothing changes for it.
 *   - `lesson_reminder_channel` — GROUPS (the assigned WhatsApp groups), PRIVATE (a message to each
 *     person's own number) or BOTH. `lesson_reminder_audience` — students, teachers or both.
 *   - `class_groups.whatsapp_group_id` — a centre's class has one WhatsApp group for all its
 *     students; a class lesson is announced there.
 *   - the alert ledger takes a row addressed to a phone instead of a group (`recipient_phone`), so
 *     a private reminder gets the same pacing, expiry, retries and delivery tracking as a group one.
 *     Exactly one of the two is set.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table academy_automation_settings
              add column if not exists lesson_reminders_live boolean not null default false,
              add column if not exists lesson_reminders_live_since timestamptz,
              add column if not exists lesson_reminder_channel text not null default 'GROUPS'
                constraint academy_automation_reminder_channel_chk check (lesson_reminder_channel in ('GROUPS', 'PRIVATE', 'BOTH')),
              add column if not exists lesson_reminder_audience text not null default 'BOTH'
                constraint academy_automation_reminder_audience_chk check (lesson_reminder_audience in ('BOTH', 'STUDENTS', 'TEACHERS'));

            alter table class_groups
              add column if not exists whatsapp_group_id uuid references whatsapp_groups(id) on delete set null;
            create index if not exists class_groups_whatsapp_group_idx on class_groups (whatsapp_group_id) where whatsapp_group_id is not null;

            alter table whatsapp_group_alerts
              alter column group_id drop not null,
              add column if not exists recipient_phone text,
              add column if not exists recipient_kind text
                constraint whatsapp_group_alerts_recipient_kind_chk check (recipient_kind is null or recipient_kind in ('STUDENT', 'GUARDIAN', 'TEACHER')),
              add column if not exists recipient_name text,
              add constraint whatsapp_group_alerts_target_chk check ((group_id is null) <> (recipient_phone is null));
            create unique index if not exists whatsapp_group_alerts_direct_uidx
              on whatsapp_group_alerts (academy_id, recipient_phone, event_type, subject_key)
              where recipient_phone is not null;
        SQL);

        // Tenant tables are under FORCE row-level security: the backfill runs academy by academy with
        // the tenant GUC set (the pattern of 2026_10_22_000002_private_reminders_off).
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        foreach (DB::table('academies')->pluck('id')->all() as $id) {
            DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $id]);

            $assigned = DB::table('students')->whereNotNull('whatsapp_group_id')->whereNull('deleted_at')->exists()
                || DB::table('teachers')->whereNotNull('whatsapp_group_id')->whereNull('deleted_at')->exists();
            if (! $assigned) {
                continue;
            }

            $updated = DB::table('academy_automation_settings')->where('academy_id', $id)
                ->update(['lesson_reminders_live' => true, 'lesson_reminders_live_since' => now(), 'updated_at' => now()]);
            if ($updated === 0) {
                DB::table('academy_automation_settings')->insert([
                    'academy_id' => $id,
                    'lesson_reminders_live' => true,
                    'lesson_reminders_live_since' => now(),
                ]);
            }
        }

        DB::statement("select set_config('app.current_academy_id', '', true)");
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table whatsapp_group_alerts no force row level security;
            delete from whatsapp_group_alerts where group_id is null;
            alter table whatsapp_group_alerts force row level security;

            drop index if exists whatsapp_group_alerts_direct_uidx;
            alter table whatsapp_group_alerts
              drop constraint if exists whatsapp_group_alerts_target_chk,
              drop column if exists recipient_name,
              drop column if exists recipient_kind,
              drop column if exists recipient_phone,
              alter column group_id set not null;

            drop index if exists class_groups_whatsapp_group_idx;
            alter table class_groups drop column if exists whatsapp_group_id;

            alter table academy_automation_settings
              drop column if exists lesson_reminder_audience,
              drop column if exists lesson_reminder_channel,
              drop column if exists lesson_reminders_live_since,
              drop column if exists lesson_reminders_live;
        SQL);
    }
};
