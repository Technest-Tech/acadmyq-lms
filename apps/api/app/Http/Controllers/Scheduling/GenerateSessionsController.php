<?php

declare(strict_types=1);

namespace App\Http\Controllers\Scheduling;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Services\SessionGenerator;
use App\Support\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;

/**
 * Manual generator trigger (§8): re-materialise the current academy's sessions across the
 * rolling window. Idempotent — safe to hit repeatedly (TC-5.5/5.6). The monthly roll-forward
 * runs as a scheduled job (routes/console.php); this endpoint is the on-demand equivalent for
 * an Owner/Super-Admin who wants to extend or repair the window now.
 */
final class GenerateSessionsController extends Controller
{
    use InteractsWithScheduling;

    public function __construct(private readonly SessionGenerator $generator) {}

    /** POST /api/admin/generate-sessions  { from?, to? } — defaults to the rolling window. */
    public function __invoke(Request $request): JsonResponse
    {
        Gate::authorize('schedule.manage');

        $academyId = $this->currentAcademyId();

        $data = $request->validate([
            'from' => ['sometimes', 'nullable', 'date'],
            'to' => ['sometimes', 'nullable', 'date', 'after_or_equal:from'],
        ]);

        [$windowStart, $windowEnd] = SessionGenerator::defaultWindow();
        if (! empty($data['from'])) {
            $windowStart = Carbon::parse($data['from']);
        }
        if (! empty($data['to'])) {
            $windowEnd = Carbon::parse($data['to']);
        }

        $counts = $this->generator->generateForAcademy($academyId, $windowStart, $windowEnd);

        Audit::log('generator.run', 'academy', $academyId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'created' => $counts['created'],
            'removed' => $counts['removed'],
            'window' => [$windowStart->format('Y-m-d'), $windowEnd->format('Y-m-d')],
            'trigger' => 'manual',
        ]);

        return response()->json(['generated' => $counts]);
    }
}
