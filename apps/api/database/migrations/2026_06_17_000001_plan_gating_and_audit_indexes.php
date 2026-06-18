<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Sprint 9 — plan gating & audit surfacing (§7).
 *
 * Three additive, operational deltas — no existing table is altered:
 *
 *  1. `academy_addons` — which paid add-ons an academy has been granted. Each active row
 *     unlocks its add-on's `feature_key` on top of the plan's capabilities (App\Support\
 *     Entitlement). It carries `academy_id`, so it gets the IDENTICAL standard tenant
 *     policy (`academy_id = app.current_academy_id()` on both using + with check) as every
 *     other tenant table — the RLS introspection gate (TC-9.12) now covers it automatically.
 *
 *  2. Audit filter indexes — the read UI (GET /api/audit) filters by action and by entity.
 *     `(academy_id, created_at desc)` already exists from Sprint 1; we add `(academy_id,
 *     action)` and `(academy_id, entity_type, entity_id)`.
 *
 *  3. `app.admin_audit(...)` — the audited cross-tenant audit read for a Super Admin (who
 *     has no home academy, so RLS scopes them to nothing). Mirrors the Sprint-1
 *     `app.admin_list_academies()` escape hatch exactly: SECURITY DEFINER owned by the
 *     BYPASSRLS role, plpgsql (late-binding → no hard table dependency), guarded by a
 *     SUPER_ADMIN check in its body, EXECUTE-locked to the app role. An Owner never calls
 *     it — their audit read goes straight through RLS-scoped `audit_log` selects (TC-9.8).
 *
 * `plans.features` JSON shape (documented here, enforced as data by App\Support\Entitlement):
 *
 *     {
 *       "capabilities": string[],         // unlocked feature keys, e.g. ["audit.full","report_field.custom"]
 *       "limits": {                       // numeric caps; absent/null key ⇒ unlimited
 *         "maxStudents"?: number|null,
 *         "maxTeachers"?: number|null
 *       }
 *     }
 *
 * Resolution (Entitlement::check): granted = plan.capabilities ∪ {active add-on feature_keys};
 * an unknown/misconfigured key ⇒ false (fail closed). withinLimit: a null/absent limit is
 * unlimited (fail open for caps the plan does not constrain), else currentCount < limit.
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

        // --- academy_addons: a tenant-scoped grant ledger -------------------
        DB::unprepared(<<<'SQL'
            create table academy_addons (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id) on delete cascade,
              add_on_id   uuid not null references add_ons(id),
              is_active   boolean not null default true,
              granted_at  timestamptz not null default now(),
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now(),
              unique (academy_id, add_on_id)
            );
            create index academy_addons_academy_idx on academy_addons (academy_id);

            -- The identical standard tenant policy (§7.2) — same shape as every tenant table,
            -- so the introspection gate (TC-9.12) finds and validates it without a special case.
            alter table academy_addons enable row level security;
            alter table academy_addons force row level security;
            create policy tenant_isolation on academy_addons
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        // --- audit filter indexes (§7) --------------------------------------
        DB::unprepared(<<<'SQL'
            create index if not exists audit_log_academy_action_idx
              on audit_log (academy_id, action);
            create index if not exists audit_log_academy_entity_idx
              on audit_log (academy_id, entity_type, entity_id);
        SQL);

        // --- Escape hatch: audited super-admin cross-tenant audit read ------
        // SECURITY DEFINER bypasses RLS; the body's SUPER_ADMIN guard + the curated,
        // filtered projection (never raw `setof audit_log`) are the allow-list. Returns
        // { rows, total } so the UI can paginate the platform-wide trail.
        DB::unprepared('drop function if exists app.admin_audit(text, text, uuid, timestamptz, timestamptz, int, int);');
        DB::unprepared(<<<'SQL'
            create or replace function app.admin_audit(
              p_action      text,
              p_entity_type text,
              p_actor       uuid,
              p_from        timestamptz,
              p_to          timestamptz,
              p_limit       int,
              p_offset      int
            )
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare total bigint; rows jsonb;
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.admin_audit requires SUPER_ADMIN';
              end if;

              select count(*) into total
              from audit_log al
              where (p_action is null or al.action = p_action)
                and (p_entity_type is null or al.entity_type = p_entity_type)
                and (p_actor is null or al.actor_user_id = p_actor)
                and (p_from is null or al.created_at >= p_from)
                and (p_to is null or al.created_at <= p_to);

              select coalesce(jsonb_agg(sub.j order by sub.created_at desc), '[]'::jsonb)
              into rows
              from (
                select jsonb_build_object(
                  'id', al.id,
                  'academy_id', al.academy_id,
                  'academy_name', a.name,
                  'actor_user_id', al.actor_user_id,
                  'actor_name', u.full_name,
                  'actor_role', al.actor_role,
                  'action', al.action,
                  'entity_type', al.entity_type,
                  'entity_id', al.entity_id,
                  'before', al.before,
                  'after', al.after,
                  'created_at', al.created_at
                ) as j,
                al.created_at as created_at
                from audit_log al
                left join academies a on a.id = al.academy_id
                left join users u on u.id = al.actor_user_id
                where (p_action is null or al.action = p_action)
                  and (p_entity_type is null or al.entity_type = p_entity_type)
                  and (p_actor is null or al.actor_user_id = p_actor)
                  and (p_from is null or al.created_at >= p_from)
                  and (p_to is null or al.created_at <= p_to)
                order by al.created_at desc
                limit greatest(p_limit, 0) offset greatest(p_offset, 0)
              ) sub;

              return jsonb_build_object('rows', rows, 'total', total);
            end;
            $$;
        SQL);

        // The definer role bypasses RLS but still needs table-level SELECT grants, and must
        // own the function for SECURITY DEFINER to run with its (bypassing) rights.
        DB::unprepared("grant select on audit_log to {$bypass};");
        DB::unprepared("alter function app.admin_audit(text, text, uuid, timestamptz, timestamptz, int, int) owner to {$bypass};");
        DB::unprepared('revoke all on function app.admin_audit(text, text, uuid, timestamptz, timestamptz, int, int) from public;');
        DB::unprepared("grant execute on function app.admin_audit(text, text, uuid, timestamptz, timestamptz, int, int) to {$app};");
    }

    public function down(): void
    {
        DB::unprepared('drop function if exists app.admin_audit(text, text, uuid, timestamptz, timestamptz, int, int);');
        DB::unprepared(<<<'SQL'
            drop index if exists audit_log_academy_action_idx;
            drop index if exists audit_log_academy_entity_idx;
            drop policy if exists tenant_isolation on academy_addons;
            alter table if exists academy_addons disable row level security;
            drop table if exists academy_addons;
        SQL);
    }
};
