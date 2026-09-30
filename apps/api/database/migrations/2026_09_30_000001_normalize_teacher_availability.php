<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Repair teacher availability saved in the wrong shape.
 *
 * Every consumer reads a window as `{weekday, start_local, end_local}` — the shape the API
 * validates on every write. ShowcaseAcademySeeder bypassed the API and wrote `{weekday, from,
 * to}` instead, and the teachers page crashed on it (`start_local.split` of undefined): the whole
 * roster of the showcase academy (alfurqan) answered with the error page. The seeder is fixed;
 * this rewrites the rows it already produced.
 *
 * `from`/`to` are carried over as `start_local`/`end_local`; a window still missing a time or a
 * weekday after that is dropped, since no screen can draw it. Rows already in the right shape are
 * not touched. No down(): the old shape was the bug.
 *
 * Keys are tested with jsonb_exists() rather than the `?` operator, which PDO would read as a
 * bind placeholder.
 *
 * `teachers` is under FORCE row-level security, so the update runs academy by academy with the
 * tenant GUC set (the pattern of 2026_07_14_000004_backfill_module_subscriptions).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        foreach (DB::table('academies')->pluck('id')->all() as $id) {
            DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $id]);

            DB::statement(<<<'SQL'
                update teachers
                   set availability = '[]'::jsonb
                 where jsonb_typeof(availability) <> 'array'
            SQL);

            DB::statement(<<<'SQL'
                update teachers t
                   set availability = (
                         select coalesce(jsonb_agg(jsonb_build_object(
                                  'weekday', (w->>'weekday')::int,
                                  'start_local', coalesce(w->>'start_local', w->>'from'),
                                  'end_local', coalesce(w->>'end_local', w->>'to')
                                )), '[]'::jsonb)
                           from jsonb_array_elements(t.availability) w
                          where jsonb_typeof(w) = 'object'
                            and jsonb_exists(w, 'weekday')
                            and coalesce(w->>'start_local', w->>'from') is not null
                            and coalesce(w->>'end_local', w->>'to') is not null
                       )
                 where exists (
                         select 1
                           from jsonb_array_elements(t.availability) w
                          where jsonb_typeof(w) <> 'object'
                             or not (jsonb_exists(w, 'start_local') and jsonb_exists(w, 'end_local') and jsonb_exists(w, 'weekday'))
                       )
            SQL);
        }

        DB::statement("select set_config('app.current_academy_id', '', true)");
    }

    public function down(): void
    {
        // Nothing to restore: the `from`/`to` shape was never valid.
    }
};
