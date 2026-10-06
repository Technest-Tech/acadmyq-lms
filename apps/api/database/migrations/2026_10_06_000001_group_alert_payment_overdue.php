<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * WhatsApp group alerts gain PAYMENT_OVERDUE — the repeating "this invoice is still unpaid"
 * reminder (every N days from the day it fell due, until paid). The ledger's event-type check
 * lists every type, so it has to learn the new one.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table whatsapp_group_alerts drop constraint whatsapp_group_alerts_event_chk;
            alter table whatsapp_group_alerts add constraint whatsapp_group_alerts_event_chk check (event_type in (
              'SESSION_STARTED', 'SESSION_NOT_MARKED', 'REPORT_OVERDUE',
              'PACKAGE_LOW', 'PACKAGE_ENDED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'TEST'
            ));
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            delete from whatsapp_group_alerts where event_type = 'PAYMENT_OVERDUE';
            alter table whatsapp_group_alerts drop constraint whatsapp_group_alerts_event_chk;
            alter table whatsapp_group_alerts add constraint whatsapp_group_alerts_event_chk check (event_type in (
              'SESSION_STARTED', 'SESSION_NOT_MARKED', 'REPORT_OVERDUE',
              'PACKAGE_LOW', 'PACKAGE_ENDED', 'PAYMENT_RECEIVED', 'TEST'
            ));
        SQL);
    }
};
