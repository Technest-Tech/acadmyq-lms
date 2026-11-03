<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A learning centre's holidays (docs/centre-profile, Phase 2 §3): the days it is closed — Eid, the
 * mid-year break, a national holiday. Lesson generation skips a closed date, declaring a holiday
 * cancels the lessons already on the board for those days (cancel_reason / status_reason 'HOLIDAY'),
 * and removing it brings them back. One row per holiday; a range of dates in the academy's own
 * calendar. No rows means nothing changes for anyone — a Quran academy never writes one.
 *
 * `class_group_lessons.original_teacher_id`: a colleague covering ONE lesson. The lesson's
 * `teacher_id` was always the snapshot a substitute could stand in (and the payout line follows it);
 * this column remembers who was replaced, and is the marker that stops the generator realigning the
 * lesson back to the group's teacher. Null on every lesson that has no substitute.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table academy_holidays (
              id         uuid primary key default uuid_generate_v7(),
              academy_id uuid not null references academies(id),
              name       text not null,
              starts_on  date not null,
              ends_on    date not null,
              created_by uuid references users(id),
              created_at timestamptz not null default now(),
              updated_at timestamptz not null default now(),
              constraint academy_holidays_name_chk  check (length(btrim(name)) > 0),
              constraint academy_holidays_dates_chk check (ends_on >= starts_on)
            );
            create index academy_holidays_range_idx on academy_holidays (academy_id, starts_on, ends_on);

            alter table academy_holidays enable row level security;
            alter table academy_holidays force row level security;
            create policy tenant_isolation on academy_holidays
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            alter table class_group_lessons
              add column original_teacher_id uuid references teachers(id);
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table class_group_lessons drop column if exists original_teacher_id;
            drop table if exists academy_holidays;
        SQL);
    }
};
