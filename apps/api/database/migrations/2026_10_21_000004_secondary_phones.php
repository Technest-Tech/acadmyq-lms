<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A second, optional number for a student and for a parent — the other parent's mobile, a home
 * line. Contact only: every message, report and invoice link still goes to `whatsapp_phone`.
 * Stored E.164 like the first (App\Support\Phone), and searchable wherever the first one is.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table guardians add column secondary_phone text;
            alter table students  add column secondary_phone text;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table students  drop column if exists secondary_phone;
            alter table guardians drop column if exists secondary_phone;
        SQL);
    }
};
