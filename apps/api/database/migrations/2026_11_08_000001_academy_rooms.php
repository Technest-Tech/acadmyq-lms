<?php

declare(strict_types=1);

use App\Support\Entitlement;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Rooms (docs/centre-profile/02-COHERENCE-AUDIT §3): a centre's classes happen in its rooms, and
 * until now a room was `class_groups.location` — free text, so "Room 3" and " room 3 " were two
 * rooms on the timetable and the clash check compared spellings. From here the academy keeps ONE
 * list of its rooms (name, capacity, on/off, order) and a group points at it.
 *
 *   - `academy_rooms`          — the list; unique per academy by name, case-blind.
 *   - `class_groups.room_id`   — the group's room. `location` (the text) is kept and written as
 *                                the room's name, so every reader of the text — cards, boards,
 *                                sheets — keeps working untouched, and a non-centre academy keeps
 *                                typing a branch into it as before.
 *
 * Back-fill, for an academy that holds the `centre` switch only: every distinct non-empty
 * `location` becomes a room (first appearance first) and its groups point at it. Idempotent — a
 * text that already has a room is only pointed at. A Quran academy gets no rows and sees no change.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table if not exists academy_rooms (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id),
              name        text not null,
              capacity    int,
              is_active   boolean not null default true,
              position    int not null default 0,
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now(),
              constraint academy_rooms_capacity_check check (capacity is null or capacity > 0)
            );
            create unique index if not exists academy_rooms_academy_name_uidx on academy_rooms (academy_id, lower(btrim(name)));
            create index if not exists academy_rooms_academy_position_idx on academy_rooms (academy_id, position);

            alter table academy_rooms enable row level security;
            alter table academy_rooms force row level security;
            drop policy if exists tenant_isolation on academy_rooms;
            create policy tenant_isolation on academy_rooms
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            alter table class_groups
              add column if not exists room_id uuid references academy_rooms(id) on delete set null;
            create index if not exists class_groups_academy_room_idx on class_groups (academy_id, room_id);
        SQL);

        $this->fill();
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table class_groups drop column if exists room_id;
            drop policy if exists tenant_isolation on academy_rooms;
            drop table if exists academy_rooms;
        SQL);
    }

    /**
     * The groups' room texts become room rows, per CENTRE academy, under that academy's own tenant
     * context (the tables are behind RLS). Public so the test suite can run it against fixtures.
     * Idempotent. Returns the rows created.
     */
    public function fill(): int
    {
        return DB::transaction(function (): int {
            DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

            $created = 0;
            foreach (DB::table('academies')->pluck('id')->all() as $academyId) {
                $academyId = (string) $academyId;
                // The switches are tenant rows too: read them under the academy's own context.
                DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
                // Only a centre keeps rooms; everyone else keeps the text and nothing else changes.
                if (! Entitlement::hasCapability($academyId, 'centre')) {
                    continue;
                }

                $texts = DB::table('class_groups')
                    ->selectRaw('btrim(location) as name, min(created_at) as first_seen')
                    ->whereNotNull('location')
                    ->whereRaw("btrim(location) <> ''")
                    ->whereNull('room_id')
                    ->groupByRaw('btrim(location)')
                    ->orderBy('first_seen')
                    ->pluck('name')
                    ->all();

                $existing = [];
                foreach (DB::table('academy_rooms')->get(['id', 'name']) as $r) {
                    $existing[mb_strtolower(trim((string) $r->name))] = (string) $r->id;
                }
                $next = (int) DB::table('academy_rooms')->max('position') + 1;

                foreach ($texts as $name) {
                    $key = mb_strtolower((string) $name);
                    $roomId = $existing[$key] ?? null;
                    if ($roomId === null) {
                        $roomId = (string) Str::uuid();
                        DB::table('academy_rooms')->insert([
                            'id' => $roomId,
                            'academy_id' => $academyId,
                            'name' => (string) $name,
                            'position' => $next++,
                            'is_active' => true,
                        ]);
                        $existing[$key] = $roomId;
                        $created++;
                    }
                    DB::table('class_groups')
                        ->whereNull('room_id')
                        ->whereRaw('lower(btrim(location)) = ?', [$key])
                        ->update(['room_id' => $roomId]);
                }
            }
            DB::statement("select set_config('app.current_academy_id', '', true)");

            return $created;
        });
    }
};
