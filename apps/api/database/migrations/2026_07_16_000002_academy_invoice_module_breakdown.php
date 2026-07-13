<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * R3 (docs/superadmin-modules/04-CLIENT-FIRST-REDESIGN) — M-BILL-1's "one invoice, per-module line
 * items" in lightweight form: each platform bill snapshots the client's per-module costs at
 * generation time as `module_breakdown` jsonb — [{module, total_minor, currency}] — so the panel
 * can show what a consolidated bill is made of without re-deriving from (possibly changed) live
 * subs. Nullable: bills that predate this, or bills for legacy-only academies, simply have none.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('academy_invoices', function (Blueprint $table) {
            $table->jsonb('module_breakdown')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('academy_invoices', function (Blueprint $table) {
            $table->dropColumn('module_breakdown');
        });
    }
};
