<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * One trial lesson in a group (Lingo 2026-11-15): a membership for that one day, marked so the
 * group's month/hours billing never treats it as a member, and charged one lesson at the group's own
 * per-lesson price (App\Services\GroupTrial). Additive; every existing membership is not a trial.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared('alter table class_group_members add column if not exists is_trial boolean not null default false;');
    }

    public function down(): void
    {
        DB::unprepared('alter table class_group_members drop column if exists is_trial;');
    }
};
