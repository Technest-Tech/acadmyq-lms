<?php

declare(strict_types=1);

use App\Support\TenantContext;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Each academy edits the shared built-in roles for itself (Team & permissions → Roles → Edit on
 * the Supervisor card): "our supervisors also mark bills paid", "ours do not touch packages".
 *
 *  1. `academy_role_tunings` — one row per (academy, built-in role) the academy has changed,
 *     holding only the DIFFERENCE from the platform's role: `added` and `removed` capability
 *     codes. Kept as a delta rather than a copy so everything the platform adds to the role later
 *     still reaches the academy's people, unless the academy took that very capability away.
 *     No row = the role exactly as shipped.
 *  2. `app.auth_role_tuning(academy, role)` — the BYPASSRLS reader: capabilities are resolved in
 *     TenantContextMiddleware before the tenant GUCs exist (same pattern as
 *     `app.auth_academy_settings`).
 *  3. The built-in SUPERVISOR now also runs the packages it sells and collects what is owed:
 *     invoice.read, invoice.create, invoice.mark_paid, invoice.send_link (package.* it already
 *     holds). An academy that does not want that takes it off its own supervisors with (1).
 *
 * The client purge discovers the table by its academy_id column; the FK cascades as well.
 */
return new class extends Migration
{
    private const SUPERVISOR_COLLECTS = ['invoice.read', 'invoice.create', 'invoice.mark_paid', 'invoice.send_link'];

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
            create table academy_role_tunings (
              academy_id  uuid not null references academies(id) on delete cascade,
              role        text not null,
              added       text[] not null default '{}',
              removed     text[] not null default '{}',
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now(),
              primary key (academy_id, role)
            );

            create trigger trg_set_updated_at before update on academy_role_tunings
              for each row execute function set_updated_at();

            alter table academy_role_tunings enable row level security;
            alter table academy_role_tunings force row level security;
            create policy tenant_isolation on academy_role_tunings
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        DB::unprepared("grant select, insert, update, delete on academy_role_tunings to {$app};");
        DB::unprepared("grant select on academy_role_tunings to {$bypass};");

        // NULL when the academy left the role as shipped.
        DB::unprepared(<<<'SQL'
            create or replace function app.auth_role_tuning(p_academy uuid, p_role text)
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare s jsonb;
            begin
              select jsonb_build_object('added', to_jsonb(t.added), 'removed', to_jsonb(t.removed))
                into s
                from academy_role_tunings t
               where t.academy_id = p_academy and t.role = p_role;
              return s;
            end;
            $$;
        SQL);

        DB::unprepared("alter function app.auth_role_tuning(uuid, text) owner to {$bypass};");
        DB::unprepared('revoke all on function app.auth_role_tuning(uuid, text) from public;');
        DB::unprepared("grant execute on function app.auth_role_tuning(uuid, text) to {$app};");

        TenantContext::apply(userId: null, academyId: null, role: 'SUPER_ADMIN', local: false);
        try {
            foreach (self::SUPERVISOR_COLLECTS as $code) {
                $id = DB::table('permissions')->where('code', $code)->value('id');
                if ($id !== null) {
                    DB::table('role_permissions')->updateOrInsert(['role' => 'SUPERVISOR', 'permission_id' => $id], []);
                }
            }
        } finally {
            TenantContext::clear();
        }
    }

    public function down(): void
    {
        TenantContext::apply(userId: null, academyId: null, role: 'SUPER_ADMIN', local: false);
        try {
            $ids = DB::table('permissions')->whereIn('code', self::SUPERVISOR_COLLECTS)->pluck('id');
            DB::table('role_permissions')->where('role', 'SUPERVISOR')->whereIn('permission_id', $ids)->delete();
        } finally {
            TenantContext::clear();
        }

        DB::unprepared(<<<'SQL'
            drop function if exists app.auth_role_tuning(uuid, text);
            drop table if exists academy_role_tunings;
        SQL);
    }
};
