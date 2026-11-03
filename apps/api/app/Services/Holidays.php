<?php

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * Is the academy closed on a date? The one question lesson generation asks about a centre's
 * holidays (docs/centre-profile, Phase 2 §3), kept apart from everything else about them
 * ({@see HolidayClosures}) so the generators depend on nothing heavier than this.
 *
 * An academy's ranges are read once per instance and kept — a generation run asks about hundreds of
 * dates and must not query for each. The instance lives as long as the generator holding it (a
 * request, one job), so a holiday written in the same request is seen by calling {@see forget()}.
 * An academy with no rows gets an empty list and every date is open: nothing changes for it.
 */
final class Holidays
{
    /** @var array<string, list<array{0:string, 1:string}>> academy id → [starts_on, ends_on] pairs */
    private array $ranges = [];

    /** @param  string  $localDate  Y-m-d in the academy's own calendar */
    public function isClosed(string $academyId, string $localDate): bool
    {
        foreach ($this->rangesOf($academyId) as [$from, $to]) {
            if ($localDate >= $from && $localDate <= $to) {
                return true;
            }
        }

        return false;
    }

    /** Drop what was read for an academy (or all), so the next question re-reads the table. */
    public function forget(?string $academyId = null): void
    {
        if ($academyId === null) {
            $this->ranges = [];
        } else {
            unset($this->ranges[$academyId]);
        }
    }

    /** @return list<array{0:string, 1:string}> */
    private function rangesOf(string $academyId): array
    {
        return $this->ranges[$academyId] ??= DB::table('academy_holidays')
            ->where('academy_id', $academyId)
            ->get(['starts_on', 'ends_on'])
            ->map(fn ($r) => [substr((string) $r->starts_on, 0, 10), substr((string) $r->ends_on, 0, 10)])
            ->all();
    }
}
