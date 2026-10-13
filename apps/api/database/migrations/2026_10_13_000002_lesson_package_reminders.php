<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Package reminders: how many times the payer was sent a WhatsApp reminder about this package
 * (pay what is due, or renew a block that ran out), and when the last one went.
 *
 * A counter on the package rather than a table of its own — the screen only ever asks "how many,
 * and when was the last", and who pressed the button each time is already in the audit log
 * (`lesson_package.reminder_sent`).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table lesson_packages
              add column reminders_sent   integer not null default 0,
              add column last_reminded_at timestamptz,
              add constraint lesson_packages_reminders_chk check (reminders_sent >= 0);
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table lesson_packages
              drop constraint if exists lesson_packages_reminders_chk,
              drop column if exists reminders_sent,
              drop column if exists last_reminded_at;
        SQL);
    }
};
