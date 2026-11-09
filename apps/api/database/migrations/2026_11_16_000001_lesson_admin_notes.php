<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The office's own note on a lesson once its attendance is recorded (lingo, 2026-11-09): a private
 * lesson (`sessions`) or a group lesson (`class_group_lessons`). Read and written only by the
 * office (App\Support\OfficeNote) — never shown to the teacher or the family. Additive.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table sessions add column if not exists admin_note text;
            alter table class_group_lessons add column if not exists admin_note text;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table class_group_lessons drop column if exists admin_note;
            alter table sessions drop column if exists admin_note;
        SQL);
    }
};
