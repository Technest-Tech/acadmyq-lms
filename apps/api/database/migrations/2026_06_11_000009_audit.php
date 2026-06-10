<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Append-only audit trail (§6.8, R-AUD-1/2). No updated_at — rows are immutable; the
 * append-only guarantee is enforced by RLS (insert + tenant-scoped select policies,
 * with no update/delete policy → those operations are denied under FORCE RLS).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table audit_log (
              id            uuid primary key default uuid_generate_v7(),
              academy_id    uuid references academies(id),         -- NULL for platform-level actions
              actor_user_id uuid references users(id),
              actor_role    app_role,
              action        text not null,                         -- e.g. 'invoice.close'
              entity_type   text not null,
              entity_id     uuid,
              before        jsonb,
              after         jsonb,
              created_at    timestamptz not null default now()
            );
            create index audit_log_academy_created_idx on audit_log (academy_id, created_at desc);
        SQL);
    }

    public function down(): void
    {
        DB::unprepared('drop table if exists audit_log;');
    }
};
