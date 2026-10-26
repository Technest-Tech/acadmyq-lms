<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * New terms that start with the NEXT block, not this one. Editing a running package used to change
 * it (and its bill) on the spot, and the renewal then copied it — so "the price goes up from next
 * month" also re-priced the block the family was already in the middle of. The edit form now asks;
 * "from the next renewal" parks the new label / hours / price here, the running block and its bill
 * stay as they are, and the automatic renewal opens the next block on these terms.
 *
 * {label?, minutes_total?, price_minor?} — only what differs from the running block; null = none.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('alter table lesson_packages add column next_terms jsonb');
    }

    public function down(): void
    {
        DB::statement('alter table lesson_packages drop column if exists next_terms');
    }
};
