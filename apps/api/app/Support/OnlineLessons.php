<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Does this academy teach online? (docs/centre-profile/02-COHERENCE-AUDIT §1) What a centre's Enter
 * button, teacher meeting link and Punctuality tab hang on.
 *
 * `academies.online_lessons` when the academy has said. Otherwise worked out: an academy without the
 * `centre` switch always is (it keeps those surfaces, nothing about it changes); a centre is when any
 * active group is ONLINE or any active teacher has a meeting link, so a room-based centre starts
 * without them and an online one starts with them, with nothing to set.
 */
final class OnlineLessons
{
    public static function forAcademy(string $academyId): bool
    {
        $stored = DB::table('academies')->where('id', $academyId)->value('online_lessons');
        if ($stored !== null) {
            return (bool) $stored;
        }

        if (! Entitlement::hasCapability($academyId, 'centre')) {
            return true;
        }

        return DB::table('class_groups')->where('academy_id', $academyId)->where('status', 'ACTIVE')->where('mode', 'ONLINE')->exists()
            || DB::table('teachers')->where('academy_id', $academyId)->where('is_active', true)->whereNull('deleted_at')
                ->whereRaw("btrim(coalesce(meeting_url, '')) <> ''")->exists();
    }
}
