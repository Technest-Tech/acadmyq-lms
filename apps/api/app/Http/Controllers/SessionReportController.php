<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Writing a session report demonstrates the "RLS-plus-filter" teacher scoping (Sprint 2
 * §3.6): academy isolation is DB-enforced (RLS), and a TEACHER is further limited at the
 * app layer to their *own* sessions. Owners/Super Admins carry the capability without the
 * per-teacher filter. Full reporting UI is Sprint 5; this is the authorization seam.
 */
final class SessionReportController extends Controller
{
    /** POST /api/sessions/{id}/report — gated by session.write_report (+ teacher filter). */
    public function store(Request $request, string $sessionId): JsonResponse
    {
        Gate::authorize('session.write_report');

        $session = DB::table('sessions')->where('id', $sessionId)->first();
        if ($session === null) {
            abort(404, 'Session not found.');
        }

        $ctx = app(AuthContext::class);
        $user = $request->user();

        // Teacher-level row filter (§3.6): a teacher may only report on sessions they teach.
        if ($ctx->role === 'TEACHER') {
            $teacherId = DB::table('teachers')->where('user_id', $user->getKey())->value('id');
            if ($teacherId === null || $session->teacher_id !== $teacherId) {
                abort(403, 'Not your session.');
            }
        }

        DB::table('session_reports')->updateOrInsert(
            ['session_id' => $sessionId],
            [
                'academy_id' => $session->academy_id,
                'values' => json_encode($request->input('values', [])),
                'filled_by_user_id' => $user->getKey(),
                'filled_at' => now(),
            ]
        );

        return response()->json(['ok' => true]);
    }
}
