<?php

declare(strict_types=1);

use App\Support\Entitlement;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A curriculum centre's private subscriptions opened before 2026-10-29 still read in hours ("4h
 * bought, 165 an hour") beside the new ones in lessons — lingo, 2026-10-31: "the old ones in hours
 * are a mess, make every private one by the lesson". `lesson_minutes` is display only (the block
 * still runs on minutes), so filling it changes what the cards say and nothing else: no balance,
 * bill or rate moves.
 *
 * The length of one lesson, per block, from what it actually was:
 *   1. the length most of its own lessons had;
 *   2. else the student's timetable for that subject (the untied block: any of their timetables);
 *   3. else the length most of the student's lessons had on any block.
 * A block with none of these stays in hours.
 *
 * Centres only — a Quran academy's blocks stay in hours. Idempotent: only empty rows are filled.
 */
return new class extends Migration
{
    public function up(): void
    {
        $this->fill();
    }

    public function down(): void
    {
        // Display only, and newer blocks set it themselves: nothing to take back.
    }

    /** Public so the test suite can run it against fixtures. Returns how many blocks were filled. */
    public function fill(): int
    {
        // One unit, so the tenant settings below hold for every statement (they are transaction-local).
        return DB::transaction(function (): int {
            DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

            $filled = 0;
            // lesson_packages and the entitlement rows are under FORCE row-level security: academy by academy.
            foreach (DB::table('academies')->pluck('id')->all() as $id) {
                DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $id]);
                if (! Entitlement::hasCapability((string) $id, 'centre')) {
                    continue;
                }

                $filled += DB::update(<<<'SQL'
                    update lesson_packages p
                       set lesson_minutes = x.len,
                           updated_at = now()
                      from (
                        select p2.id,
                               coalesce(
                                 (select c.minutes from lesson_package_credits c
                                   where c.package_id = p2.id
                                   group by c.minutes order by count(*) desc, c.minutes desc limit 1),
                                 (select ss.duration_minutes from schedule_slots ss
                                    join schedules sc on sc.id = ss.schedule_id
                                   where sc.student_id = p2.student_id
                                     and sc.deleted_at is null and sc.is_active
                                     and (p2.teacher_id is null or sc.teacher_id = p2.teacher_id)
                                   group by ss.duration_minutes order by count(*) desc, ss.duration_minutes desc limit 1),
                                 (select c.minutes from lesson_package_credits c
                                   where c.student_id = p2.student_id
                                   group by c.minutes order by count(*) desc, c.minutes desc limit 1)
                               ) as len
                          from lesson_packages p2
                         where p2.lesson_minutes is null
                      ) x
                     where x.id = p.id
                       and x.len between 5 and 600
                SQL);
            }
            DB::statement("select set_config('app.current_academy_id', '', true)");

            return $filled;
        });
    }
};
