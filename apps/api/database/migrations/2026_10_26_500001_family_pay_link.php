<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * One payment link per family (`/f/{token}`): when two children or more owe on their packages, the
 * parent gets ONE page with every child's bill and the total, instead of a link per child. The bills
 * stay separate — each package keeps its own invoice, so it is still marked paid when its money is
 * in — the page only gathers them.
 *
 * Same shape as the parent's page (2026_10_26_400001): the link is the credential, long and random,
 * one per guardian; resolving it is the one read before any tenant context exists, so it goes
 * through a SECURITY DEFINER hatch and everything after it runs under RLS as that academy.
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
              add column pay_token text,
              add column pay_issued_at timestamptz;
            create unique index guardians_pay_token_uidx on guardians (pay_token) where pay_token is not null;

            create or replace function app.family_pay_lookup(p_token text)
            returns table (guardian_id uuid, academy_id uuid)
            language sql stable security definer
            set search_path = public, pg_catalog
            as $$
              select g.id, g.academy_id
                from guardians g
                join academies a on a.id = g.academy_id
               where g.pay_token = p_token
                 and g.deleted_at is null
                 and a.status <> 'SUSPENDED'
               limit 1;
            $$;
        SQL);

        $bypass = $this->role('bypass_role');
        $app = $this->role('app_role');

        DB::unprepared("grant select on guardians, academies to {$bypass};");
        DB::unprepared("alter function app.family_pay_lookup(text) owner to {$bypass};");
        DB::unprepared('revoke all on function app.family_pay_lookup(text) from public;');
        DB::unprepared("grant execute on function app.family_pay_lookup(text) to {$app};");
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop function if exists app.family_pay_lookup(text);
            drop index if exists guardians_pay_token_uidx;
            alter table guardians drop column if exists pay_issued_at, drop column if exists pay_token;
        SQL);
    }
};
