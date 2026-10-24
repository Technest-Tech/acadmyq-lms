<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A family paused for a while — travelling, short of money, a term off — without deactivating
 * anyone. While `suspended_at` is set the children's timetables are switched off (and flagged, so
 * resuming switches exactly those back on), no lesson is generated for them, and no group month is
 * raised on them. Everything already recorded stays. Resuming puts the timetables back and the
 * generator fills the lessons in again.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table guardians
              add column suspended_at timestamptz,
              add column suspended_by uuid references users(id);
            alter table schedules
              add column paused_by_suspension boolean not null default false;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table schedules drop column if exists paused_by_suspension;
            alter table guardians drop column if exists suspended_by, drop column if exists suspended_at;
        SQL);
    }
};
