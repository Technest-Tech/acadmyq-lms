<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Has a lesson's report actually been written? The attendance popup saves a report row on every
 * outcome (a cancellation sends an empty `report_text`), so the row alone says nothing. "Written"
 * = any answer other than the trial flag that is not blank once its markup is stripped — the same
 * rule the reports log and teacher performance count by.
 */
final class ReportContent
{
    public static function written(string $sessionId): bool
    {
        return DB::table('session_reports as sr')
            ->where('sr.session_id', $sessionId)
            ->whereRaw(<<<'SQL'
                exists (
                  select 1 from jsonb_each_text(sr."values") kv
                  where kv.key <> 'is_free_trial'
                    and regexp_replace(coalesce(kv.value, ''), '<[^>]*>|&nbsp;|[[:space:]]', '', 'g') <> ''
                )
                SQL)
            ->exists();
    }
}
