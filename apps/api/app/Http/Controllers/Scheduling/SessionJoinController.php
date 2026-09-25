<?php

declare(strict_types=1);

namespace App\Http\Controllers\Scheduling;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The teacher's "Enter" button on a lesson: records the press, hands back the meeting link.
 *
 * The press is what the teacher's punctuality is measured by ({@see TeacherPunctualityController}),
 * so it is stamped with the server's clock and only accepted while the lesson is actually on — from
 * {@see OPENS_MINUTES_BEFORE_START} minutes before it starts until it ends. Only the teacher
 * teaching the lesson may press it: an owner opening the room to look in is not the teacher
 * arriving, and must not count as one.
 */
final class SessionJoinController extends Controller
{
    use InteractsWithScheduling;

    /**
     * How early the button opens. Mirrored by the web client's JOIN_OPENS_MINUTES_BEFORE, which
     * decides when the button stops being greyed out.
     */
    public const OPENS_MINUTES_BEFORE_START = 10;

    /** A lesson that is not going to happen has no room to enter. */
    private const CLOSED_STATUSES = ['CANCELLED_BY_TEACHER', 'CANCELLED_BY_STUDENT', 'RESCHEDULED'];

    private const TS = 'Y-m-d\TH:i:s.uP';

    /** POST /api/sessions/{id}/join — record that the teacher entered; returns the link to open. */
    public function store(string $sessionId): JsonResponse
    {
        Gate::authorize('session.read');

        $session = DB::table('sessions')->where('id', $sessionId)->first();
        if ($session === null) {
            abort(404, 'Session not found.');
        }

        $teacherId = $this->callerTeacherId();
        if ($teacherId === null || (string) $session->teacher_id !== $teacherId) {
            abort(403, 'Only the teacher of this lesson can enter it.');
        }

        if (in_array((string) $session->status, self::CLOSED_STATUSES, true)) {
            throw ValidationException::withMessages([
                'session' => ['This lesson was cancelled. / تم إلغاء هذه الحصة.'],
            ]);
        }

        $now = CarbonImmutable::now();
        $start = CarbonImmutable::parse($session->scheduled_at_utc)->utc();
        $end = $start->addMinutes((int) $session->duration_minutes);

        if ($start->subMinutes(self::OPENS_MINUTES_BEFORE_START)->greaterThan($now)) {
            throw ValidationException::withMessages([
                'session' => ['This lesson has not opened yet. / لم يحن موعد دخول هذه الحصة بعد.'],
            ]);
        }
        if ($now->greaterThan($end)) {
            throw ValidationException::withMessages([
                'session' => ['This lesson has already ended. / انتهت هذه الحصة.'],
            ]);
        }

        $url = DB::table('teachers')->where('id', $teacherId)->value('meeting_url');
        if ($url === null || $url === '') {
            throw ValidationException::withMessages([
                'session' => ['You have no meeting link yet — ask the academy to add one. / لا يوجد رابط اجتماع لك بعد — اطلب من الأكاديمية إضافته.'],
            ]);
        }

        DB::table('session_joins')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $session->academy_id,
            'session_id' => $sessionId,
            'teacher_id' => $teacherId,
            'user_id' => $this->ctx()->userId,
            'joined_at' => $now->format(self::TS),
            'created_at' => $now->format(self::TS),
        ]);

        $first = DB::table('session_joins')
            ->where('session_id', $sessionId)
            ->where('teacher_id', $teacherId)
            ->min('joined_at');

        return response()->json([
            'url' => (string) $url,
            'joined_at' => $now->toIso8601String(),
            'first_joined_at' => CarbonImmutable::parse($first)->utc()->toIso8601String(),
        ], 201);
    }
}
