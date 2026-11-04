<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * GROUP_LESSON_NOT_MARKED in the Supervision staff group (docs/centre-profile/02-COHERENCE-AUDIT.md §3):
 * a group lesson whose sheet is still not saved N minutes after it ended. The ledger's event_type
 * CHECK lists every type, so a new alert is a migration (as for PAYMENT_OVERDUE and the trials).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table whatsapp_group_alerts drop constraint whatsapp_group_alerts_event_chk;
            alter table whatsapp_group_alerts add constraint whatsapp_group_alerts_event_chk check (event_type in (
              'SESSION_STARTED', 'SESSION_NOT_MARKED', 'GROUP_LESSON_NOT_MARKED', 'REPORT_OVERDUE', 'TRIAL_STARTED', 'TRIAL_NOT_MARKED',
              'PACKAGE_LOW', 'PACKAGE_ENDED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'TEST',
              'LESSON_REMINDER', 'LESSON_STARTING'
            ));
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table whatsapp_group_alerts no force row level security;
            delete from whatsapp_group_alerts where event_type = 'GROUP_LESSON_NOT_MARKED';
            alter table whatsapp_group_alerts force row level security;

            alter table whatsapp_group_alerts drop constraint whatsapp_group_alerts_event_chk;
            alter table whatsapp_group_alerts add constraint whatsapp_group_alerts_event_chk check (event_type in (
              'SESSION_STARTED', 'SESSION_NOT_MARKED', 'REPORT_OVERDUE', 'TRIAL_STARTED', 'TRIAL_NOT_MARKED',
              'PACKAGE_LOW', 'PACKAGE_ENDED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'TEST',
              'LESSON_REMINDER', 'LESSON_STARTING'
            ));
        SQL);
    }
};
