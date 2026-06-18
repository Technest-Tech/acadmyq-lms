<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Add PER_HOUR to the allowed subscription price bases. The hourly rate lives in
 * subscriptions.price_minor and each session's invoice line is billed rate × hours
 * (Invoicing::resolvePerSessionAmount).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table subscriptions drop constraint if exists subscriptions_price_basis_chk;
            alter table subscriptions add constraint subscriptions_price_basis_chk
              check (price_basis in ('PER_SESSION','PER_MONTH','PER_HOUR'));
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table subscriptions drop constraint if exists subscriptions_price_basis_chk;
            alter table subscriptions add constraint subscriptions_price_basis_chk
              check (price_basis in ('PER_SESSION','PER_MONTH'));
        SQL);
    }
};
