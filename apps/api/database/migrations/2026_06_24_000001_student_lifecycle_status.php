<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Promote students.status from free text to a constrained lifecycle vocabulary (R-STU,
 * App\Support\StudentStatus). Until now the column accepted any string; this pins it to the
 * five canonical states with REGULAR as the default, so an omitted status is a live regular
 * learner rather than NULL. CHECK + default mirror the Sprint 1 enum-via-constraint style;
 * the terminal states (GRADUATED/WITHDRAWN) are written only by the deactivate flow.
 *
 * Raw DDL (DB::unprepared) because a Postgres CHECK has no first-class Blueprint API, matching
 * the Sprint 1/4 people migrations.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            -- Existing rows only ever held REGULAR/TRIAL/TRIAL_BOOKED or NULL; fold NULL → REGULAR
            -- and map any stray legacy value into the vocabulary before locking the column down.
            update students set status = 'REGULAR'
              where status is null
                 or status not in ('TRIAL','TRIAL_BOOKED','REGULAR','GRADUATED','WITHDRAWN');

            alter table students
              alter column status set default 'REGULAR',
              alter column status set not null;

            alter table students
              add constraint students_status_chk
              check (status in ('TRIAL','TRIAL_BOOKED','REGULAR','GRADUATED','WITHDRAWN'));
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table students drop constraint if exists students_status_chk;
            alter table students alter column status drop not null;
            alter table students alter column status drop default;
        SQL);
    }
};
