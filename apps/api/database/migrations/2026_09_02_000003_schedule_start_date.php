<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `schedules.start_date` — the local calendar date a timetable begins producing lessons.
 *
 * Until now a timetable had no start at all: the generator's floor was `now`, so a student
 * enrolled on the 1st but entered into the system on the 20th silently lost three weeks of
 * lessons. They were taught, they were owed, and they existed nowhere — not on the attendance
 * page, not in an invoice. The only date anyone typed lived on the SUBSCRIPTION, and in the
 * enrolment wizard the timetable is saved BEFORE the pricing step, so it could not have been
 * read even if the generator had looked.
 *
 * Existing schedules default to the day this migration runs, NOT to their own created_at. That
 * is deliberate: `current_date` reproduces exactly today's behaviour ("this timetable starts
 * now"), whereas back-dating them to creation would make the next innocent timetable edit invent
 * months of lessons nobody taught.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('alter table schedules add column if not exists start_date date not null default current_date');
        DB::statement("comment on column schedules.start_date is 'Local calendar date (in schedules.timezone) from which sessions are generated.'");
    }

    public function down(): void
    {
        DB::statement('alter table schedules drop column if exists start_date');
    }
};
