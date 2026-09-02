<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * The in-app notification feed that backs the Notifications "Reports" tab plus the sidebar
 * unread badge. Rows are written by FlagOverdueReportsJob (REPORT_OVERDUE → the owner(s)) and
 * cleared when the report is finally filed. The Notifications page is owner-only (notification.read
 * is an ACADEMY_OWNER capability), so the feed always shows the academy-wide owner alerts.
 */
final class NotificationController extends Controller
{
    use InteractsWithScheduling;

    /**
     * GET /api/notifications — the report alerts visible to the caller, newest first.
     * notification.read.
     */
    public function index(): JsonResponse
    {
        Gate::authorize('notification.read');

        $rows = $this->visibleQuery()
            ->orderByDesc('n.created_at')
            ->limit(200)
            ->get(['n.id', 'n.type', 'n.category', 'n.session_id', 'n.subject_id', 'n.data', 'n.read_at', 'n.created_at'])
            ->map(function ($n) {
                $n->data = $n->data !== null ? (json_decode($n->data, true) ?: []) : [];
                $n->read_at = $n->read_at !== null ? Carbon::parse($n->read_at)->utc()->toIso8601String() : null;
                $n->created_at = Carbon::parse($n->created_at)->utc()->toIso8601String();

                return $n;
            });

        return response()->json(['notifications' => $rows]);
    }

    /**
     * GET /api/notifications/summary — the unread counts that drive the sidebar badge, split by
     * the two tabs (classes = cancellation approvals, reports = overdue-report alerts).
     * notification.read.
     */
    public function summary(): JsonResponse
    {
        Gate::authorize('notification.read');

        // The "Reports" tab is about overdue session reports, so package alerts must not inflate
        // it just because they share the notifications table. Each category counts for its own tab.
        $reports = (int) $this->visibleQuery()
            ->whereNull('n.read_at')
            ->where('n.category', '!=', 'PACKAGES')
            ->count();

        $packages = (int) $this->visibleQuery()
            ->whereNull('n.read_at')
            ->where('n.category', 'PACKAGES')
            ->count();

        $classes = (int) DB::table('session_cancellation_requests')->where('status', 'PENDING')->count();

        // Pending student progress reports awaiting the owner's review (drives the "Student
        // Reports" tab badge only — deliberately NOT folded into `total`/the sidebar bell count).
        $studentReports = (int) DB::table('student_progress_reports')->where('status', 'PENDING')->count();

        return response()->json([
            'classes' => $classes,
            'reports' => $reports,
            'packages' => $packages,
            'studentReports' => $studentReports,
            'total' => $classes + $reports + $packages,
        ]);
    }

    /** POST /api/notifications/{id}/read — mark one alert read. notification.read. */
    public function markRead(string $id): JsonResponse
    {
        Gate::authorize('notification.read');

        $updated = $this->visibleQuery()->where('n.id', $id)->whereNull('n.read_at')
            ->update(['read_at' => now()]);

        if ($updated === 0 && $this->visibleQuery()->where('n.id', $id)->doesntExist()) {
            abort(404, 'Notification not found.');
        }

        return response()->json(['ok' => true]);
    }

    /** POST /api/notifications/read-all — mark every visible alert read. notification.read. */
    public function markAllRead(): JsonResponse
    {
        Gate::authorize('notification.read');

        $marked = $this->visibleQuery()->whereNull('n.read_at')->update(['read_at' => now()]);

        return response()->json(['ok' => true, 'marked' => $marked]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /**
     * The set of notifications the caller may see: the academy-wide owner alerts
     * (audience_role ACADEMY_OWNER). RLS already pins the academy, so this is purely the
     * in-academy audience filter. Only owners reach this (notification.read is owner-only).
     */
    private function visibleQuery()
    {
        return DB::table('notifications as n')->where('n.audience_role', 'ACADEMY_OWNER');
    }
}
