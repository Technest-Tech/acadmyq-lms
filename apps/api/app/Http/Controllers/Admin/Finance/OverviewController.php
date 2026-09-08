<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin\Finance;

use App\Http\Controllers\Controller;
use App\Services\FinanceLedger;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

/**
 * Super Admin → Finance → Overview: the owner's income at a glance (see FinanceLedger).
 *
 * Platform-scoped and `platform.manage` only, like every finance endpoint: this is the owner's
 * own money book, held by no academy. The RLS policies on the finance_* tables repeat the gate
 * on the database side, so a missing Gate call returns nothing rather than the owner's books.
 */
final class OverviewController extends Controller
{
    /** GET /api/admin/finance/overview */
    public function __invoke(FinanceLedger $ledger): JsonResponse
    {
        Gate::authorize('platform.manage');

        return response()->json($ledger->overview());
    }
}
