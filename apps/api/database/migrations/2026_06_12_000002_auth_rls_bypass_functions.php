<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Sprint 2 — the login-under-RLS escape hatch.
 *
 * The auth lookup is a chicken-and-egg problem: to set the tenant context we must first
 * know *who* is logging in, but `users` / `user_roles` are themselves RLS-protected, so a
 * plain `select` with no context set matches zero rows and every login fails. Sprint 1
 * solved the analogous cross-tenant read with SECURITY DEFINER functions owned by the
 * BYPASSRLS role (app.admin_list_academies / app.public_invoice_by_token, §7). We reuse
 * exactly that pattern for the four narrow, audited operations the auth layer needs:
 *
 *   app.auth_find_by_email(text)  — credential lookup for Auth::attempt (login).
 *   app.auth_find_by_id(uuid)     — session resumption (the guard's retrieveById on every
 *                                   authenticated request, which also runs before context
 *                                   is set).
 *   app.auth_user_roles(uuid)     — resolve a user's (role, academy_id) assignments so the
 *                                   middleware can build the tenant context.
 *   app.auth_touch_last_login(uuid) — stamp last_login_at at login time (a write to the
 *                                   RLS-protected users table that has no context yet).
 *
 * Each is SECURITY DEFINER, owned by the BYPASSRLS role, plpgsql (late-binding → no hard
 * table dependency, keeps migrate:fresh clean), and EXECUTE-locked to the app role only.
 * These four functions are the ONLY sanctioned no-context entry points into the identity
 * tables; everything else flows through TenantContextMiddleware / Tenancy::withContext.
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

        // The definer (BYPASSRLS) role needs table privileges in addition to bypassing RLS.
        DB::unprepared("grant select, update on users to {$bypass};");
        DB::unprepared("grant select on user_roles to {$bypass};");

        // --- credential / identity lookups ----------------------------------
        // Return the curated auth columns (never via `setof users`, which would record a
        // hard dependency on the table type). plpgsql late-binds the body.
        DB::unprepared(<<<'SQL'
            create or replace function app.auth_find_by_email(p_email text)
            returns table (
              id uuid, academy_id uuid, full_name text, email text, password text,
              phone text, is_active boolean, preferred_locale text,
              last_login_at timestamptz, email_verified_at timestamptz, remember_token text
            )
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            begin
              return query
                select u.id, u.academy_id, u.full_name, u.email, u.password,
                       u.phone, u.is_active, u.preferred_locale,
                       u.last_login_at, u.email_verified_at, u.remember_token
                from users u
                where lower(u.email) = lower(p_email)
                limit 1;
            end;
            $$;

            create or replace function app.auth_find_by_id(p_id uuid)
            returns table (
              id uuid, academy_id uuid, full_name text, email text, password text,
              phone text, is_active boolean, preferred_locale text,
              last_login_at timestamptz, email_verified_at timestamptz, remember_token text
            )
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            begin
              return query
                select u.id, u.academy_id, u.full_name, u.email, u.password,
                       u.phone, u.is_active, u.preferred_locale,
                       u.last_login_at, u.email_verified_at, u.remember_token
                from users u
                where u.id = p_id
                limit 1;
            end;
            $$;

            create or replace function app.auth_user_roles(p_id uuid)
            returns table (role text, academy_id uuid)
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            begin
              return query
                select ur.role::text, ur.academy_id
                from user_roles ur
                where ur.user_id = p_id
                order by ur.created_at;
            end;
            $$;

            create or replace function app.auth_touch_last_login(p_id uuid)
            returns void
            language plpgsql volatile security definer
            set search_path = public, app
            as $$
            begin
              update users set last_login_at = now() where id = p_id;
            end;
            $$;
        SQL);

        foreach ([
            'app.auth_find_by_email(text)',
            'app.auth_find_by_id(uuid)',
            'app.auth_user_roles(uuid)',
            'app.auth_touch_last_login(uuid)',
        ] as $sig) {
            DB::unprepared("alter function {$sig} owner to {$bypass};");
            DB::unprepared("revoke all on function {$sig} from public;");
            DB::unprepared("grant execute on function {$sig} to {$app};");
        }
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop function if exists app.auth_touch_last_login(uuid);
            drop function if exists app.auth_user_roles(uuid);
            drop function if exists app.auth_find_by_id(uuid);
            drop function if exists app.auth_find_by_email(text);
        SQL);
    }
};
