<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A fixed price for a 40-minute lesson (`lesson40_price`, Lingo 2026-11-26: "خانة حصص الـ40 دقيقة
 * بحساب معين" → Ahmed: a fixed price per 40-minute lesson).
 *
 *   teachers.lesson40_minor   what an HOURLY teacher earns for one 40-minute lesson, private or group
 *                             (a group paid by the hour or on the teacher's own terms). Null = two
 *                             thirds of the hour, exactly as before — every academy without the switch.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table teachers
              add column if not exists lesson40_minor integer,
              drop constraint if exists teachers_lesson40_minor_chk,
              add constraint teachers_lesson40_minor_chk check (lesson40_minor is null or lesson40_minor >= 0);
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table teachers
              drop constraint if exists teachers_lesson40_minor_chk,
              drop column if exists lesson40_minor;
        SQL);
    }
};
