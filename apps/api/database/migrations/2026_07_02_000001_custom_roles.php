<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Custom academy roles — the "let academies define their own roles" half of the staff/RBAC
 * design. The platform owns the PERMISSION catalog (permissions / role_permissions, edited
 * only by Super Admin); an academy composes its own ROLES from that catalog and assigns them
 * to its employees. Gated behind the `custom_roles` plan capability (FeatureCatalog).
 *
 * Design constraints honoured here:
 *  - System roles (SUPER_ADMIN / ACADEMY_OWNER / TEACHER / STAFF) are global and stay in the
 *    `role_permissions` catalog. They are NOT touched — RLS, the GUCs and the auth functions
 *    keep working unchanged because the role still travels everywhere as a string CODE.
 *  - Custom roles are TENANT-SCOPED (own RLS) with a globally-unique `code` so the same value
 *    can be stored in `user_roles.role` / the `app.current_role` GUC with zero collision.
 *  - `user_roles.role` and `audit_log.actor_role` move off the `app_role` enum to TEXT so a
 *    custom code (never a member of the enum) can be assigned and audited. `role_permissions`
 *    keeps the enum — only system roles ever live there.
 *  - Permission resolution must run BEFORE the tenant GUCs are set (it builds the AuthContext),
 *    so custom-role capabilities are read through a BYPASSRLS SECURITY DEFINER function, the
 *    same escape-hatch pattern as app.auth_user_roles (Sprint 2 §7).
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

        // --- tenant-scoped custom-role tables --------------------------------
        DB::unprepared(<<<'SQL'
            create table academy_roles (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id) on delete cascade,
              -- Globally-unique stable code stored in user_roles.role + the app.current_role
              -- GUC. Generated, not user-entered, so it never collides with a system code.
              code        text not null unique,
              name        text not null,           -- display name the academy chooses
              description text,
              is_active   boolean not null default true,
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now(),
              unique (academy_id, name)
            );
            create index academy_roles_academy_idx on academy_roles (academy_id);

            create table academy_role_permissions (
              academy_id    uuid not null references academies(id) on delete cascade,
              role_id       uuid not null references academy_roles(id) on delete cascade,
              permission_id uuid not null references permissions(id) on delete cascade,
              primary key (role_id, permission_id)
            );
            create index academy_role_permissions_academy_idx on academy_role_permissions (academy_id);
        SQL);

        // RLS: both tables are tenant-scoped (same standard policy as the other tenant tables).
        // FORCE because the app connects as the table owner, which is otherwise RLS-exempt.
        DB::unprepared(<<<'SQL'
            alter table academy_roles enable row level security;
            alter table academy_roles force row level security;
            create policy tenant_isolation on academy_roles
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            alter table academy_role_permissions enable row level security;
            alter table academy_role_permissions force row level security;
            create policy tenant_isolation on academy_role_permissions
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        // --- carry custom codes: enum → text on the two role-bearing columns -
        DB::unprepared(<<<'SQL'
            alter table user_roles alter column role type text using role::text;
            alter table audit_log  alter column actor_role type text using actor_role::text;
        SQL);

        // --- unified capability resolver (system + custom), BYPASSRLS --------
        // PermissionResolver calls this while building the AuthContext, i.e. before the tenant
        // GUCs are set, so it must bypass RLS. SECURITY DEFINER + ownership by the bypass role
        // (granted below) gives it that, exactly like app.auth_user_roles. The whole body is
        // the allow-list: it returns only capability codes for the one role code passed in.
        DB::unprepared(<<<'SQL'
            create or replace function app.role_capabilities(p_role text)
            returns table (code text)
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            begin
              return query
                -- System roles live in the platform catalog (role_permissions is app_role enum;
                -- a custom code simply never matches here).
                select p.code::text
                from role_permissions rp
                join permissions p on p.id = rp.permission_id
                where rp.role::text = p_role
                union
                -- Custom roles live per-academy; the code is globally unique so no tenant
                -- predicate is needed to disambiguate.
                select p.code::text
                from academy_role_permissions arp
                join academy_roles ar on ar.id = arp.role_id
                join permissions p on p.id = arp.permission_id
                where ar.code = p_role and ar.is_active = true;
            end;
            $$;
        SQL);

        // The definer (BYPASSRLS) role needs table SELECT privileges in addition to bypassing
        // RLS, and must OWN the function for SECURITY DEFINER to run with its rights.
        DB::unprepared("grant select on permissions, role_permissions, academy_roles, academy_role_permissions to {$bypass};");
        DB::unprepared("alter function app.role_capabilities(text) owner to {$bypass};");
        DB::unprepared('revoke all on function app.role_capabilities(text) from public;');
        DB::unprepared("grant execute on function app.role_capabilities(text) to {$app};");
    }

    public function down(): void
    {
        DB::unprepared('drop function if exists app.role_capabilities(text);');

        // Revert the columns to the enum. Only valid if no custom codes remain assigned
        // (delete custom roles first) — acceptable for a down migration.
        DB::unprepared(<<<'SQL'
            alter table user_roles alter column role type app_role using role::app_role;
            alter table audit_log  alter column actor_role type app_role using actor_role::app_role;
        SQL);

        DB::unprepared(<<<'SQL'
            drop table if exists academy_role_permissions;
            drop table if exists academy_roles;
        SQL);
    }
};
