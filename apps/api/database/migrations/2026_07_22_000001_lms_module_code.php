<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Register LMS as a fifth sellable module (docs/lms): widen the `module` check constraints on
 * `plans` and `module_subscriptions` so a plan can belong to the LMS module and a client can
 * hold a live LMS subscription. Everything else (ModuleBilling lifecycle, Entitlement union,
 * per-module suspension) is already generic over the module code — this is the single
 * data-shape change that admits the new value.
 *
 * Same shape as 2026_07_17_000001_crm_module_code: the original constraints were created inline
 * (auto-generated names), so each is located through pg_constraint by its definition rather than
 * assuming a name, then re-created under an explicit name that down() can address.
 */
return new class extends Migration
{
    public function up(): void
    {
        $this->replaceModuleConstraint('plans', "('MANAGEMENT','WHATSAPP','VIDEO','CRM','LMS')");
        $this->replaceModuleConstraint('module_subscriptions', "('MANAGEMENT','WHATSAPP','VIDEO','CRM','LMS')");
    }

    public function down(): void
    {
        // Restore the four-value constraints. Fails if LMS rows still exist — remove those first.
        $this->replaceModuleConstraint('plans', "('MANAGEMENT','WHATSAPP','VIDEO','CRM')");
        $this->replaceModuleConstraint('module_subscriptions', "('MANAGEMENT','WHATSAPP','VIDEO','CRM')");
    }

    /** Drop whichever check constraint(s) govern `module` on $table, then add the named one. */
    private function replaceModuleConstraint(string $table, string $allowed): void
    {
        DB::unprepared(<<<SQL
            do \$\$
            declare c record;
            begin
              for c in
                select conname from pg_constraint
                 where conrelid = '{$table}'::regclass
                   and contype = 'c'
                   and pg_get_constraintdef(oid) ilike '%module%'
              loop
                execute format('alter table {$table} drop constraint %I', c.conname);
              end loop;
            end \$\$;
            alter table {$table} add constraint {$table}_module_check
              check (module in {$allowed});
        SQL);
    }
};
