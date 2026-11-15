<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Handing a supervisor's people to another supervisor (2026-11-15: a supervisor who had added
 * about ten teachers left, and the academy wanted them followed by someone else).
 *
 * Who answers for a student, teacher or parent is read as whoever ADDED them — the first
 * `<entity>.create` entry in the audit log ({@see App\Support\DoneBy}). The audit log is history and
 * is never rewritten, so a handover is written here instead: one row per handed-over record,
 * naming the supervisor who answers for it now. No row = still whoever added it, which is every
 * record today. A record handed over twice keeps one row, the latest.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table if not exists supervisor_assignments (
              id           uuid primary key default uuid_generate_v7(),
              academy_id   uuid not null references academies(id) on delete cascade,
              entity_type  text not null check (entity_type in ('student', 'teacher', 'guardian')),
              entity_id    uuid not null,
              user_id      uuid not null references users(id) on delete cascade,
              assigned_by  uuid references users(id) on delete set null,
              created_at   timestamptz not null default now(),
              updated_at   timestamptz not null default now(),
              unique (academy_id, entity_type, entity_id)
            );
            create index if not exists supervisor_assignments_user_idx on supervisor_assignments (academy_id, user_id);

            alter table supervisor_assignments enable row level security;
            alter table supervisor_assignments force row level security;
            drop policy if exists tenant_isolation on supervisor_assignments;
            create policy tenant_isolation on supervisor_assignments
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on supervisor_assignments;
            drop table if exists supervisor_assignments;
        SQL);
    }
};
