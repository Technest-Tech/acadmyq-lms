<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The levels a teacher teaches (EnglishSpirit, 2026-11-11: an English course runs in levels, and the
 * office picks a teacher by the levels they take). One row per (teacher, level), from the academy's
 * own levels list ({@see 2026_11_04_100001_academy_levels}). None = not said, which is every teacher
 * today. A level deleted from the list, or a teacher removed for good, takes its rows with it.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table if not exists teacher_levels (
              academy_id  uuid not null references academies(id),
              teacher_id  uuid not null references teachers(id) on delete cascade,
              level_id    uuid not null references academy_levels(id) on delete cascade,
              created_at  timestamptz not null default now(),
              primary key (teacher_id, level_id)
            );
            create index if not exists teacher_levels_academy_level_idx on teacher_levels (academy_id, level_id);

            alter table teacher_levels enable row level security;
            alter table teacher_levels force row level security;
            drop policy if exists tenant_isolation on teacher_levels;
            create policy tenant_isolation on teacher_levels
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on teacher_levels;
            drop table if exists teacher_levels;
        SQL);
    }
};
