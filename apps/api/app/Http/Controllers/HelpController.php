<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\AuthContext;
use App\Support\LmsMedia;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * What the in-app help needs from the server (the text itself ships with the web app).
 *
 *  - GET /api/help/videos — every help video recorded so far, by slot. Authenticated, no special
 *    capability: a teacher and an owner watch the same clips. An uploaded file comes back as a
 *    short-lived signed url minted now, so the panel asks again each time the help opens.
 *  - GET /api/help/onboarding — how far a NEW academy got through its first steps, for the
 *    dashboard's "start here" card. Booleans only: nothing here says how many or who.
 */
final class HelpController extends Controller
{
    /** How long after creation an academy still counts as new, in days. */
    private const NEW_FOR_DAYS = 60;

    public function videos(): JsonResponse
    {
        $rows = DB::table('help_videos')
            ->orderBy('slot')
            ->get(['slot', 'source', 'url', 'storage_key', 'original_filename', 'size_bytes', 'updated_at']);

        return response()->json([
            'videos' => $rows->map(static fn (object $row): array => [
                'slot' => (string) $row->slot,
                'source' => (string) $row->source,
                'url' => $row->source === 'UPLOAD'
                    ? LmsMedia::objectUrl((string) $row->storage_key)
                    : (string) $row->url,
                'filename' => $row->original_filename,
                'sizeBytes' => $row->size_bytes !== null ? (int) $row->size_bytes : null,
                'updatedAt' => Carbon::parse((string) $row->updated_at)->toIso8601String(),
            ])->all(),
        ]);
    }

    public function onboarding(): JsonResponse
    {
        $ctx = app(AuthContext::class);

        // A platform Super Admin with no academy entered has nothing to set up.
        if ($ctx->academyId === null) {
            return response()->json(['show' => false, 'done' => (object) []]);
        }

        // Every query names the academy: a Super Admin inside one is admitted to all rows by RLS.
        $id = $ctx->academyId;
        $has = static fn (string $table, ?callable $scope = null): bool => DB::table($table)
            ->where('academy_id', $id)
            ->when($scope !== null, $scope)
            ->exists();

        $done = [
            'teacher' => $has('teachers', static fn ($q) => $q->whereNull('deleted_at')),
            'student' => $has('students', static fn ($q) => $q->whereNull('deleted_at')),
            'group' => $has('class_groups'),
            'schedule' => $has('schedules') || $has('class_group_slots'),
            // A lesson somebody recorded: anything a one-to-one lesson moved to from SCHEDULED, or one
            // name ticked on a group's sheet.
            'attendance' => $has('sessions', static fn ($q) => $q->where('status', '!=', 'SCHEDULED')->whereNull('hidden_at'))
                || $has('class_group_attendance'),
            // Money that actually came in: a bill somebody paid (in full or in part), or a live receipt.
            // A bill merely existing is not it — the month's bill opens by itself with the first lesson.
            'money' => $has('invoices', static fn ($q) => $q->whereIn('status', ['PAID', 'PARTIALLY_PAID']))
                || $has('receipts', static fn ($q) => $q->whereNull('voided_at')),
        ];

        $createdAt = DB::table('academies')->where('id', $id)->value('created_at');
        $isNew = $createdAt !== null
            && Carbon::parse((string) $createdAt)->greaterThan(now()->subDays(self::NEW_FOR_DAYS));

        return response()->json([
            // An academy that has been working for months is never shown a beginner's card for the
            // one step it happens not to use; one with no students yet always is.
            'show' => $isNew || ! $done['student'],
            'done' => $done,
        ]);
    }
}
