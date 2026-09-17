<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Custom domains (docs/custom-domains) — a client answering on an address they own,
 * `portal.theirschool.com`, rather than only on the platform handle `theirschool.acadmyq.com`.
 *
 * Why a table and not a column on `academies`:
 *
 *  1. **A client can have more than one.** A school that also sells courses wants its panel on
 *     `portal.school.com` and its course site on `courses.school.com` — two hosts, two products,
 *     one academy. `kind` is what says which answers where, and it is the per-DOMAIN generalisation
 *     of `LmsSite::ownsRoot()`: on the platform subdomain the client's plan decides what owns `/`,
 *     but a domain they bought for a purpose always owns the root of its own host.
 *  2. **Each one carries a lifecycle.** A host is not live because a row exists — it is live once
 *     its DNS points here and Let's Encrypt has issued a certificate for it. That is a state
 *     machine (`status`), and it has to be visible in the panel or every failed setup becomes a
 *     support ticket about a white screen.
 *
 * RLS is the ordinary tenant policy, and authorisation is the Gate's job — see the policy comment
 * below for why those are deliberately two different questions here.
 *
 * The handle on `academies.subdomain` stays REQUIRED and unchanged. A custom domain is an extra
 * address that resolves *to* that handle, not a replacement for it — which is precisely what keeps
 * this cheap: `app.academy_by_host()` answers with the handle, and every surface downstream
 * (`X-Academy`, the `/learn/<handle>` rewrite, the RLS bridge) carries on exactly as before.
 *
 * ## Verification
 *
 * There is deliberately no TXT-token dance. The gate is "does this host resolve to our origin IP",
 * which cannot be satisfied without control of the domain's DNS — the same thing a token proves,
 * one step shorter, and it is a precondition for the ACME HTTP-01 challenge anyway. A host someone
 * adds but does not control simply never leaves PENDING_DNS.
 *
 * ## Purge
 *
 * `academy_id` means `app.purge_academy()` (2026_09_16_000002) discovers this table on its own, so
 * a hard-deleted client takes its domains with it. The issued certificate files on disk are NOT
 * removed by that — they are inert once no row resolves, and `certbot delete` is an ops step.
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
            create table academy_domains (
              id              uuid primary key default uuid_generate_v7(),
              academy_id      uuid not null references academies(id) on delete cascade,
              host            text not null,
              kind            text not null check (kind in ('MANAGEMENT','LMS')),
              status          text not null default 'PENDING_DNS'
                                check (status in ('PENDING_DNS','VERIFIED','ISSUING','LIVE','FAILED')),
              is_primary      boolean not null default false,
              last_error      text,
              last_checked_at timestamptz,
              verified_at     timestamptz,
              issued_at       timestamptz,
              created_at      timestamptz not null default now(),
              updated_at      timestamptz not null default now()
            );

            -- A host is an ADDRESS: it can belong to exactly one client, platform-wide. Lowercased
            -- because DNS is case-insensitive and the resolver lowercases what the browser sent.
            create unique index academy_domains_host_idx on academy_domains (lower(host));

            -- At most one primary per client per product — the address links are BUILT from
            -- (an email, a WhatsApp message, a payment return URL), so "which one is canonical"
            -- has to be a single row and not a convention.
            create unique index academy_domains_primary_idx
              on academy_domains (academy_id, kind) where is_primary;

            create index academy_domains_academy_idx on academy_domains (academy_id);
            create index academy_domains_status_idx on academy_domains (status);

            alter table academy_domains enable row level security;
            alter table academy_domains force row level security;

            -- The STANDARD tenant policy, identical to every other academy_id-bearing table
            -- (2026_06_11_000010, and asserted for all of them by the RLS introspection suite).
            -- It is tempting to write `app.is_super_admin()` into it instead, since only a Super
            -- Admin provisions an address — but that is not how this codebase separates the two
            -- questions. RLS answers "which tenant's rows", the Gate answers "who may act": the
            -- admin controller enters the target academy's context for every write, so this policy
            -- admits it, and `platform.manage` is what actually keeps a client out.
            create policy tenant_isolation on academy_domains
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        $bypass = $this->role('bypass_role');
        $app = $this->role('app_role');

        DB::unprepared("grant select on academy_domains to {$bypass};");

        // The host → academy bridge. Same shape and the same reason as
        // app.lms_academy_by_subdomain (2026_07_22_000005): resolving the address is the ONE read
        // that happens before any tenant context exists, so it is a SECURITY DEFINER hatch rather
        // than an RLS-visible query (which, contextless, would return nothing).
        //
        // LIVE only. A host without a certificate cannot be reached over HTTPS anyway, and letting
        // a half-configured domain resolve would mean the client's first visit renders the site on
        // a browser-rejected connection — a worse failure than an honest 404 while the panel says
        // "issuing".
        DB::unprepared(<<<'SQL'
            create or replace function app.academy_by_host(p_host text)
            returns table (academy_id uuid, subdomain text, kind text)
            language sql stable security definer
            set search_path = public, app
            as $$
              select d.academy_id, a.subdomain, d.kind
                from academy_domains d
                join academies a on a.id = d.academy_id
               where lower(d.host) = lower(btrim(p_host))
                 and d.status = 'LIVE'
               limit 1
            $$;
        SQL);

        // Every live host, for the request-time CORS / stateful-domain lists (App\Support\CustomDomain).
        // Public hostnames only — it says nothing a DNS lookup would not.
        DB::unprepared(<<<'SQL'
            create or replace function app.live_custom_domains()
            returns setof text
            language sql stable security definer
            set search_path = public, app
            as $$
              select lower(d.host) from academy_domains d where d.status = 'LIVE' order by 1
            $$;
        SQL);

        // Is this host spoken for, in ANY state? The uniqueness check a Super Admin's validation
        // runs, which happens before any academy context exists — under `tenant_isolation` alone a
        // plain `unique` rule would see no rows at all and wave every duplicate through to the
        // index, turning a 422 with a sentence into a 500 with none.
        DB::unprepared(<<<'SQL'
            create or replace function app.custom_domain_taken(p_host text)
            returns boolean
            language sql stable security definer
            set search_path = public, app
            as $$
              select exists (select 1 from academy_domains d where lower(d.host) = lower(btrim(p_host)))
            $$;
        SQL);

        // The domains still waiting on DNS, for the scheduled sweep. Cross-tenant by nature — the
        // sweep belongs to no academy — so it is a definer hatch rather than a contextless query
        // that would silently return nothing.
        DB::unprepared(<<<'SQL'
            create or replace function app.custom_domains_waiting(p_retry_before timestamptz)
            returns table (id uuid, academy_id uuid, host text)
            language sql stable security definer
            set search_path = public, app
            as $$
              select d.id, d.academy_id, d.host
                from academy_domains d
               where d.status = 'PENDING_DNS'
                  or (d.status = 'FAILED'
                      and (d.last_checked_at is null or d.last_checked_at < p_retry_before))
               order by d.created_at
            $$;
        SQL);

        $functions = [
            'app.academy_by_host(text)',
            'app.live_custom_domains()',
            'app.custom_domain_taken(text)',
            'app.custom_domains_waiting(timestamptz)',
        ];

        foreach ($functions as $fn) {
            DB::unprepared("alter function {$fn} owner to {$bypass};");
            DB::unprepared("revoke all on function {$fn} from public;");
            DB::unprepared("grant execute on function {$fn} to {$app};");
        }
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop function if exists app.academy_by_host(text);
            drop function if exists app.live_custom_domains();
            drop function if exists app.custom_domain_taken(text);
            drop function if exists app.custom_domains_waiting(timestamptz);
            drop policy if exists tenant_isolation on academy_domains;
            drop table if exists academy_domains;
        SQL);
    }
};
