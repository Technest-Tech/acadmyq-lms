<?php

declare(strict_types=1);

namespace App\Http\Controllers\Centre;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Services\GroupLessonGenerator;
use App\Services\HolidayClosures;
use App\Services\SessionGenerator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A learning centre's holidays (docs/centre-profile, Phase 2 §3) — `/api/holidays`, behind
 * `entitled:centre`. Anyone signed in may read the list (the board shows the badge); writing one
 * is the academy's own settings (`settings.manage`).
 *
 * The rule, in full in {@see HolidayClosures}: declaring a holiday cancels the pending lessons dated
 * inside it from today on (group lessons reason HOLIDAY, private lessons CANCELLED_BY_TEACHER with
 * the same marker); the generators stop creating lessons on its days; deleting it restores the
 * lessons it cancelled that are still to come and not inside another holiday, then regenerates so
 * the days it blocked are filled in. Nothing before today is ever touched, nor anything held, moved
 * or cancelled for another reason.
 *
 * Each write runs as one DB::transaction: a refusal anywhere in it leaves no half-declared holiday
 * (the request's own transaction commits past a 422).
 */
final class HolidayController extends Controller
{
    use InteractsWithScheduling;

    public function __construct(private readonly HolidayClosures $closures) {}

    /** GET /api/holidays — every holiday, newest first, with what stands cancelled in its days. */
    public function index(): JsonResponse
    {
        return response()->json(['holidays' => $this->closures->listFor($this->currentAcademyId())]);
    }

    /** GET /api/holidays/preview?starts_on=&ends_on= — what declaring this range would cancel. */
    public function preview(Request $request): JsonResponse
    {
        Gate::authorize('settings.manage');

        $data = $request->validate($this->rangeRules());

        return response()->json($this->closures->preview($this->currentAcademyId(), $data['starts_on'], $data['ends_on']));
    }

    /** POST /api/holidays — declare it and cancel the pending lessons inside it. */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('settings.manage');

        $data = $request->validate(['name' => ['required', 'string', 'max:120']] + $this->rangeRules());
        $academyId = $this->currentAcademyId();

        $result = DB::transaction(fn () => $this->closures->apply(
            $academyId,
            trim($data['name']),
            $data['starts_on'],
            $data['ends_on'],
            $this->ctx()->userId,
            $this->ctx()->role,
        ));

        $holiday = collect($this->closures->listFor($academyId))->firstWhere('id', $result['id']);

        return response()->json([
            'holiday' => $holiday,
            'cancelled' => ['group_lessons' => $result['group_lessons'], 'sessions' => $result['sessions']],
        ], 201);
    }

    /** DELETE /api/holidays/{id} — remove it and bring back what it cancelled that is still to come. */
    public function destroy(string $id, SessionGenerator $sessions, GroupLessonGenerator $groups): JsonResponse
    {
        Gate::authorize('settings.manage');

        $academyId = $this->currentAcademyId();
        $holiday = DB::table('academy_holidays')->where('id', $id)->where('academy_id', $academyId)->first();
        if ($holiday === null) {
            abort(404, 'Holiday not found.');
        }

        $restored = DB::transaction(function () use ($holiday, $academyId, $sessions, $groups): array {
            $restored = $this->closures->lift($holiday, $this->ctx()->userId, $this->ctx()->role);

            // The days it blocked are open again: fill them in now rather than on the next roll. The
            // generators were built for this request, so they read the table as it now stands.
            [$windowStart, $windowEnd] = SessionGenerator::defaultWindow();
            $sessions->generateForAcademy($academyId, $windowStart, $windowEnd);
            if (GroupLessonGenerator::enabledFor($academyId)) {
                $groups->generateForAcademy($academyId, $windowStart, $windowEnd);
            }

            return $restored;
        });

        return response()->json(['ok' => true, 'restored' => $restored]);
    }

    /** @return array<string, list<mixed>> */
    private function rangeRules(): array
    {
        return [
            'starts_on' => ['required', 'date_format:Y-m-d'],
            'ends_on' => ['required', 'date_format:Y-m-d', 'after_or_equal:starts_on', function (string $attribute, mixed $value, callable $fail): void {
                $from = request()->input('starts_on');
                if (is_string($from) && strtotime($value) - strtotime($from) > 366 * 86400) {
                    $fail('A holiday is at most a year long. / أقصى مدة للأجازة سنة واحدة.');
                }
            }],
        ];
    }
}
