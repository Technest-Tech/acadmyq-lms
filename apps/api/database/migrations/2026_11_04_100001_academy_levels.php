<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Levels / grades (docs/centre-profile, Phase 2.1). A learning centre classifies its students:
 * an English academy says A1 … C2, a curriculum centre says أولى إعدادي … ثالثة ثانوي. Until now
 * `class_groups.level` was a free text and a student had no level at all. From here the academy
 * keeps ONE ordered list of its own levels, and both the group and the student point at it.
 *
 *   - `academy_levels`         — the list: a name, a position, on/off. Unique per academy by name.
 *   - `students.level_id`      — where the student stands today (null = not classified).
 *   - `class_groups.level_id`  — which level the group teaches. `class_groups.level` (the text) is
 *                                kept and written as the level's name, so every reader of the
 *                                text — cards, boards, sheets — keeps working untouched.
 *   - `student_level_history`  — every promotion: from which level (and group) to which, from
 *                                when, by whom. A level change is never a silent overwrite.
 *
 * Back-fill: every academy whose groups carry a level text gets a level row per distinct text
 * (in order of first appearance) and its groups point at it. Nothing is renamed or dropped — a
 * Quran academy with no level texts gets no rows and sees no change.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table if not exists academy_levels (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id),
              name        text not null,
              sort_order  int not null default 0,
              is_active   boolean not null default true,
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now(),
              unique (academy_id, name)
            );
            create index if not exists academy_levels_academy_order_idx on academy_levels (academy_id, sort_order);

            alter table academy_levels enable row level security;
            alter table academy_levels force row level security;
            drop policy if exists tenant_isolation on academy_levels;
            create policy tenant_isolation on academy_levels
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            alter table students
              add column if not exists level_id uuid references academy_levels(id) on delete set null;
            create index if not exists students_academy_level_idx on students (academy_id, level_id);

            alter table class_groups
              add column if not exists level_id uuid references academy_levels(id) on delete set null;
            create index if not exists class_groups_academy_level_idx on class_groups (academy_id, level_id);

            create table if not exists student_level_history (
              id            uuid primary key default uuid_generate_v7(),
              academy_id    uuid not null references academies(id),
              student_id    uuid not null references students(id),
              from_level_id uuid references academy_levels(id) on delete set null,
              to_level_id   uuid references academy_levels(id) on delete set null,
              from_group_id uuid references class_groups(id) on delete set null,
              to_group_id   uuid references class_groups(id) on delete set null,
              effective_on  date not null,
              note          text,
              changed_by    uuid references users(id),
              created_at    timestamptz not null default now()
            );
            create index if not exists student_level_history_student_idx on student_level_history (academy_id, student_id, effective_on);

            alter table student_level_history enable row level security;
            alter table student_level_history force row level security;
            drop policy if exists tenant_isolation on student_level_history;
            create policy tenant_isolation on student_level_history
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        $this->fill();
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on student_level_history;
            drop table if exists student_level_history;
            alter table class_groups drop column if exists level_id;
            alter table students drop column if exists level_id;
            drop policy if exists tenant_isolation on academy_levels;
            drop table if exists academy_levels;
        SQL);
    }

    /**
     * The groups' level texts become level rows, per academy, under that academy's own tenant
     * context (the tables are behind RLS). Public so the test suite can run it against fixtures.
     * Idempotent: a text that already has a row is only pointed at. Returns the rows created.
     */
    public function fill(): int
    {
        return DB::transaction(function (): int {
            DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

            $created = 0;
            // RLS shows a tenant table only under its academy's context, so the loop is per academy.
            foreach (DB::table('academies')->pluck('id')->all() as $academyId) {
                DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $academyId]);

                // Distinct trimmed texts, in order of the first group that used each.
                $texts = DB::table('class_groups')
                    ->selectRaw('btrim(level) as name, min(created_at) as first_seen')
                    ->whereNotNull('level')
                    ->whereRaw("btrim(level) <> ''")
                    ->whereNull('level_id')
                    ->groupByRaw('btrim(level)')
                    ->orderBy('first_seen')
                    ->pluck('name')
                    ->all();

                $existing = DB::table('academy_levels')->pluck('id', 'name')->all();
                $next = (int) DB::table('academy_levels')->max('sort_order') + 1;

                foreach ($texts as $name) {
                    $levelId = $existing[$name] ?? null;
                    if ($levelId === null) {
                        $levelId = (string) Str::uuid();
                        DB::table('academy_levels')->insert([
                            'id' => $levelId,
                            'academy_id' => (string) $academyId,
                            'name' => $name,
                            'sort_order' => $next++,
                            'is_active' => true,
                        ]);
                        $existing[$name] = $levelId;
                        $created++;
                    }
                    DB::table('class_groups')
                        ->whereNull('level_id')
                        ->whereRaw('btrim(level) = ?', [$name])
                        ->update(['level_id' => $levelId]);
                }
            }
            DB::statement("select set_config('app.current_academy_id', '', true)");

            return $created;
        });
    }
};
