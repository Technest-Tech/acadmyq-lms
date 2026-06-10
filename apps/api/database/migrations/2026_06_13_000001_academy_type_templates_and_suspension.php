<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Sprint 3 §6 — the small schema deltas academy management needs on top of Sprint 1:
 *
 *  - `academy_types.report_field_template jsonb` — the ordered list of report-field
 *    definitions a new academy of this type is seeded with at provisioning (§5). Storing
 *    the template as data is what makes "add a new academy type" a pure catalog change with
 *    no code touch to the report engine (R-CRF, TC-3.27/3.28).
 *  - `academies.suspended_at` / `suspended_reason` — audit/clarity on the suspend lifecycle
 *    (§4.3); a suspended academy retains all data, only logins are blocked (AC-3.6).
 *  - `users.invited_at` — stamped when the Super Admin provisions a first-owner login that
 *    still needs a set-password (§3.4); the set-password email is the only post-commit step.
 *  - A format check on `academies.subdomain` so the reserved branding field is unique AND a
 *    DNS-safe lowercase label from day one (R-BRA-1, AC-3.7) — Sprint 12 is then pure
 *    activation with zero data cleanup. (Uniqueness already exists from Sprint 1.)
 *  - `app.auth_academy_status(uuid)` — a BYPASSRLS reader so the no-context login/auth path
 *    can tell whether a user's academy is SUSPENDED and fail the login closed (AC-3.6),
 *    mirroring the Sprint 2 auth-function pattern.
 *  - An extended `app.admin_list_academies()` returning the platform-list columns the Super
 *    Admin view needs (status, plan, currency, grouping, counts — §7).
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
        $bypass = $this->role('bypass_role');
        $app = $this->role('app_role');

        // --- schema deltas ---------------------------------------------------
        DB::unprepared(<<<'SQL'
            alter table academy_types
              add column report_field_template jsonb not null default '[]'::jsonb;

            alter table academies
              add column suspended_at     timestamptz,
              add column suspended_reason text;

            alter table users
              add column invited_at timestamptz;

            -- DNS label: lowercase alnum, internal hyphens only, <= 63 chars (R-BRA-1).
            alter table academies
              add constraint academies_subdomain_format_chk
              check (
                subdomain is null
                or (subdomain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' and length(subdomain) <= 63)
              );
        SQL);

        // --- suspension-aware login reader (BYPASSRLS) -----------------------
        // academies is RLS-protected and login runs with no context; this is the only
        // sanctioned no-context way to read an academy's status. NULL when no such academy
        // (e.g. SUPER_ADMIN, academy_id IS NULL) → callers treat NULL as "not suspended".
        DB::unprepared(<<<'SQL'
            create or replace function app.auth_academy_status(p_id uuid)
            returns text
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare s text;
            begin
              select a.status::text into s from academies a where a.id = p_id;
              return s;
            end;
            $$;
        SQL);

        // --- extended platform academy list (§7) -----------------------------
        // The definer bypasses RLS but still needs table-level SELECT on the tables it now
        // joins/counts (plans, teachers) in addition to the Sprint 1 grants.
        DB::unprepared("grant select on plans, teachers to {$bypass};");
        DB::unprepared(<<<'SQL'
            create or replace function app.admin_list_academies()
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.admin_list_academies requires SUPER_ADMIN';
              end if;
              return (
                select coalesce(jsonb_agg(jsonb_build_object(
                  'id', a.id,
                  'name', a.name,
                  'status', a.status,
                  'academy_type_id', a.academy_type_id,
                  'plan_id', a.plan_id,
                  'plan_code', p.code,
                  'default_currency', a.default_currency,
                  'timezone', a.timezone,
                  'invoice_grouping', a.invoice_grouping,
                  'billing_day', a.billing_day,
                  'subdomain', a.subdomain,
                  'student_count', (select count(*) from students s where s.academy_id = a.id),
                  'teacher_count', (select count(*) from teachers t where t.academy_id = a.id),
                  'created_at', a.created_at
                ) order by a.name), '[]'::jsonb)
                from academies a
                left join plans p on p.id = a.plan_id
              );
            end;
            $$;
        SQL);
        DB::unprepared("alter function app.admin_list_academies() owner to {$bypass};");
        DB::unprepared('revoke all on function app.admin_list_academies() from public;');
        DB::unprepared("grant execute on function app.admin_list_academies() to {$app};");

        foreach (['app.auth_academy_status(uuid)'] as $sig) {
            DB::unprepared("alter function {$sig} owner to {$bypass};");
            DB::unprepared("revoke all on function {$sig} from public;");
            DB::unprepared("grant execute on function {$sig} to {$app};");
        }
    }

    public function down(): void
    {
        $bypass = $this->role('bypass_role');
        $app = $this->role('app_role');

        DB::unprepared('drop function if exists app.auth_academy_status(uuid);');

        // Restore the Sprint 1 (narrow) academy-list function definition.
        DB::unprepared(<<<'SQL'
            create or replace function app.admin_list_academies()
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.admin_list_academies requires SUPER_ADMIN';
              end if;
              return (
                select coalesce(jsonb_agg(jsonb_build_object(
                  'id', a.id, 'name', a.name, 'status', a.status,
                  'default_currency', a.default_currency, 'timezone', a.timezone
                ) order by a.name), '[]'::jsonb)
                from academies a
              );
            end;
            $$;
        SQL);
        DB::unprepared("alter function app.admin_list_academies() owner to {$bypass};");
        DB::unprepared('revoke all on function app.admin_list_academies() from public;');
        DB::unprepared("grant execute on function app.admin_list_academies() to {$app};");

        DB::unprepared(<<<'SQL'
            alter table academies drop constraint if exists academies_subdomain_format_chk;
            alter table users drop column if exists invited_at;
            alter table academies
              drop column if exists suspended_reason,
              drop column if exists suspended_at;
            alter table academy_types drop column if exists report_field_template;
        SQL);
    }
};
