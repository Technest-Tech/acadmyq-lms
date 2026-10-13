<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * WhatsApp group alerts learn about free trials: TRIAL_STARTED (a trial's slot has arrived) and
 * TRIAL_NOT_MARKED (the trial ended N minutes ago and nobody recorded attended / no-show). The
 * ledger's event-type check lists every type, so it has to learn both.
 *
 * A trial is supervised exactly like a lesson, so every group that already watches lessons starts
 * watching trials too — the academy asked for "the same alerts as normal classes", not for one more
 * box to remember to tick. `event_since` is stamped NOW for the new types: the group hears about
 * trials from this moment on, never a replay of last week's.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table whatsapp_group_alerts drop constraint whatsapp_group_alerts_event_chk;
            alter table whatsapp_group_alerts add constraint whatsapp_group_alerts_event_chk check (event_type in (
              'SESSION_STARTED', 'SESSION_NOT_MARKED', 'REPORT_OVERDUE', 'TRIAL_STARTED', 'TRIAL_NOT_MARKED',
              'PACKAGE_LOW', 'PACKAGE_ENDED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'TEST'
            ));
        SQL);

        // FORCE RLS would hide every row from a migration (no academy GUC is set here), so it is
        // lifted for the length of the rewrite and put straight back.
        $stamp = "to_char(now() at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"+00:00\"')";
        DB::unprepared(<<<SQL
            alter table whatsapp_groups no force row level security;

            update whatsapp_groups
               set events = events || '["TRIAL_STARTED"]'::jsonb,
                   event_since = event_since || jsonb_build_object('TRIAL_STARTED', {$stamp})
             where events ? 'SESSION_STARTED' and not events ? 'TRIAL_STARTED';

            update whatsapp_groups
               set events = events || '["TRIAL_NOT_MARKED"]'::jsonb,
                   event_since = event_since || jsonb_build_object('TRIAL_NOT_MARKED', {$stamp})
             where events ? 'SESSION_NOT_MARKED' and not events ? 'TRIAL_NOT_MARKED';

            alter table whatsapp_groups force row level security;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table whatsapp_groups no force row level security;
            update whatsapp_groups
               set events = events - 'TRIAL_STARTED' - 'TRIAL_NOT_MARKED',
                   event_since = event_since - 'TRIAL_STARTED' - 'TRIAL_NOT_MARKED';
            alter table whatsapp_groups force row level security;

            alter table whatsapp_group_alerts no force row level security;
            delete from whatsapp_group_alerts where event_type in ('TRIAL_STARTED', 'TRIAL_NOT_MARKED');
            alter table whatsapp_group_alerts force row level security;

            alter table whatsapp_group_alerts drop constraint whatsapp_group_alerts_event_chk;
            alter table whatsapp_group_alerts add constraint whatsapp_group_alerts_event_chk check (event_type in (
              'SESSION_STARTED', 'SESSION_NOT_MARKED', 'REPORT_OVERDUE',
              'PACKAGE_LOW', 'PACKAGE_ENDED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'TEST'
            ));
        SQL);
    }
};
