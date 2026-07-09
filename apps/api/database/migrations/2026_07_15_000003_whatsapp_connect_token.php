<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A shareable, expiring "connect your phone" link (docs/whatsapp-api). The Super Admin generates a
 * link for an academy and hands it to the client; the client opens /wa-connect/{token} (no login) and
 * scans the QR to pair their WhatsApp. Only the SHA-256 hash of the token is stored, alongside an
 * expiry — regenerating replaces the hash (invalidating the old link).
 *
 * The public connect endpoints carry NO tenant context, so RLS hides academy_automation_settings. We
 * resolve token → academy via app.wa_connect_academy_by_token — a SECURITY DEFINER reader owned by the
 * BYPASSRLS role, mirroring app.video_room_by_join_token (2026_07_06_000001). It returns an academy id
 * only for a non-expired token. Two nullable columns on an existing table, no backfill → no force-RLS
 * dance needed.
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
            alter table academy_automation_settings
              add column if not exists connect_token_hash text,
              add column if not exists connect_token_expires_at timestamptz;

            create unique index if not exists academy_automation_settings_connect_token_uidx
              on academy_automation_settings (connect_token_hash)
              where connect_token_hash is not null;
        SQL);

        DB::unprepared("grant select on academy_automation_settings to {$bypass};");

        DB::unprepared(<<<'SQL'
            create or replace function app.wa_connect_academy_by_token(p_hash text)
            returns uuid
            language plpgsql stable security definer
            set search_path = public, app, pg_catalog
            as $$
            declare
                v_academy uuid;
            begin
                select s.academy_id
                  into v_academy
                  from academy_automation_settings s
                 where s.connect_token_hash = p_hash
                   and s.connect_token_expires_at is not null
                   and s.connect_token_expires_at > now()
                 limit 1;

                if not found then
                    return null;
                end if;

                return v_academy;
            end;
            $$;
        SQL);

        foreach (['app.wa_connect_academy_by_token(text)'] as $sig) {
            DB::unprepared("alter function {$sig} owner to {$bypass};");
            DB::unprepared("revoke all on function {$sig} from public;");
            DB::unprepared("grant execute on function {$sig} to {$app};");
        }
    }

    public function down(): void
    {
        DB::unprepared('drop function if exists app.wa_connect_academy_by_token(text);');
        DB::unprepared(<<<'SQL'
            drop index if exists academy_automation_settings_connect_token_uidx;
            alter table academy_automation_settings drop column if exists connect_token_expires_at;
            alter table academy_automation_settings drop column if exists connect_token_hash;
        SQL);
    }
};
