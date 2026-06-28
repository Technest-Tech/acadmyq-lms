<?php

declare(strict_types=1);

use App\Support\VideoJoinToken;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Auto-generated SHORT links, S5 (docs/video-platform/08-ROOM-ACCESS-AND-MONITORING §14).
 *
 * From now on a room's three links (guest `join_token`, `host_token`, `monitor_token`) are short,
 * human-readable `{kebab-room-name}-{≤7 alnum}` links minted by VideoRoomController — replacing the
 * old 24-char join_token + 40-char host/monitor secrets. This migration regenerates the links of any
 * room that pre-dates S5 so the long token never surfaces in the panel anywhere.
 *
 * No schema change — only data. video_rooms is FORCE RLS and a migration carries no tenant context,
 * so a plain SELECT/UPDATE matches zero (tenant-hidden) rows. We drop FORCE for the backfill only
 * (the owner is then RLS-exempt and keeps full DML rights) and restore it — the W1 gotcha, same as
 * the join_token + links migrations. The whole migration is transactional, so a failure cannot leave
 * FORCE off. On a fresh database there are no rooms yet, so this is a no-op.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('alter table video_rooms no force row level security;');

        try {
            $rooms = DB::table('video_rooms')->get(['id', 'name']);
            $used = [];
            foreach ($rooms as $room) {
                $tokens = [];
                foreach (['join_token', 'host_token', 'monitor_token'] as $col) {
                    do {
                        $token = VideoJoinToken::forRoom((string) $room->name);
                    } while (isset($used[$token]));
                    $used[$token] = true;
                    $tokens[$col] = $token;
                }
                DB::table('video_rooms')->where('id', $room->id)->update($tokens);
            }
        } finally {
            DB::statement('alter table video_rooms force row level security;');
        }
    }

    public function down(): void
    {
        // Irreversible by design: the original random tokens are not retained. Down is a no-op — the
        // short links remain valid (the route + reader resolve them regardless of shape).
    }
};
