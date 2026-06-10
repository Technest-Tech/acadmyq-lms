<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Super Admin platform actions (Sprint 2 §4.4, §8). Listing every academy crosses tenant
 * boundaries, so it goes through the audited `app.admin_list_academies()` escape hatch
 * (Sprint 1 §7.4) — never a raw cross-tenant query. Enter/exit toggle the per-session
 * "entered academy" that the middleware turns into `app.current_academy_id` on the next
 * request.
 */
final class AcademyController extends Controller
{
    /** GET /api/admin/academies — platform-wide list via the audited function. */
    public function index(): JsonResponse
    {
        Gate::authorize('academy.read');

        $json = DB::selectOne('select app.admin_list_academies() as a')->a;

        return response()->json(['academies' => json_decode($json, true)]);
    }

    /** POST /api/admin/academies/{id}/enter — set entered academy + audit admin.enter_academy. */
    public function enter(Request $request, string $id): JsonResponse
    {
        Gate::authorize('academy.enter');

        $ctx = app(AuthContext::class);

        // Confirm the academy exists (a Super Admin can see every academy row, §7).
        $exists = DB::table('academies')->where('id', $id)->exists();
        if (! $exists) {
            abort(404, 'Academy not found.');
        }

        $request->session()->put('entered_academy_id', $id);

        Audit::log('admin.enter_academy', 'academy', $id, $id, $ctx->userId, $ctx->role);

        return response()->json(['enteredAcademyId' => $id]);
    }

    /** POST /api/admin/academies/exit — return to the platform (no-tenant) view. */
    public function exit(Request $request): JsonResponse
    {
        $request->session()->forget('entered_academy_id');

        return response()->json(['ok' => true]);
    }
}
