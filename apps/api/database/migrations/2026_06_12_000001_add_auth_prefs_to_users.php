<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Sprint 2 §7 — additive auth/preference columns on `users`:
 *
 *  - preferred_locale: persists the per-user language choice (R-LOC-1). Default 'ar'
 *    so a brand-new user lands in Arabic/RTL (Sprint 0 AC-0.3 default).
 *  - last_login_at: stamped on each successful login (and audited).
 *
 * Both are nullable/defaulted so the change is backwards compatible with rows the
 * Sprint 1 seeder already wrote.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table users
              add column preferred_locale text not null default 'ar',
              add column last_login_at    timestamptz;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table users
              drop column if exists last_login_at,
              drop column if exists preferred_locale;
        SQL);
    }
};
