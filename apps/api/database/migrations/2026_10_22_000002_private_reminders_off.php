<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Private WhatsApp reminders off for every client, and a choice of who gets the lesson ones.
 *
 * The two automations that message people one-to-one — monthly billing reminders (type 1) and
 * lesson reminders (type 2) — were switched on for three clients (ElmCorner, Alrayan, Al-Furqan).
 * Alrayan reconnected WhatsApp expecting its alerts to go to the staff GROUPS it had chosen, and
 * found its teachers and students being messaged privately instead. Every client now starts from
 * "groups only"; a Super Admin turns private reminders back on per client, from the switch.
 *
 * `type2_recipients` says who a lesson reminder goes to once it is on: BOTH (the old behaviour),
 * TEACHERS, or STUDENTS. Each switch-off is recorded in the client's audit trail. Tenant tables are
 * under FORCE row-level security, so the switch-off runs academy by academy with the tenant GUC set
 * (the pattern of 2026_10_19_000001_sessions_hidden_at).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            alter table academy_automation_settings
              add column if not exists type2_recipients text not null default 'BOTH'
                check (type2_recipients in ('BOTH', 'TEACHERS', 'STUDENTS'))
        SQL);

        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        foreach (DB::table('academies')->pluck('id')->all() as $id) {
            DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $id]);

            $row = DB::table('academy_automation_settings')->where('academy_id', $id)
                ->where(fn ($q) => $q->where('type1_billing_enabled', true)->orWhere('type2_lessons_enabled', true))
                ->first(['type1_billing_enabled', 'type2_lessons_enabled']);
            if ($row === null) {
                continue;
            }

            DB::table('academy_automation_settings')->where('academy_id', $id)->update([
                'type1_billing_enabled' => false,
                'type2_lessons_enabled' => false,
                'updated_at' => now(),
            ]);
            DB::table('audit_log')->insert([
                'academy_id' => $id,
                'actor_user_id' => null,
                'actor_role' => 'SUPER_ADMIN',
                'action' => 'automation.settings_updated',
                'entity_type' => 'academy',
                'entity_id' => $id,
                'before' => json_encode(['type1_billing_enabled' => (bool) $row->type1_billing_enabled, 'type2_lessons_enabled' => (bool) $row->type2_lessons_enabled]),
                'after' => json_encode(['type1_billing_enabled' => false, 'type2_lessons_enabled' => false, 'reason' => 'private reminders off for every client']),
                'created_at' => now(),
            ]);
        }

        DB::statement("select set_config('app.current_academy_id', '', true)");
    }

    public function down(): void
    {
        // The switch-off is a decision, not schema: it is not undone. Only the column goes.
        DB::statement('alter table academy_automation_settings drop column if exists type2_recipients');
    }
};
