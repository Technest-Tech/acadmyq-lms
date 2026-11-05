<?php

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Rooms (docs/centre-profile/02-COHERENCE-AUDIT §3): the centre's own list of rooms, the seam
 * the shared group controllers call — "is this room one of ours and switched on?" and "what is
 * it called?". A Quran academy has no room rows, so the check refuses any room id and the names
 * come back null; its `location` text is untouched.
 */
final class Rooms
{
    /** Refuse a room id that is not one of this academy's active rooms (null passes: "no room"). */
    public function assertUsable(?string $roomId, string $field = 'room_id'): void
    {
        if ($roomId === null) {
            return;
        }
        $ok = DB::table('academy_rooms')->where('id', $roomId)->where('is_active', true)->exists();
        if (! $ok) {
            throw ValidationException::withMessages([$field => ['Unknown or inactive room. / قاعة غير موجودة أو موقوفة.']]);
        }
    }

    public function nameOf(?string $roomId): ?string
    {
        if ($roomId === null) {
            return null;
        }
        $name = DB::table('academy_rooms')->where('id', $roomId)->value('name');

        return $name !== null ? (string) $name : null;
    }

    /** How many groups sit in a room — what stops a delete. */
    public function usage(string $roomId): array
    {
        return [
            'groups' => DB::table('class_groups')->where('room_id', $roomId)->count(),
            'active_groups' => DB::table('class_groups')->where('room_id', $roomId)->where('status', 'ACTIVE')->count(),
        ];
    }
}
