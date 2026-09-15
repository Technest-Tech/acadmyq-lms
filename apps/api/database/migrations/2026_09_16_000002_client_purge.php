<?php

declare(strict_types=1);

use App\Support\TenantContext;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Deleting a client for real — DELETE /admin/clients/{id} wipes the academy and everything it owns.
 *
 * Until now there was deliberately no hard delete (academies were only SUSPENDED); the owner asked
 * for one to clear out clients that should never have existed. Four pieces make it possible:
 *
 *  1. `app.purge_academy(uuid)` — SECURITY INVOKER, so it runs as the app role under the target
 *     academy's own RLS context (every `tenant_isolation` policy is FOR ALL, so the deletes are
 *     admitted by the same rule that admits everything else). It discovers every table carrying
 *     `academy_id` at call time — a table added next month is covered without touching this — and
 *     deletes them leaves-first by walking the non-cascading foreign keys, retrying a table that a
 *     cascade chain still pins. The academies row goes last, under a FOR UPDATE lock taken first so
 *     a job inserting for this academy mid-purge blocks and then fails instead of racing it.
 *
 *  2. `app.admin_purge_audit(uuid)` — SECURITY DEFINER as the bypass role. `audit_log` is
 *     append-only under RLS (insert + select policies only), yet its academy_id FK blocks deleting
 *     the academy, and its actor_user_id FK blocks deleting the academy's users wherever they acted.
 *     This is the one place allowed to remove those rows.
 *
 *  3. The finalized-payout guards learn a purge exception. They exist so no one rewrites a salary
 *     that was paid; wiping the whole academy is not that, and without the exception a single
 *     finalized payout makes the academy undeletable. The exception holds only for rows of the
 *     academy named in the transaction-local `app.purging_academy_id`, which only
 *     purge_academy sets. (The app role owns these tables and could disable the triggers outright,
 *     so this grants nothing it did not already have — it just stops the purge needing DDL.)
 *
 *  4. The `academy.delete` capability, SUPER_ADMIN only.
 */
return new class extends Migration
{
    private const CODE = 'academy.delete';

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

        // ── 2. audit purge (definer) ────────────────────────────────────────────
        DB::unprepared("grant select, update, delete on audit_log to {$bypass};");
        DB::unprepared("grant select on users to {$bypass};");
        DB::unprepared(<<<'SQL'
            create or replace function app.admin_purge_audit(p_academy uuid)
            returns bigint
            language plpgsql security definer
            set search_path = public, app
            as $$
            declare removed bigint;
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.admin_purge_audit requires SUPER_ADMIN';
              end if;
              if app.current_academy_id() is distinct from p_academy then
                raise exception 'app.admin_purge_audit must run inside the target academy context';
              end if;

              -- Entries elsewhere (the platform's own, another tenant's) that name one of this
              -- academy's users as the actor keep the entry and lose the name.
              update audit_log set actor_user_id = null
               where actor_user_id in (select id from users where academy_id = p_academy);

              delete from audit_log where academy_id = p_academy;
              get diagnostics removed = row_count;
              return removed;
            end;
            $$;
        SQL);
        DB::unprepared("alter function app.admin_purge_audit(uuid) owner to {$bypass};");
        DB::unprepared('revoke all on function app.admin_purge_audit(uuid) from public;');
        DB::unprepared("grant execute on function app.admin_purge_audit(uuid) to {$app};");

        // ── 1. the purge itself (invoker) ───────────────────────────────────────
        DB::unprepared(<<<'SQL'
            create or replace function app.purge_academy(p_academy uuid)
            returns jsonb
            language plpgsql
            set search_path = public, app
            as $$
            declare
              remaining oid[];
              ready oid[];
              tbl oid;
              n bigint;
              progressed boolean;
              counts jsonb := '{}'::jsonb;
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.purge_academy requires SUPER_ADMIN';
              end if;
              if app.current_academy_id() is distinct from p_academy then
                raise exception 'app.purge_academy must run inside the target academy context';
              end if;

              perform 1 from academies where id = p_academy for update;
              if not found then
                raise exception 'academy % not found', p_academy using errcode = 'no_data_found';
              end if;

              perform set_config('app.purging_academy_id', p_academy::text, true);

              n := app.admin_purge_audit(p_academy);
              if n > 0 then counts := counts || jsonb_build_object('audit_log', n); end if;

              select coalesce(array_agg(c.oid), '{}') into remaining
                from pg_class c
                join pg_attribute a on a.attrelid = c.oid and a.attname = 'academy_id' and not a.attisdropped
               where c.relnamespace = 'public'::regnamespace
                 and c.relkind in ('r', 'p')
                 and not c.relispartition
                 and c.relname <> 'audit_log';

              while cardinality(remaining) > 0 loop
                -- Leaves first: a table no other remaining table points at, except by CASCADE.
                -- SET NULL counts as pointing: nulling a child column can break that child's own
                -- CHECK (trials_identity_chk, say), so the child goes before its parent.
                select array_agg(t) into ready
                  from unnest(remaining) as t
                 where not exists (
                   select 1 from pg_constraint fk
                    where fk.contype = 'f'
                      and fk.confrelid = t
                      and fk.conrelid <> t
                      and fk.confdeltype <> 'c'
                      and fk.conrelid = any(remaining)
                 );
                -- A cycle has no leaf; try everything and let the retry sort it out.
                if ready is null then ready := remaining; end if;

                progressed := false;
                foreach tbl in array ready loop
                  begin
                    execute format('delete from %s where academy_id = $1', tbl::regclass) using p_academy;
                    get diagnostics n = row_count;
                    if n > 0 then
                      counts := counts || jsonb_build_object((select relname from pg_class where oid = tbl), n);
                    end if;
                    remaining := array_remove(remaining, tbl);
                    progressed := true;
                  exception when foreign_key_violation or restrict_violation
                                 or check_violation or not_null_violation then
                    -- A cascade or SET NULL reached a row something else still pins; next round.
                    null;
                  end;
                end loop;

                if not progressed then
                  raise exception 'app.purge_academy is stuck on: %',
                    (select string_agg(r::regclass::text, ', ') from unnest(remaining) as r);
                end if;
              end loop;

              delete from academies where id = p_academy;

              return counts;
            end;
            $$;
        SQL);
        DB::unprepared('revoke all on function app.purge_academy(uuid) from public;');
        DB::unprepared("grant execute on function app.purge_academy(uuid) to {$app};");

        // ── 3. finalized-payout guards: stand aside for a purge of this academy ──
        $this->replacePayoutGuards(withPurgeException: true);

        // ── 4. capability ───────────────────────────────────────────────────────
        TenantContext::apply(userId: null, academyId: null, role: 'SUPER_ADMIN', local: false);
        try {
            DB::table('permissions')->updateOrInsert(['code' => self::CODE], ['description' => self::CODE]);
            $permissionId = DB::table('permissions')->where('code', self::CODE)->value('id');
            DB::table('role_permissions')->updateOrInsert(['role' => 'SUPER_ADMIN', 'permission_id' => $permissionId], []);
        } finally {
            TenantContext::clear();
        }
    }

    public function down(): void
    {
        TenantContext::apply(userId: null, academyId: null, role: 'SUPER_ADMIN', local: false);
        try {
            $permissionId = DB::table('permissions')->where('code', self::CODE)->value('id');
            if ($permissionId !== null) {
                DB::table('role_permissions')->where('permission_id', $permissionId)->delete();
                DB::table('permissions')->where('id', $permissionId)->delete();
            }
        } finally {
            TenantContext::clear();
        }

        $this->replacePayoutGuards(withPurgeException: false);

        DB::unprepared('drop function if exists app.purge_academy(uuid);');
        DB::unprepared('drop function if exists app.admin_purge_audit(uuid);');
        DB::unprepared('revoke update, delete on audit_log from '.$this->role('bypass_role').';');
    }

    /** The three payout guards a purge can trip, with or without the purge exception. */
    private function replacePayoutGuards(bool $withPurgeException): void
    {
        $skip = fn (string $row, string $ret) => $withPurgeException
            ? "if current_setting('app.purging_academy_id', true) = {$row}.academy_id::text then return {$ret}; end if;"
            : '';

        DB::unprepared(<<<SQL
            create or replace function forbid_line_delete_on_finalized_payout() returns trigger
            language plpgsql as \$\$
            declare f timestamptz;
            begin
              {$skip('old', 'old')}
              select finalized_at into f from payouts where id = old.payout_id;
              if f is not null then
                raise exception 'cannot remove line item from finalized payout';
              end if;
              return old;
            end;
            \$\$;

            create or replace function forbid_adjustment_delete_on_finalized_payout() returns trigger
            language plpgsql as \$\$
            declare f timestamptz;
            begin
              {$skip('old', 'old')}
              select finalized_at into f from payouts where id = old.payout_id;
              if f is not null then
                raise exception 'cannot remove adjustment from finalized payout';
              end if;
              return old;
            end;
            \$\$;

            create or replace function forbid_adjustment_update_on_finalized_payout() returns trigger
            language plpgsql as \$\$
            declare f timestamptz;
            begin
              {$skip('new', 'new')}
              select finalized_at into f from payouts where id = new.payout_id;
              if f is not null then
                raise exception 'cannot modify an adjustment on a finalized payout';
              end if;
              return new;
            end;
            \$\$;
        SQL);
    }
};
