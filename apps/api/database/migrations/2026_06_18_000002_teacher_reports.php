<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Internal performance reports written ABOUT a teacher by the academy (owner/support) — e.g. an
 * incident when the teacher did something wrong, a note, or praise. Distinct from the per-session
 * lesson reports the teacher writes for students. Tenant-scoped; gets the standard tenant_isolation
 * RLS policy (mirrors 2026_06_11_000010_rls_policies.php), applied inline so migrate:fresh stays
 * self-contained.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table teacher_reports (
              id             uuid primary key default uuid_generate_v7(),
              academy_id     uuid not null references academies(id),
              teacher_id     uuid not null references teachers(id),
              author_user_id uuid references users(id),
              author_name    text,
              kind           text not null default 'NOTE',
              body           text not null,
              created_at     timestamptz not null default now(),
              updated_at     timestamptz not null default now()
            );
            create index teacher_reports_teacher_idx
              on teacher_reports (academy_id, teacher_id, created_at desc);

            alter table teacher_reports enable row level security;
            alter table teacher_reports force row level security;
            create policy tenant_isolation on teacher_reports
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on teacher_reports;
            drop table if exists teacher_reports;
        SQL);
    }
};
