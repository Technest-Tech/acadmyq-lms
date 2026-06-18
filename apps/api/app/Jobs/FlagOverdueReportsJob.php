<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Tenancy;
use App\Support\TenantContext;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The hourly "report overdue" sweep (Notifications "Reports" tab). For every active academy, find
 * sessions that ended at least {GRACE_HOURS} hours ago but still carry no report and were not
 * cancelled/rescheduled — i.e. the teacher hasn't recorded the outcome/report. Each such session
 * raises an in-app alert to the owner(s) (REPORT_OVERDUE). The Notifications page is owner-only, so
 * no teacher-facing reminder is written. Idempotent: a unique (session_id, type) index means
 * re-runs never duplicate, and filing the report clears the alert (SessionReportController::put).
 *
 * Mirrors RollSessionWindowJob's tenancy discipline: each academy's work runs in its OWN
 * Tenancy::withContext transaction so the job never crosses an academy boundary.
 */
final class FlagOverdueReportsJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    /** A report is "overdue" this many hours after the session's end. */
    private const GRACE_HOURS = 2;

    /** Don't flag sessions older than this — a backstop so a first run never floods on history. */
    private const LOOKBACK_DAYS = 14;

    /** Statuses that still owe a report (delivered/undecided occurrences). */
    private const NEEDS_REPORT = ['SCHEDULED', 'ATTENDED', 'FREE'];

    public function __construct(private readonly ?string $onlyAcademyId = null) {}

    /**
     * @return array<string, int> academyId → number of sessions newly flagged
     */
    public function handle(): array
    {
        $cutoffEnd = now()->subHours(self::GRACE_HOURS);   // session end must be at/before this
        $lookback = now()->subDays(self::LOOKBACK_DAYS);   // and not older than this

        $results = [];
        foreach ($this->targetAcademyIds() as $academyId) {
            $ctx = new AuthContext(
                userId: self::SYSTEM_USER_ID,
                academyId: $academyId,
                role: 'SUPER_ADMIN', // tenant policies key on academy_id; this scopes the writes
                permissions: [],
            );

            $results[$academyId] = Tenancy::withContext($ctx, function () use ($academyId, $cutoffEnd, $lookback) {
                return $this->flagForAcademy($academyId, $cutoffEnd, $lookback);
            });
        }

        return $results;
    }

    private function flagForAcademy(string $academyId, \Illuminate\Support\Carbon $cutoffEnd, \Illuminate\Support\Carbon $lookback): int
    {
        $overdue = DB::table('sessions as se')
            ->leftJoin('session_reports as sr', 'sr.session_id', '=', 'se.id')
            ->leftJoin('teachers as te', 'te.id', '=', 'se.teacher_id')
            ->leftJoin('students as st', 'st.id', '=', 'se.student_id')
            ->whereNull('sr.id')
            ->whereIn('se.status', self::NEEDS_REPORT)
            ->whereRaw('se.scheduled_at_utc + make_interval(mins => se.duration_minutes) <= ?', [$cutoffEnd->format('Y-m-d H:i:sP')])
            ->where('se.scheduled_at_utc', '>=', $lookback->format('Y-m-d H:i:sP'))
            ->select([
                'se.id', 'se.scheduled_at_utc', 'se.duration_minutes', 'se.status',
                'se.teacher_id', 'st.full_name as student_name', 'te.full_name as teacher_name',
            ])
            ->limit(1000)
            ->get();

        $flagged = 0;
        foreach ($overdue as $s) {
            $data = json_encode([
                'student_name' => $s->student_name,
                'teacher_name' => $s->teacher_name,
                'teacher_id' => (string) $s->teacher_id,
                'scheduled_at_utc' => \Illuminate\Support\Carbon::parse($s->scheduled_at_utc)->utc()->toIso8601String(),
                'duration_minutes' => (int) $s->duration_minutes,
                'session_status' => $s->status,
            ], JSON_UNESCAPED_UNICODE);

            // Owner alert (academy-wide). insertOrIgnore + unique (session_id, type) = idempotent.
            // The Notifications page is owner-only, so no teacher reminder is raised.
            $inserted = DB::table('notifications')->insertOrIgnore([
                'id' => (string) Str::uuid(),
                'academy_id' => $academyId,
                'type' => 'REPORT_OVERDUE',
                'category' => 'REPORTS',
                'audience_role' => 'ACADEMY_OWNER',
                'recipient_user_id' => null,
                'session_id' => $s->id,
                'data' => $data,
            ]);
            $flagged += $inserted;
        }

        if ($flagged > 0) {
            // Attribute the scheduled sweep to no human (actor null) — `trigger: scheduled`
            // records that it was the system. (audit_log.actor_user_id is nullable.)
            Audit::log('notifications.report_overdue_run', 'academy', $academyId, $academyId, null, 'SUPER_ADMIN', after: [
                'flagged' => $flagged,
                'trigger' => 'scheduled',
            ]);
        }

        return $flagged;
    }

    /**
     * The academies to sweep. Listing all academies needs a Super-Admin context; we set it at
     * session scope only for the read, then clear it before each per-academy transaction
     * (identical discipline to RollSessionWindowJob).
     *
     * @return list<string>
     */
    private function targetAcademyIds(): array
    {
        if ($this->onlyAcademyId !== null) {
            return [$this->onlyAcademyId];
        }

        TenantContext::apply(userId: self::SYSTEM_USER_ID, academyId: null, role: 'SUPER_ADMIN', local: false);
        try {
            return DB::table('academies')
                ->where('status', 'ACTIVE')
                ->pluck('id')
                ->map(fn ($id) => (string) $id)
                ->all();
        } finally {
            TenantContext::clear();
        }
    }
}
