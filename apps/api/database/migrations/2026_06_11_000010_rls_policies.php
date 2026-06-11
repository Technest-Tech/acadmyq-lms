<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Row-Level Security (§7). This is where tenant isolation becomes a database guarantee,
 * not an app convention:
 *
 *  - Every tenant-scoped table gets RLS ENABLED + FORCED and the identical standard
 *    policy `academy_id = app.current_academy_id()` on both `using` (reads) and
 *    `with check` (writes). FORCE is essential because the app connects as the table
 *    OWNER (academiq_app); without FORCE the owner is exempt.
 *  - Platform catalog tables: readable by all, writable only by Super Admin.
 *  - `academies`: a row is readable to its own tenant or to a Super Admin; only a
 *    Super Admin may write.
 *  - `audit_log`: insert + tenant-scoped select only → append-only by absence of any
 *    update/delete policy under FORCE RLS (R-AUD-1).
 *  - Two SECURITY DEFINER "escape hatches" owned by the BYPASSRLS role: the audited
 *    super-admin academy list (§7.4) and the public invoice-by-token lookup (§7.6).
 *    They are plpgsql (late-binding) so they record no hard dependency on the tables
 *    they read — which keeps migrate:fresh clean.
 */
return new class extends Migration
{
    /** Tables carrying academy_id that get the identical standard tenant policy. */
    private const TENANT_TABLES = [
        'users', 'user_roles', 'teachers', 'guardians', 'students',
        'student_teacher_assignments', 'subscriptions', 'report_field_definitions',
        'schedules', 'schedule_slots', 'sessions', 'session_reports',
        'invoices', 'invoice_line_items', 'payouts', 'payout_line_items',
    ];

    /** Shared read catalog: readable by all, writable only by Super Admin. */
    private const PLATFORM_TABLES = [
        'plans', 'add_ons', 'academy_types', 'permissions', 'role_permissions',
    ];

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

        // --- Standard tenant policy on every tenant-scoped table -------------
        $tenant = "array['".implode("','", self::TENANT_TABLES)."']";
        DB::unprepared(<<<SQL
            do \$\$
            declare t text;
            begin
              foreach t in array {$tenant} loop
                execute format('alter table %I enable row level security', t);
                execute format('alter table %I force row level security', t);
                execute format(
                  'create policy tenant_isolation on %I '
                  'using (academy_id = app.current_academy_id()) '
                  'with check (academy_id = app.current_academy_id())', t);
              end loop;
            end \$\$;
        SQL);

        // --- Platform catalog: read-all, write-super-admin ------------------
        $platform = "array['".implode("','", self::PLATFORM_TABLES)."']";
        DB::unprepared(<<<SQL
            do \$\$
            declare t text;
            begin
              foreach t in array {$platform} loop
                execute format('alter table %I enable row level security', t);
                execute format('alter table %I force row level security', t);
                execute format('create policy catalog_select on %I for select using (true)', t);
                execute format(
                  'create policy catalog_mutate on %I for all '
                  'using (app.is_super_admin()) with check (app.is_super_admin())', t);
              end loop;
            end \$\$;
        SQL);

        // --- academies: own-row read OR super admin; write super-admin only --
        DB::unprepared(<<<'SQL'
            alter table academies enable row level security;
            alter table academies force row level security;
            create policy academies_select on academies for select
              using (id = app.current_academy_id() or app.is_super_admin());
            create policy academies_insert on academies for insert
              with check (app.is_super_admin());
            create policy academies_update on academies for update
              using (app.is_super_admin()) with check (app.is_super_admin());
            create policy academies_delete on academies for delete
              using (app.is_super_admin());
        SQL);

        // --- audit_log: append-only (insert + tenant-scoped select only) ----
        DB::unprepared(<<<'SQL'
            alter table audit_log enable row level security;
            alter table audit_log force row level security;
            create policy audit_insert on audit_log for insert with check (true);
            create policy audit_select on audit_log for select
              using (academy_id = app.current_academy_id());
            -- No update/delete policy → those are denied under FORCE RLS (R-AUD-1).
        SQL);

        // --- Escape hatch 1: audited super-admin academy list (§7.4) --------
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

        // --- Escape hatch 2: public invoice by exact token (§7.6) -----------
        // SECURITY DEFINER bypasses RLS, but the whole body is the allow-list: a single
        // equality on public_token, returning only a curated display payload (never raw
        // tenant rows, never a list). Returns NULL on no match → 404 with no enumeration.
        // DROP first so that migrate:fresh (which drops tables but not functions) never
        // hits a return-type mismatch when Sprint 7 migration 12 upgrades the function.
        DB::unprepared('drop function if exists app.public_invoice_by_token(text);');
        DB::unprepared(<<<'SQL'
            create or replace function app.public_invoice_by_token(p_token text)
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare result jsonb;
            begin
              select jsonb_build_object(
                'academy_name', a.name,
                'payer_name', coalesce(g.full_name, s.full_name),
                'period_year', i.period_year,
                'period_month', i.period_month,
                'status', i.status,
                'currency', i.currency,
                'subtotal_minor', i.subtotal_minor,
                'total_minor', i.total_minor,
                'line_items', (
                  select coalesce(jsonb_agg(jsonb_build_object(
                    'date', li.created_at::date,
                    'description', li.description,
                    'amount_minor', li.amount_minor
                  ) order by li.created_at), '[]'::jsonb)
                  from invoice_line_items li where li.invoice_id = i.id
                )
              )
              into result
              from invoices i
              join academies a on a.id = i.academy_id
              left join guardians g on g.id = i.guardian_id
              left join students s on s.id = i.student_id
              where i.public_token = p_token;

              return result;  -- NULL when no row matched
            end;
            $$;
        SQL);

        // The definer role bypasses RLS but still needs table-level SELECT grants, and
        // it must own the functions for SECURITY DEFINER to run with its (bypassing) rights.
        DB::unprepared(sprintf(
            'grant select on academies, invoices, invoice_line_items, guardians, students to %s;',
            $bypass
        ));
        DB::unprepared("alter function app.admin_list_academies() owner to {$bypass};");
        DB::unprepared("alter function app.public_invoice_by_token(text) owner to {$bypass};");

        // Lock down execute: only the app role may call them (revoke the PUBLIC default).
        DB::unprepared('revoke all on function app.admin_list_academies() from public;');
        DB::unprepared('revoke all on function app.public_invoice_by_token(text) from public;');
        DB::unprepared("grant execute on function app.admin_list_academies() to {$app};");
        DB::unprepared("grant execute on function app.public_invoice_by_token(text) to {$app};");
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop function if exists app.public_invoice_by_token(text);
            drop function if exists app.admin_list_academies();
        SQL);

        $all = array_merge(self::TENANT_TABLES, ['audit_log']);
        $tenant = "array['".implode("','", $all)."']";
        DB::unprepared(<<<SQL
            do \$\$
            declare t text;
            begin
              foreach t in array {$tenant} loop
                execute format('drop policy if exists tenant_isolation on %I', t);
                execute format('alter table %I disable row level security', t);
              end loop;
            end \$\$;
        SQL);

        DB::unprepared(<<<'SQL'
            drop policy if exists audit_insert on audit_log;
            drop policy if exists audit_select on audit_log;
            drop policy if exists academies_select on academies;
            drop policy if exists academies_insert on academies;
            drop policy if exists academies_update on academies;
            drop policy if exists academies_delete on academies;
            alter table academies disable row level security;
        SQL);

        $platform = "array['".implode("','", self::PLATFORM_TABLES)."']";
        DB::unprepared(<<<SQL
            do \$\$
            declare t text;
            begin
              foreach t in array {$platform} loop
                execute format('drop policy if exists catalog_select on %I', t);
                execute format('drop policy if exists catalog_mutate on %I', t);
                execute format('alter table %I disable row level security', t);
              end loop;
            end \$\$;
        SQL);
    }
};
