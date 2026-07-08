<?php

declare(strict_types=1);

use App\Support\ModuleSubscriptionBackfill;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Phase 1 (docs/superadmin-modules/01-DATA-MODEL §7) — derive `module_subscriptions` from the
 * current single-plan state for every existing academy, so Entitlement resolves identically once
 * Phase 2 flips the resolver (M-ENT-1 parity). The derivation + FORCE-RLS dance lives in the
 * re-runnable App\Support\ModuleSubscriptionBackfill (also called by the demo seeder and tests).
 *
 * On a fresh `migrate:fresh` this runs before any academy exists → it inserts nothing; the demo
 * seeder then produces the same rows for the seeded academies (AC-M1.3).
 */
return new class extends Migration
{
    public function up(): void
    {
        ModuleSubscriptionBackfill::run();
    }

    public function down(): void
    {
        // Remove all derived rows per-academy in its own context (no FORCE-RLS DDL — that would
        // poison a transaction when MigrationsRollbackTest re-runs this, M-PROC-2).
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
        foreach (DB::table('academies')->pluck('id')->all() as $id) {
            DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $id]);
            DB::table('module_subscriptions')->where('academy_id', $id)->delete();
        }
        DB::statement("select set_config('app.current_academy_id', '', true)");
    }
};
