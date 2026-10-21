<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The family card's follow-up log (docs/groups/01-ACCOUNTING.md): what the money desk wants on
 * record about a family — "called, will pay Thursday", "father travelling until the 10th" — with an
 * optional follow-up date (a promise to pay). Shown on the family card's timeline next to its
 * receipts and reminders. Only an academy with `accounting` ever writes here.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table payer_notes (
              id            uuid primary key default uuid_generate_v7(),
              academy_id    uuid not null references academies(id),
              guardian_id   uuid not null references guardians(id),
              body          text not null,
              follow_up_on  date,
              created_by    uuid references users(id),
              created_at    timestamptz not null default now(),
              constraint payer_notes_body_chk check (length(trim(body)) > 0)
            );
            create index payer_notes_guardian_idx on payer_notes (guardian_id, created_at desc);
            create index payer_notes_follow_up_idx on payer_notes (academy_id, follow_up_on) where follow_up_on is not null;

            alter table payer_notes enable row level security;
            alter table payer_notes force row level security;
            create policy tenant_isolation on payer_notes
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared('drop table if exists payer_notes;');
    }
};
