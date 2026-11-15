<?php

declare(strict_types=1);

namespace App\Http\Controllers\People;

use App\Http\Controllers\Controller;
use App\Http\Controllers\People\Concerns\InteractsWithPeople;
use App\Services\SupervisorHandover;
use App\Support\DoneBy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * GET /api/team/actors — the academy's team logins, for the "Done by" filter on the students,
 * teachers, parents, trials and attendance lists ({@see DoneBy::team()}).
 *
 * Open to anyone who can read one of those lists, except a TEACHER: a teacher sees no "Done by"
 * column, and the team's names are not theirs to browse. The list screens only offer the filter
 * once it holds more than one person.
 */
final class TeamActorController extends Controller
{
    use InteractsWithPeople;

    public function index(): JsonResponse
    {
        if ($this->ctx()->role === 'TEACHER'
            || ! Gate::any(['student.read', 'teacher.read', 'guardian.read', 'trial.read', 'session.read'])) {
            abort(403);
        }

        return response()->json(['actors' => DoneBy::team($this->currentAcademyId())]);
    }

    /**
     * GET /api/team/handover — everyone who answers for students, teachers or parents, with how
     * many, including supervisors no longer on the team (switched off, role removed, account gone)
     * and the records nobody added ({@see SupervisorHandover::owners()}). staff.update.
     */
    public function handoverOwners(SupervisorHandover $handover): JsonResponse
    {
        Gate::authorize('staff.update');

        return response()->json(['owners' => $handover->owners($this->currentAcademyId())]);
    }

    /**
     * GET /api/team/actors/{userId}/handover — how many students, teachers and parents this login
     * answers for (added, or handed to them), for the staff page's "hand over" card. staff.update.
     */
    public function handoverCounts(SupervisorHandover $handover, string $userId): JsonResponse
    {
        Gate::authorize('staff.update');
        abort_unless(Str::isUuid($userId) || $userId === SupervisorHandover::NOBODY, 404);

        return response()->json(['counts' => $handover->counts($this->currentAcademyId(), $userId)]);
    }

    /**
     * POST /api/team/actors/{userId}/handover — give what this login answers for to another member
     * of the team ({@see SupervisorHandover}). staff.update: moving people between supervisors is
     * running the team, which a supervisor does not do.
     */
    public function handover(Request $request, SupervisorHandover $handover, string $userId): JsonResponse
    {
        Gate::authorize('staff.update');
        abort_unless(Str::isUuid($userId) || $userId === SupervisorHandover::NOBODY, 404);

        $data = $request->validate([
            'to_user_id' => ['required', 'uuid'],
            'types' => ['required', 'array', 'min:1'],
            'types.*' => ['required', 'string', 'distinct', Rule::in(array_keys(DoneBy::HANDOVER_ENTITIES))],
        ]);

        $moved = $handover->transfer(
            $this->currentAcademyId(),
            $userId,
            (string) $data['to_user_id'],
            array_values($data['types']),
            $this->ctx()->userId,
            $this->ctx()->role,
        );

        return response()->json(['moved' => $moved]);
    }
}
