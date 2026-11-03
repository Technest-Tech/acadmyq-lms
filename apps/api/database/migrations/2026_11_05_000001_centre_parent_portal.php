<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The parent portal for a centre (docs/centre-profile, Phase 2 §4): the absence alert's switch and
 * its wording, and a place for the send in the log.
 *
 *   - `academy_automation_settings.group_absence_alert_enabled` — OFF for everyone until the centre
 *     switches it on in Settings; the attendance sheet asks the seam, the seam asks this column.
 *   - `academy_automation_settings.group_absence_alert_message` — the centre's own wording, null
 *     meaning "the platform default" (the GROUP_ABSENCE template row below), so a client who never
 *     touched it follows an improved default.
 *   - `message_templates.GROUP_ABSENCE` — the default text in both languages, the same table the
 *     bill and dunning messages read from.
 *   - `automation_send_log.automation_type` learns GROUP_ABSENCE so the send is told apart from a
 *     manual one on the Super Admin's activity screen. The inline check was created unnamed and
 *     renamed by the API migration, which is the name swapped here.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table academy_automation_settings
              add column if not exists group_absence_alert_enabled boolean not null default false,
              add column if not exists group_absence_alert_message text;

            alter table automation_send_log
              drop constraint if exists automation_send_log_automation_type_check;
            alter table automation_send_log
              add constraint automation_send_log_automation_type_check
              check (automation_type in ('TYPE1_BILLING', 'TYPE2_LESSON', 'MANUAL', 'API', 'GROUP_ABSENCE'));
        SQL);

        // The catalogue mutates for a Super Admin only (catalog_mutate); a migration has no role, so
        // the policy is lifted for the one statement, the way the down() of its neighbours does.
        DB::unprepared('alter table message_templates no force row level security');
        try {
            DB::table('message_templates')->insertOrIgnore([
                'key' => 'GROUP_ABSENCE',
                'channel' => 'WHATSAPP',
                'body_ar' => "🏫 *{{academy}}*\nنود إبلاغكم بأن {{student}} لم يحضر حصة مجموعة «{{group}}» يوم {{date}} الساعة {{time}}.\nإن كان هناك عذر فنرجو إخبارنا، وشكراً لتعاونكم.",
                'body_en' => "🏫 *{{academy}}*\n{{student}} was absent from the \"{{group}}\" class on {{date}} at {{time}}.\nIf there is a reason, please let us know. Thank you.",
                'variables' => json_encode(['academy', 'student', 'group', 'date', 'time']),
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } finally {
            DB::unprepared('alter table message_templates force row level security');
        }
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table message_templates no force row level security;
            delete from message_templates where key = 'GROUP_ABSENCE';
            alter table message_templates force row level security;

            alter table automation_send_log no force row level security;
            delete from automation_send_log where automation_type = 'GROUP_ABSENCE';
            alter table automation_send_log force row level security;

            alter table automation_send_log
              drop constraint if exists automation_send_log_automation_type_check;
            alter table automation_send_log
              add constraint automation_send_log_automation_type_check
              check (automation_type in ('TYPE1_BILLING', 'TYPE2_LESSON', 'MANUAL', 'API'));

            alter table academy_automation_settings
              drop column if exists group_absence_alert_enabled,
              drop column if exists group_absence_alert_message;
        SQL);
    }
};
