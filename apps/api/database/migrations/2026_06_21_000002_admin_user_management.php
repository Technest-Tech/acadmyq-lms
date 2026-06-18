<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Admin panel — Phase 4 (cross-tenant user management).
 *
 * Two audited SECURITY DEFINER reads, following the `app.admin_audit()` contract exactly
 * (SUPER_ADMIN guard in the body, owned by the bypass role, curated projection):
 *   - `app.admin_list_users(...)` — paginated/filterable platform-wide user list.
 *   - `app.admin_user_detail(uuid)` — one user with their roles across academies.
 *
 * WRITES (deactivate/reactivate, role assign/revoke) are NOT here — they go through the
 * standard tenant policy inside the target user's academy context (the same path academy
 * onboarding uses), so no new write grant is introduced.
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

        // The bypass role already holds SELECT on users, user_roles and academies.
        DB::unprepared('drop function if exists app.admin_list_users(uuid, text, boolean, text, int, int);');
        DB::unprepared(<<<'SQL'
            create or replace function app.admin_list_users(
              p_academy uuid,
              p_role    text,
              p_active  boolean,
              p_search  text,
              p_limit   int,
              p_offset  int
            )
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare total bigint; rows jsonb;
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.admin_list_users requires SUPER_ADMIN';
              end if;

              select count(*) into total
              from users u
              where (p_academy is null or u.academy_id = p_academy)
                and (p_active is null or u.is_active = p_active)
                and (p_search is null
                     or u.full_name ilike '%' || p_search || '%'
                     or u.email ilike '%' || p_search || '%')
                and (p_role is null
                     or exists (select 1 from user_roles ur
                                where ur.user_id = u.id and ur.role::text = p_role));

              select coalesce(jsonb_agg(sub.j order by sub.created_at desc), '[]'::jsonb)
              into rows
              from (
                select jsonb_build_object(
                  'id', u.id,
                  'full_name', u.full_name,
                  'email', u.email,
                  'phone', u.phone,
                  'is_active', u.is_active,
                  'academy_id', u.academy_id,
                  'academy_name', a.name,
                  'roles', coalesce(
                    (select jsonb_agg(distinct ur.role::text) from user_roles ur where ur.user_id = u.id),
                    '[]'::jsonb),
                  'invited_at', u.invited_at,
                  'created_at', u.created_at
                ) as j,
                u.created_at as created_at
                from users u
                left join academies a on a.id = u.academy_id
                where (p_academy is null or u.academy_id = p_academy)
                  and (p_active is null or u.is_active = p_active)
                  and (p_search is null
                       or u.full_name ilike '%' || p_search || '%'
                       or u.email ilike '%' || p_search || '%')
                  and (p_role is null
                       or exists (select 1 from user_roles ur
                                  where ur.user_id = u.id and ur.role::text = p_role))
                order by u.created_at desc
                limit greatest(p_limit, 0) offset greatest(p_offset, 0)
              ) sub;

              return jsonb_build_object('rows', rows, 'total', total);
            end;
            $$;
        SQL);

        DB::unprepared('drop function if exists app.admin_user_detail(uuid);');
        DB::unprepared(<<<'SQL'
            create or replace function app.admin_user_detail(p_id uuid)
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare result jsonb;
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.admin_user_detail requires SUPER_ADMIN';
              end if;

              select jsonb_build_object(
                'id', u.id,
                'full_name', u.full_name,
                'email', u.email,
                'phone', u.phone,
                'is_active', u.is_active,
                'academy_id', u.academy_id,
                'academy_name', a.name,
                'invited_at', u.invited_at,
                'created_at', u.created_at,
                'roles', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'academy_id', ur.academy_id,
                    'academy_name', ra.name,
                    'role', ur.role::text
                  ) order by ra.name nulls first)
                  from user_roles ur
                  left join academies ra on ra.id = ur.academy_id
                  where ur.user_id = u.id
                ), '[]'::jsonb)
              )
              into result
              from users u
              left join academies a on a.id = u.academy_id
              where u.id = p_id;

              return result;  -- null when no such user
            end;
            $$;
        SQL);

        foreach ([
            'app.admin_list_users(uuid, text, boolean, text, int, int)',
            'app.admin_user_detail(uuid)',
        ] as $sig) {
            DB::unprepared("alter function {$sig} owner to {$bypass};");
            DB::unprepared("revoke all on function {$sig} from public;");
            DB::unprepared("grant execute on function {$sig} to {$app};");
        }
    }

    public function down(): void
    {
        DB::unprepared('drop function if exists app.admin_list_users(uuid, text, boolean, text, int, int);');
        DB::unprepared('drop function if exists app.admin_user_detail(uuid);');
    }
};
