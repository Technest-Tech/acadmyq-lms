<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Sprint 5 §7 — schema deltas that make session generation idempotent and auditable.
 *
 *  - `sessions.occurrence_local_date date` — the local calendar date an occurrence belongs to;
 *    the human-meaningful key that survives DST (a "5pm Cairo on the 12th" row, not a UTC
 *    instant). NULL for ad-hoc / reschedule successors. Part of the idempotency key (§4.4).
 *  - `sessions.slot_id uuid → schedule_slots(id)` — which slot produced the row. NULL for
 *    ad-hoc / reschedule successors. Second component of the idempotency key.
 *  - `sessions_unique_occurrence` — a PARTIAL unique index on
 *    (schedule_id, occurrence_local_date, slot_id) WHERE schedule_id is not null. This is the
 *    database backstop that makes the generator safe to re-run and safe under concurrency
 *    (TC-5.5/5.7): two identical occurrences can never both insert. Ad-hoc rows (schedule_id
 *    null) are exempt, so an academy can have many one-offs without colliding.
 *  - `schedules.version int` — bumped whenever the template is edited; lets audit/debug trace
 *    which version of a template produced a given run (§7).
 *
 * Raw DDL (DB::unprepared) because a Postgres PARTIAL unique index has no first-class Blueprint
 * API, matching the Sprint 1/3/4 migration style. RLS already covers the sessions table
 * (the tenant_isolation policy from 2026_06_11_000010), so no policy work is needed here.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table sessions
              add column occurrence_local_date date,
              add column slot_id               uuid references schedule_slots(id);

            -- Idempotency key (§4.4): a schedule-derived occurrence is unique by its source
            -- schedule, its local date, and the slot that produced it. Partial so ad-hoc rows
            -- (schedule_id null) and reschedule successors are never constrained.
            create unique index sessions_unique_occurrence
              on sessions (schedule_id, occurrence_local_date, slot_id)
              where schedule_id is not null;

            alter table schedules
              add column version int not null default 1;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table schedules drop column if exists version;
            drop index if exists sessions_unique_occurrence;
            alter table sessions
              drop column if exists slot_id,
              drop column if exists occurrence_local_date;
        SQL);
    }
};
