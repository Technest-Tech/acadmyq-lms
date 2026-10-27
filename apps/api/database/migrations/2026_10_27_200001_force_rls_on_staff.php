<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `staff` was the one tenant table whose RLS was ENABLED but never FORCED (2026_06_11_000020).
 * The table is owned by the app's own role, and a table owner skips a non-forced policy — so every
 * academy listed, edited and deactivated every other academy's employees (names, phones, salaries,
 * notes). Found 2026-10-27 when one client's owner deactivated another client's staff.
 *
 * Force it, and move the policy onto `app.current_academy_id()` like every other table: the raw
 * `current_setting(...)::uuid` cast fails on an empty setting, which the owner bypass had hidden.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on staff;
            create policy tenant_isolation on staff
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
            alter table staff enable row level security;
            alter table staff force row level security;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared('alter table staff no force row level security;');
    }
};
