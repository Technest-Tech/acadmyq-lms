<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Course pricing (docs/lms). A course is either free or sells for a one-off price the learner pays to
 * unlock it. We store the amount as integer minor units (Master Spec §6.3 — money is never a float),
 * denominated in the academy's `default_currency`: there is no per-course currency, a client sells in
 * its own currency, so the read side joins `academies.default_currency` rather than duplicating it
 * here. `price_minor = 0` means the course is free — the natural default, so every existing course
 * stays free until its owner sets a price.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table courses
              add column price_minor bigint not null default 0
                check (price_minor >= 0);
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table courses drop column if exists price_minor;
        SQL);
    }
};
