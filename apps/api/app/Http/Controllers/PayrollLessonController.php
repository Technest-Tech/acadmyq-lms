<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Services\PayrollLessonCorrection;
use App\Services\SessionDurationCorrection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * The payroll page's corrections to the lessons behind a salary. All of it moves money, so all of it
 * is `payout.adjust`, the same right as a manual bonus. The rules live in {@see PayrollLessonCorrection}.
 */
final class PayrollLessonController extends Controller
{
    use InteractsWithScheduling;

    /** POST /api/payouts/lessons — add a lesson that happened but is missing from the salary. */
    public function store(Request $request, PayrollLessonCorrection $correction): JsonResponse
    {
        Gate::authorize('payout.adjust');

        $academyId = $this->currentAcademyId();
        $data = $request->validate([
            'teacher_id' => ['required', 'uuid'],
            'student_id' => ['required', 'uuid'],
            'local_datetime' => ['required', 'date_format:Y-m-d\TH:i'],
            'duration_minutes' => ['required', 'integer', 'min:1', 'max:600'],
        ]);

        // A past student or a teacher who has since left can still be owed a lesson: only deleted rows are refused.
        if (DB::table('teachers')->where('id', $data['teacher_id'])->whereNull('deleted_at')->doesntExist()) {
            throw ValidationException::withMessages(['teacher_id' => ['Unknown teacher. / معلم غير معروف.']]);
        }
        if (DB::table('students')->where('id', $data['student_id'])->whereNull('deleted_at')->doesntExist()) {
            throw ValidationException::withMessages(['student_id' => ['Unknown student. / طالب غير معروف.']]);
        }

        return response()->json($correction->add(
            $academyId,
            $data['teacher_id'],
            $data['student_id'],
            $this->resolveInstant(['local_datetime' => $data['local_datetime']], $this->academyTimezone($academyId)),
            (int) $data['duration_minutes'],
            (string) $this->ctx()->userId,
            $this->ctx()->role,
        ), 201);
    }

    /** POST /api/payouts/lessons/{id}/attend — count an unmarked or cancelled lesson. */
    public function attend(PayrollLessonCorrection $correction, string $sessionId): JsonResponse
    {
        Gate::authorize('payout.adjust');

        $this->findOwnedSession($sessionId);

        return response()->json($correction->attend($sessionId, (string) $this->ctx()->userId, $this->ctx()->role));
    }

    /** GET /api/payouts/lessons/{id}/removal-preview — what removing it would do. */
    public function removalPreview(PayrollLessonCorrection $correction, string $sessionId): JsonResponse
    {
        Gate::authorize('payout.adjust');

        return response()->json($correction->removalPreview($this->findOwnedSession($sessionId)));
    }

    /** DELETE /api/payouts/lessons/{id} — take a lesson off the salary and the books. */
    public function destroy(PayrollLessonCorrection $correction, string $sessionId): JsonResponse
    {
        Gate::authorize('payout.adjust');

        $this->findOwnedSession($sessionId);

        return response()->json($correction->remove($sessionId, (string) $this->ctx()->userId, $this->ctx()->role));
    }

    /** GET /api/payouts/lessons/{id}/duration-preview — exact effect of a new length, sealed months included. */
    public function durationPreview(Request $request, SessionDurationCorrection $correction, string $sessionId): JsonResponse
    {
        Gate::authorize('payout.adjust');

        $session = $this->findOwnedSession($sessionId);
        $data = $request->validate(['duration_minutes' => ['required', 'integer', 'min:1', 'max:600']]);

        return response()->json($correction->preview($session, (int) $data['duration_minutes'], carrySealed: true));
    }

    /** PATCH /api/payouts/lessons/{id}/duration — apply it. */
    public function updateDuration(Request $request, SessionDurationCorrection $correction, string $sessionId): JsonResponse
    {
        Gate::authorize('payout.adjust');

        $this->findOwnedSession($sessionId);
        $data = $request->validate(['duration_minutes' => ['required', 'integer', 'min:1', 'max:600']]);

        return response()->json($correction->update(
            $sessionId,
            (int) $data['duration_minutes'],
            (string) $this->ctx()->userId,
            $this->ctx()->role,
            carrySealed: true,
        ));
    }
}
