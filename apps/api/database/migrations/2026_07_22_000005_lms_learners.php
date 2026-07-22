<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * LMS phase 2 — the learner actor (docs/lms/02-LEARNER-AUTH-AND-SUBDOMAINS) and the per-academy
 * subdomain that routes to the public course site.
 *
 * `learners` is a SEPARATE identity from staff `users` and from `students`: a self-registered
 * person who logs in on `<academy>.<platform>`, authenticated by a Sanctum bearer token (not the
 * staff SPA session). Email is unique PER academy — the same person can be a learner at two
 * academies. RLS tenant_isolation scopes it, and because the academy is known from the SUBDOMAIN
 * before any learner operation, every learner read/write runs under normal context (no bypass
 * provider needed, unlike staff login).
 *
 * The public handle is the EXISTING `academies.subdomain` (already unique + Super-Admin-provisioned,
 * reused from the video join-slug links) — no new column. Resolving that handle → academy_id is the
 * ONE thing that happens before context exists (the request arrives knowing only the subdomain), so
 * it gets a SECURITY DEFINER bypass function mirroring app.auth_* (2026_06_12_000002).
 */
return new class extends Migration
{
    private function role(string $key): string
    {
        $role = (string) config("database.rls.{$key}");
        if (! preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $role)) {
            throw new RuntimeException("Invalid RLS role identifier for {$key}: {$role}");
        }

        return $role;
    }

    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table learners (
              id                uuid primary key default uuid_generate_v7(),
              academy_id        uuid not null references academies(id) on delete cascade,
              email             text not null,
              password          text not null,
              full_name         text not null,
              phone             text,
              email_verified_at timestamptz,
              status            text not null default 'ACTIVE' check (status in ('ACTIVE','BLOCKED')),
              last_login_at     timestamptz,
              created_at        timestamptz not null default now(),
              updated_at        timestamptz not null default now()
            );
            create unique index learners_academy_email_idx on learners (academy_id, lower(email));

            alter table learners enable row level security;
            alter table learners force row level security;
            create policy tenant_isolation on learners
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        $bypass = $this->role('bypass_role');
        $app = $this->role('app_role');

        // The definer role can already read academies (Sprint 1 admin functions); grant is idempotent.
        DB::unprepared("grant select on academies to {$bypass};");

        DB::unprepared(<<<'SQL'
            create or replace function app.lms_academy_by_subdomain(p_sub text)
            returns uuid
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare v_id uuid;
            begin
              select a.id into v_id
                from academies a
               where lower(a.subdomain) = lower(p_sub)
               limit 1;
              return v_id;
            end;
            $$;
        SQL);

        DB::unprepared("alter function app.lms_academy_by_subdomain(text) owner to {$bypass};");
        DB::unprepared('revoke all on function app.lms_academy_by_subdomain(text) from public;');
        DB::unprepared("grant execute on function app.lms_academy_by_subdomain(text) to {$app};");
    }

    public function down(): void
    {
        DB::unprepared('drop function if exists app.lms_academy_by_subdomain(text);');
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on learners;
            drop table if exists learners;
        SQL);
    }
};
