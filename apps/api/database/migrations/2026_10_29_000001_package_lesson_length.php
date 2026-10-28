<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A private subscription counted in lessons (a curriculum centre, 2026-10-29): "8 lessons of 40
 * minutes at 90 each", not "5h20 at 135 an hour". The block still runs on minutes — consumption,
 * overdraft and the hourly rate are untouched — `lesson_minutes` only remembers the length of one
 * lesson it was sold in, so the forms and cards can speak lessons and the price of one.
 *
 * Null (every block before, and every Quran academy's) = read in hours as always. Copied by the
 * renewal; an edit for the next block parks it in `next_terms` like the other terms.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('alter table lesson_packages add column lesson_minutes smallint check (lesson_minutes between 5 and 600)');
    }

    public function down(): void
    {
        DB::statement('alter table lesson_packages drop column if exists lesson_minutes');
    }
};
