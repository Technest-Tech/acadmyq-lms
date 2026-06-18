<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Super Admin billing & revenue overview (admin panel — Phase 5). A single audited read
 * (`app.admin_billing_overview()` SECURITY DEFINER) returning MRR grouped per currency, the
 * academy-status breakdown, and a per-academy monthly-value table. Read-only — no payment
 * provider yet. Gated by `plan.manage`; the function re-asserts SUPER_ADMIN internally.
 */
final class BillingController extends Controller
{
    /** GET /api/admin/billing/overview — MRR by currency + per-academy billing rows. */
    public function overview(): JsonResponse
    {
        Gate::authorize('plan.manage');

        $data = json_decode(
            DB::selectOne('select app.admin_billing_overview() as b')->b,
            true,
        );

        return response()->json($data);
    }
}
