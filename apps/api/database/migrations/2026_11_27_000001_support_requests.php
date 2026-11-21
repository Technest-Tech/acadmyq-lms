<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Support requests (Ahmed, 2026-11-21): every academy gets one place that keeps all of its problems
 * and change requests — what it asked for, what we answered, and where each one stands — and the
 * platform team gets one inbox to review them, accept or reject them and reply.
 *
 *  support_requests          one row per problem / change request, numbered per academy (#1, #2 …).
 *                            Opened by the academy (source ACADEMY) or logged by us on its behalf
 *                            (source ADMIN — work we did for it that it never typed in).
 *  support_request_messages  the conversation under a request. A status change made together with
 *                            a reply is written on that reply (status_from → status_to). `internal`
 *                            = a platform-team note the academy never sees.
 *
 * Statuses: NEW (waiting for us) → IN_PROGRESS (accepted, being worked on) ⇄ WAITING (we asked the
 * academy something) → DONE | REJECTED; CANCELLED = the academy withdrew it before we looked.
 * `unread_by_admin` / `unread_by_academy` drive the two sidebar badges and clear when that side
 * opens the request. Names are copied onto the rows when written (`created_by_name`,
 * `author_name`): the platform Super Admin cannot read an academy's `users` under RLS, and a
 * request should still say who raised it after that login is gone.
 *
 * Tenant-scoped like everything an academy owns, with one addition: the platform Super Admin reads
 * and writes every academy's rows (the inbox spans all clients), so a query on behalf of ONE
 * academy must still name it. Re-runnable (M-PROC-2).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table if not exists support_requests (
              id                 uuid primary key default uuid_generate_v7(),
              academy_id         uuid not null references academies(id) on delete cascade,
              number             integer not null,
              kind               text not null,
              title              text not null,
              body               text not null default '',
              priority           text not null default 'NORMAL',
              status             text not null default 'NEW',
              source             text not null default 'ACADEMY',
              page               text,
              attachments        jsonb not null default '[]'::jsonb,
              created_by         uuid references users(id) on delete set null,
              created_by_name    text,
              accepted_at        timestamptz,
              closed_at          timestamptz,
              unread_by_admin    boolean not null default false,
              unread_by_academy  boolean not null default false,
              last_activity_at   timestamptz not null default now(),
              created_at         timestamptz not null default now(),
              updated_at         timestamptz not null default now(),
              constraint support_requests_number_uq unique (academy_id, number),
              constraint support_requests_kind_chk check (kind in ('PROBLEM','CHANGE')),
              constraint support_requests_priority_chk check (priority in ('NORMAL','URGENT')),
              constraint support_requests_status_chk check (status in ('NEW','IN_PROGRESS','WAITING','DONE','REJECTED','CANCELLED')),
              constraint support_requests_source_chk check (source in ('ACADEMY','ADMIN')),
              constraint support_requests_title_chk check (char_length(btrim(title)) between 1 and 200)
            );
            create index if not exists support_requests_academy_idx on support_requests (academy_id, last_activity_at desc);
            create index if not exists support_requests_status_idx on support_requests (status, last_activity_at desc);

            create table if not exists support_request_messages (
              id           uuid primary key default uuid_generate_v7(),
              academy_id   uuid not null references academies(id) on delete cascade,
              request_id   uuid not null references support_requests(id) on delete cascade,
              side         text not null,
              author_id    uuid references users(id) on delete set null,
              author_name  text,
              body         text not null default '',
              internal     boolean not null default false,
              status_from  text,
              status_to    text,
              attachments  jsonb not null default '[]'::jsonb,
              created_at   timestamptz not null default now(),
              constraint support_request_messages_side_chk check (side in ('ACADEMY','ADMIN')),
              constraint support_request_messages_internal_chk check (internal = false or side = 'ADMIN')
            );
            create index if not exists support_request_messages_request_idx on support_request_messages (request_id, created_at);

            alter table support_requests enable row level security;
            alter table support_requests force row level security;
            drop policy if exists tenant_isolation on support_requests;
            create policy tenant_isolation on support_requests
              using (academy_id = app.current_academy_id() or app.is_super_admin())
              with check (academy_id = app.current_academy_id() or app.is_super_admin());

            alter table support_request_messages enable row level security;
            alter table support_request_messages force row level security;
            drop policy if exists tenant_isolation on support_request_messages;
            create policy tenant_isolation on support_request_messages
              using (academy_id = app.current_academy_id() or app.is_super_admin())
              with check (academy_id = app.current_academy_id() or app.is_super_admin());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop table if exists support_request_messages;
            drop table if exists support_requests;
        SQL);
    }
};
