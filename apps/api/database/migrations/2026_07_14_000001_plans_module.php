<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Phase 1 (docs/superadmin-modules/01-DATA-MODEL §2.1) — scope every plan to a MODULE so the panel
 * can list plans per product and Entitlement can union capabilities across a client's module subs.
 *
 *   FREE / BASIC / PRO → MANAGEMENT (the default)   MEET → VIDEO   (WA_* seeded next as WHATSAPP)
 *
 * The `plans` catalog is super-admin-write under RLS, so the MEET update runs in a SUPER_ADMIN
 * context (set_config local=true → scoped to this migration's transaction), mirroring the MEET seed
 * migration. Adding the column is DDL (owner, RLS-exempt) so it needs no context; only the UPDATE does.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table plans add column if not exists module text not null default 'MANAGEMENT';
            alter table plans drop constraint if exists plans_module_chk;
            alter table plans add constraint plans_module_chk
              check (module in ('MANAGEMENT', 'WHATSAPP', 'VIDEO'));
        SQL);

        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
        DB::table('plans')->where('code', 'MEET')->update(['module' => 'VIDEO']);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table plans drop constraint if exists plans_module_chk;
            alter table plans drop column if exists module;
        SQL);
    }
};
