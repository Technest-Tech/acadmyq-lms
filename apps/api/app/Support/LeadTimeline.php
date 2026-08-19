<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The one writer for `crm_lead_activities` — a lead's activity timeline (who talked to this
 * person, and what happened). Two surfaces append to it: the CRM itself (notes, status moves,
 * follow-ups, conversion) and the Trials module (a booked trial, and its outcome), which is why
 * the insert lives here rather than inside LeadController: a trial recorded from the trials page
 * must land on the lead's feed the same way a note typed in the CRM does.
 *
 * Every type in the vocabulary is enforced by the `crm_lead_activities_type_chk` constraint, so
 * an unknown type is a 500 at write time rather than a row nobody can render.
 */
final class LeadTimeline
{
    public const CREATED = 'CREATED';

    public const NOTE = 'NOTE';

    public const STATUS_CHANGE = 'STATUS_CHANGE';

    public const FOLLOW_UP_SET = 'FOLLOW_UP_SET';

    public const TRIAL_BOOKED = 'TRIAL_BOOKED';

    public const TRIAL_OUTCOME = 'TRIAL_OUTCOME';

    public const CONVERTED = 'CONVERTED';

    /**
     * Append one entry; returns its id.
     *
     * @param  array<string,mixed>|null  $meta
     */
    public static function log(
        string $academyId,
        string $leadId,
        string $type,
        ?string $body = null,
        ?array $meta = null,
        ?string $userId = null,
    ): string {
        $id = (string) Str::uuid();

        DB::table('crm_lead_activities')->insert([
            'id' => $id,
            'academy_id' => $academyId,
            'lead_id' => $leadId,
            'type' => $type,
            'body' => $body,
            'meta' => $meta === null ? null : json_encode($meta),
            'created_by' => $userId,
        ]);

        return $id;
    }
}
