<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Sprint 6 §7 — schema deltas for attendance & custom reports. The heart logic (the §4
 * classification matrix, the billing hook) needs no new columns — `sessions.status` is the
 * single source of truth and `sessions.billed`/`paid_to_teacher` are the existing idempotency
 * guards (Sprint 1). What we add is provenance/audit metadata:
 *
 *  - `sessions.outcome_set_at timestamptz` / `outcome_set_by uuid → users(id)` — WHEN and by
 *    WHOM the billable/absent/cancel outcome was recorded (teacher or support, R-BIL-4),
 *    distinct from the row's creation by the generator (§7).
 *  - `session_reports.whatsapp_sent_at timestamptz` / `whatsapp_channel text` — when the manual
 *    report was marked sent and on which channel ('MANUAL_WHATSAPP' in the MVP). Automated
 *    delivery is Sprint 10; this only records that a human sent it (§6.4).
 *
 * `session_reports.session_id` is already UNIQUE (one report per session — Sprint 1 §6.5), so
 * no constraint work is needed here. RLS already covers both tables (tenant_isolation policy
 * from 2026_06_11_000010); these are plain columns under the existing policies.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table sessions
              add column outcome_set_at timestamptz,
              add column outcome_set_by uuid references users(id);

            alter table session_reports
              add column whatsapp_sent_at timestamptz,
              add column whatsapp_channel text;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table session_reports
              drop column if exists whatsapp_channel,
              drop column if exists whatsapp_sent_at;

            alter table sessions
              drop column if exists outcome_set_by,
              drop column if exists outcome_set_at;
        SQL);
    }
};
