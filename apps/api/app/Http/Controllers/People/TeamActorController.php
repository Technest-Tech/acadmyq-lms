<?php

declare(strict_types=1);

namespace App\Http\Controllers\People;

use App\Http\Controllers\Controller;
use App\Http\Controllers\People\Concerns\InteractsWithPeople;
use App\Support\DoneBy;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

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
}
