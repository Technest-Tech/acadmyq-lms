<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Per-academy teacher specializations — a small tenant-scoped catalog managed from the
 * Settings page. Teachers pick their specialization from this list (the field on `teachers`
 * stays free-text for back-compat; this table is the source for the dropdown).
 *
 * Carries `academy_id`, so it gets the SAME standard tenant_isolation RLS policy as every
 * other tenant table (mirrors the block in 2026_06_11_000010_rls_policies.php) — applied
 * inline here so migrate:fresh stays self-contained.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table specializations (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id),
              name        text not null,
              is_active   boolean not null default true,
              sort_order  integer not null default 0,
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now(),
              unique (academy_id, name)
            );
            create index specializations_academy_idx on specializations (academy_id);

            alter table specializations enable row level security;
            alter table specializations force row level security;
            create policy tenant_isolation on specializations
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on specializations;
            drop table if exists specializations;
        SQL);
    }
};
