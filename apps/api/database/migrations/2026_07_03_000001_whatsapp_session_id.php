<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Adds the self-hosted WhatsApp gateway's session id to the per-academy automation settings. When a
 * Super Admin "connects" an academy, the gateway mints a session (id + bearer token); the token is
 * stored ENCRYPTED in the existing wasender_token column and the session id is stored here so the
 * lifecycle endpoints (QR / status / logout) can address that session on the gateway.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table academy_automation_settings
              add column if not exists wa_session_id text;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table academy_automation_settings
              drop column if exists wa_session_id;
        SQL);
    }
};
