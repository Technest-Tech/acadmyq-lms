<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Two more context-free identity reads/writes, in the mould of 000002_auth_rls_bypass_functions:
 *
 *   app.auth_set_password(uuid, text) — write a new password hash for a user. Both callers run with
 *       NO tenant context: the forgot-password reset (nobody is signed in) and a signed-in user
 *       changing their own password (a TEACHER's context cannot update `users`, and it should not
 *       be able to — this function writes exactly one column of exactly one row).
 *   app.auth_role_active(text)        — is this role code assignable right now? System roles always
 *       are; a custom role (`CR_…`) only while `academy_roles.is_active`. Read at login and on every
 *       request by the tenant middleware, i.e. before any context exists, so it bypasses RLS like
 *       app.role_capabilities does. Without it a deactivated custom role resolved to an EMPTY
 *       capability set and its holder signed in to a blank panel with no explanation.
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

        DB::unprepared(<<<'SQL'
            create or replace function app.auth_set_password(p_id uuid, p_hash text)
            returns void
            language plpgsql volatile security definer
            set search_path = public, app
            as $$
            begin
              update users set password = p_hash, updated_at = now() where id = p_id;
            end;
            $$;

            create or replace function app.auth_role_active(p_role text)
            returns boolean
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare v boolean;
            begin
              if left(p_role, 3) <> 'CR_' then
                return true;
              end if;
              select ar.is_active into v from academy_roles ar where ar.code = p_role;
              return coalesce(v, false);
            end;
            $$;
        SQL);

        foreach (['app.auth_set_password(uuid, text)', 'app.auth_role_active(text)'] as $sig) {
            DB::unprepared("alter function {$sig} owner to {$bypass};");
            DB::unprepared("revoke all on function {$sig} from public;");
            DB::unprepared("grant execute on function {$sig} to {$app};");
        }
    }

    public function down(): void
    {
        DB::unprepared('drop function if exists app.auth_set_password(uuid, text);');
        DB::unprepared('drop function if exists app.auth_role_active(text);');
    }
};
