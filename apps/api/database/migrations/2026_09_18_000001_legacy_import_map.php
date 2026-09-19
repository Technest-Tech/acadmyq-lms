<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `legacy_import_map` — the memory that makes importing an old academy re-runnable.
 *
 * Several clients still run the previous (pre-AcademiQ) Laravel app, each on its own database:
 * one table of `users` split by `user_type`, a `teacher_students` join, and a `timetable` whose
 * rows are already-materialised weekly occurrences. `php artisan legacy:import` reads an export
 * of one of those apps and writes the people and the recurring appointments into an academy here.
 *
 * That import will be run more than once — a dry run, a rehearsal, a real run, then a repeat
 * because the client kept teaching for another week on the old system while the move was agreed.
 * Without a record of "old id 225 became this uuid", the second run has no way to tell an
 * already-imported student from a new one, and the academy ends up with two of everybody. So
 * every row the importer creates is remembered here, keyed by where it came from:
 *
 *     (academy_id, source, entity, legacy_key) → target_id
 *
 * `source` is the old app's folder name ('ehsan', 'tarteel', …) so two legacy systems can be
 * merged into one academy without their numeric ids colliding. `legacy_key` is a string, not a
 * bigint, because not every mapped thing has a numeric id in the old schema — a guardian is
 * derived from a shared phone number, and a schedule slot from a weekday and a wall-clock time.
 *
 * Tenant-scoped like every other table here, and carrying `academy_id`, so `app.purge_academy`
 * discovers and clears it with the rest of a deleted client automatically.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table legacy_import_map (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id),
              source      text not null,                 -- old app identifier, e.g. 'ehsan'
              entity      text not null,                 -- 'teacher' | 'guardian' | 'student' | 'schedule' | 'slot'
              legacy_key  text not null,                 -- old primary key, or a derived natural key
              target_id   uuid not null,                 -- the row we created in this academy
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now(),
              unique (academy_id, source, entity, legacy_key)
            );
            create index legacy_import_map_academy_idx on legacy_import_map (academy_id);
            create index legacy_import_map_target_idx on legacy_import_map (target_id);

            alter table legacy_import_map enable row level security;
            alter table legacy_import_map force row level security;
            create policy tenant_isolation on legacy_import_map
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on legacy_import_map;
            drop table if exists legacy_import_map;
        SQL);
    }
};
