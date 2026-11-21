<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The clock the person taking a trial lives on (Ahmed 2026-11-17): a trial is booked on the
 * academy's clock, and this says what that hour is at the student's home — shown beside it on the
 * trials board and carried into the student form when the trial becomes a student. Null = the
 * academy's own clock (or, for an existing student, their country's usual one).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('alter table trials add column if not exists student_timezone text');
    }

    public function down(): void
    {
        DB::statement('alter table trials drop column if exists student_timezone');
    }
};
