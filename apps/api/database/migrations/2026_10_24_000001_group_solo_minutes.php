<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A group that is down to ONE student for a lesson may count that lesson against the student's
 * hours at a different length than it ran: a 40-minute class alone counts as 60 of the hours they
 * bought, while the teacher is still paid the 40 that happened. Null = count the real duration.
 * Only an hours group (`month_minutes`) reads it; every other billing mode ignores it.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table class_groups add column solo_billed_minutes integer
              check (solo_billed_minutes is null or solo_billed_minutes between 1 and 600);
        SQL);
    }

    public function down(): void
    {
        DB::unprepared('alter table class_groups drop column if exists solo_billed_minutes;');
    }
};
