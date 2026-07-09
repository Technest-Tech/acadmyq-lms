<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * API keys that let an existing academy's external systems call the WhatsApp service over the public
 * API (docs/whatsapp-api). Each key belongs to one academy; an academy may hold several live keys
 * (rotation). Only the SHA-256 hash of the key is stored — the plaintext is shown once at creation
 * and never again; key_prefix is the leading chars kept for display/identification.
 *
 * Tenant-scoped RLS keeps each academy's keys isolated for the Super-Admin management surface (which
 * runs inside the target academy's context). But the public API must resolve a key to its academy
 * BEFORE any tenant context exists — the same chicken-and-egg as login — so a narrow SECURITY DEFINER
 * reader (app.wa_api_key_lookup), owned by the BYPASSRLS role and execute-locked to the app role, is
 * the sole no-context entry point. Mirrors app.auth_user_roles (2026_06_12_000002).
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
            create table whatsapp_api_keys (
              id           uuid primary key default uuid_generate_v7(),
              academy_id   uuid not null references academies(id) on delete cascade,
              name         text not null,
              key_prefix   text not null,
              key_hash     text not null unique,
              last_used_at timestamptz,
              revoked_at   timestamptz,
              created_by   uuid,
              created_at   timestamptz not null default now(),
              updated_at   timestamptz not null default now()
            );
            create index whatsapp_api_keys_academy_idx
              on whatsapp_api_keys (academy_id, created_at desc);

            alter table whatsapp_api_keys enable row level security;
            alter table whatsapp_api_keys force row level security;
            create policy tenant_isolation on whatsapp_api_keys
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        // The BYPASSRLS reader needs SELECT on the table it reads across tenants.
        DB::unprepared("grant select on whatsapp_api_keys to {$bypass};");

        // Context-free key → academy resolution for the public API middleware. Late-bound plpgsql
        // (no hard table dependency) so migrate:fresh stays clean.
        DB::unprepared(<<<'SQL'
            create or replace function app.wa_api_key_lookup(p_hash text)
            returns table (id uuid, academy_id uuid, revoked_at timestamptz)
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            begin
              return query
                select k.id, k.academy_id, k.revoked_at
                from whatsapp_api_keys k
                where k.key_hash = p_hash
                limit 1;
            end;
            $$;
        SQL);

        foreach (['app.wa_api_key_lookup(text)'] as $sig) {
            DB::unprepared("alter function {$sig} owner to {$bypass};");
            DB::unprepared("revoke all on function {$sig} from public;");
            DB::unprepared("grant execute on function {$sig} to {$app};");
        }
    }

    public function down(): void
    {
        DB::unprepared('drop function if exists app.wa_api_key_lookup(text);');
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on whatsapp_api_keys;
            drop table if exists whatsapp_api_keys;
        SQL);
    }
};
