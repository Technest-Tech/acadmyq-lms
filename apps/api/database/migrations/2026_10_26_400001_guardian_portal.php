<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The parent's page (`/p/{token}`): one private link per family that shows the children, their
 * lessons, their reports and the family's bills — no password, the same shape as the `/i/` invoice
 * link the academy already sends. The link is the credential, so it is long, random, one per
 * guardian, and the academy can replace it (the old one dies) or switch it off.
 *
 * Resolving the token is the ONE read that happens before any tenant context exists, so it goes
 * through a SECURITY DEFINER hatch (as app.lms_academy_by_subdomain does); everything after it runs
 * under RLS as that academy. A deleted family or a suspended academy resolves to nothing.
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
            alter table guardians
              add column portal_token text,
              add column portal_issued_at timestamptz;
            create unique index guardians_portal_token_uidx on guardians (portal_token) where portal_token is not null;

            create or replace function app.guardian_portal_lookup(p_token text)
            returns table (guardian_id uuid, academy_id uuid)
            language sql stable security definer
            set search_path = public, pg_catalog
            as $$
              select g.id, g.academy_id
                from guardians g
                join academies a on a.id = g.academy_id
               where g.portal_token = p_token
                 and g.deleted_at is null
                 and a.status <> 'SUSPENDED'
               limit 1;
            $$;
        SQL);

        $bypass = $this->role('bypass_role');
        $app = $this->role('app_role');

        // Both grants already exist from earlier hatches; repeated so this function stands alone.
        DB::unprepared("grant select on guardians, academies to {$bypass};");
        DB::unprepared("alter function app.guardian_portal_lookup(text) owner to {$bypass};");
        DB::unprepared('revoke all on function app.guardian_portal_lookup(text) from public;');
        DB::unprepared("grant execute on function app.guardian_portal_lookup(text) to {$app};");
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop function if exists app.guardian_portal_lookup(text);
            drop index if exists guardians_portal_token_uidx;
            alter table guardians drop column if exists portal_issued_at, drop column if exists portal_token;
        SQL);
    }
};
