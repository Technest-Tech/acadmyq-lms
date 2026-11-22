<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A centre's month is counted in LESSONS, not hours (Ahmed, 2026-11-22, Lingo: "السيستم بيحسب بالحصص
 * مش بالساعات"). The centre form always asked "lessons a month" but kept only lessons × length in
 * `month_minutes`, and the hours engine counted each lesson by its real length. A group created with
 * 40-minute lessons and priced as 8 lessons of 60 (480) therefore needed twelve lessons before the next
 * month was raised — رقية أحمد had 8 lessons of Prep 2 علوم and no due.
 *
 *   class_groups.month_lessons   lessons one month buys. Set = every lesson held counts as one lesson
 *                                (month_minutes ÷ month_lessons minutes), whatever its length. Null =
 *                                the real minutes, exactly as before (Quran academies, hours groups).
 *
 * Backfill, centre academies only ({@see fill()}): month_minutes ÷ the group's lesson length, where all
 * its weekly times share one length and it divides evenly — what the centre form shows as the month's
 * lessons today.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table class_groups
              add column if not exists month_lessons integer,
              drop constraint if exists class_groups_month_lessons_chk,
              add constraint class_groups_month_lessons_chk check (
                month_lessons is null or (month_lessons between 1 and 500 and month_minutes is not null)
              );
        SQL);

        $this->fill();
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table class_groups
              drop constraint if exists class_groups_month_lessons_chk,
              drop column if exists month_lessons;
        SQL);
    }

    /** Public so the test suite can run it against fixtures. Returns how many groups were set. */
    public function fill(): int
    {
        // One unit, so the tenant settings below hold for every statement (they are transaction-local).
        return DB::transaction(function (): int {
            DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

            $centres = DB::table('academies as a')
                ->join('academy_types as t', 't.id', '=', 'a.academy_type_id')
                ->where('t.code', 'CENTRE')
                ->pluck('a.id')
                ->all();

            $set = 0;
            // class_groups and their slots are under row-level security: academy by academy.
            foreach ($centres as $id) {
                DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $id]);

                $set += DB::update(<<<'SQL'
                    update class_groups cg
                       set month_lessons = cg.month_minutes / s.len
                      from (select group_id, min(duration_minutes) as len
                              from class_group_slots
                             group by group_id
                            having count(distinct duration_minutes) = 1) s
                     where s.group_id = cg.id
                       and cg.academy_id = ?
                       and cg.month_minutes is not null
                       and cg.month_lessons is null
                       and cg.month_minutes % s.len = 0
                       and cg.month_minutes / s.len between 1 and 500
                SQL, [(string) $id]);
            }
            DB::statement("select set_config('app.current_academy_id', '', true)");

            return $set;
        });
    }
};
