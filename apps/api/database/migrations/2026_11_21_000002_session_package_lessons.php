<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A double lesson on a block counted in lessons (2026-11-15, `packages_in_lessons`): a lesson counts
 * one whatever its length — a mistyped length must not eat the family's block — unless the office
 * marks it as two on the attendance popup. Null = one, every lesson today.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('alter table sessions add column if not exists package_lessons smallint check (package_lessons between 2 and 4)');
    }

    public function down(): void
    {
        DB::statement('alter table sessions drop column if exists package_lessons');
    }
};
