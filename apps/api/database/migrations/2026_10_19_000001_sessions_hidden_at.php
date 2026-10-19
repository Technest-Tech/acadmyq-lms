<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `sessions.hidden_at` — the lesson no longer appears on the planning surfaces (the calendar and
 * the attendance page with its overdue / pending lists). Set on EVERY lesson of a student the
 * moment they are deactivated or removed, past and pending alike, and never cleared: a student who
 * is reactivated starts over with a clean calendar instead of their old lessons reappearing.
 *
 * It is a display flag only. The rows stay exactly as they were, so invoices, payroll, packages and
 * the student's own history still see them.
 *
 * Every student who is ALREADY inactive gets their lessons hidden here, stamped with the moment
 * they left. Every tenant table is under FORCE row-level security, so the backfill runs academy by
 * academy with the tenant GUC set (the pattern of 2026_10_06_000002_student_multiple_teachers).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('alter table sessions add column if not exists hidden_at timestamptz');

        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        foreach (DB::table('academies')->pluck('id')->all() as $id) {
            DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $id]);

            DB::statement(<<<'SQL'
                update sessions se
                   set hidden_at = st.deleted_at
                  from students st
                 where st.id = se.student_id
                   and st.deleted_at is not null
                   and se.hidden_at is null
            SQL);
        }

        DB::statement("select set_config('app.current_academy_id', '', true)");
    }

    public function down(): void
    {
        DB::statement('alter table sessions drop column if exists hidden_at');
    }
};
