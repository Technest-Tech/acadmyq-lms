<?php

declare(strict_types=1);

use App\Support\TenantContext;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Supervision: the "Following" click on a lesson, and the statistics built on it.
 *
 * `session_follow_ups` records that a supervisor pressed Following on a lesson — "I am on this
 * one" — and exactly when. Two things hang off it:
 *   • the WhatsApp "attendance not marked" reminder stays quiet for a followed lesson (someone is
 *     already looking at it), and
 *   • the Supervision page measures each supervisor: did they follow, how long after the start,
 *     and how long after the end the outcome was recorded (`sessions.outcome_set_at/_by`).
 *
 * One row per (lesson, supervisor): a second supervisor following the same lesson is a second
 * fact, not a duplicate. Rows are immutable — a click is a click, there is no un-follow.
 *
 * Two capabilities join the catalog: `session.follow` (press the button) and `supervision.stats`
 * (read the page). Both go to ACADEMY_OWNER and SUPERVISOR — the supervisor's own performance is
 * theirs to see — and never to a TEACHER, who is the person being waited on.
 */
return new class extends Migration
{
    private const GRANTS = [
        'session.follow' => ['ACADEMY_OWNER', 'SUPERVISOR'],
        'supervision.stats' => ['ACADEMY_OWNER', 'SUPERVISOR'],
    ];

    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table session_follow_ups (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id) on delete cascade,
              session_id  uuid not null references sessions(id) on delete cascade,
              user_id     uuid not null references users(id) on delete cascade,
              followed_at timestamptz not null default now(),
              created_at  timestamptz not null default now(),
              unique (session_id, user_id)
            );
            create index session_follow_ups_academy_idx on session_follow_ups (academy_id, followed_at desc);
            create index session_follow_ups_user_idx on session_follow_ups (academy_id, user_id);

            alter table session_follow_ups enable row level security;
            alter table session_follow_ups force row level security;
            create policy tenant_isolation on session_follow_ups
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        TenantContext::apply(userId: null, academyId: null, role: 'SUPER_ADMIN', local: false);
        try {
            foreach (self::GRANTS as $code => $roles) {
                DB::table('permissions')->updateOrInsert(['code' => $code], ['description' => $code]);
                $permissionId = DB::table('permissions')->where('code', $code)->value('id');

                foreach ($roles as $role) {
                    DB::table('role_permissions')->updateOrInsert(
                        ['role' => $role, 'permission_id' => $permissionId],
                        [],
                    );
                }
            }
        } finally {
            TenantContext::clear();
        }
    }

    public function down(): void
    {
        TenantContext::apply(userId: null, academyId: null, role: 'SUPER_ADMIN', local: false);
        try {
            foreach (array_keys(self::GRANTS) as $code) {
                $permissionId = DB::table('permissions')->where('code', $code)->value('id');
                if ($permissionId !== null) {
                    DB::table('role_permissions')->where('permission_id', $permissionId)->delete();
                    DB::table('permissions')->where('id', $permissionId)->delete();
                }
            }
        } finally {
            TenantContext::clear();
        }

        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on session_follow_ups;
            drop table if exists session_follow_ups;
        SQL);
    }
};
