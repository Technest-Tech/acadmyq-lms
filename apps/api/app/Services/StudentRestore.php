<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Audit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Bring a removed student back as they were the moment before the delete — the Super Admin's
 * restore (Admin\ClientDeletedController), not the academy's own "reactivate", which deliberately
 * starts the student over with a clean slate.
 *
 * {@see StudentWindDown} is undone piece by piece. The delete does not record the ids it touched,
 * so each piece is found by its own marker (a reason string the wind-down wrote) or, where it wrote
 * none, by having changed around the moment of the delete — a window of a few hours either side,
 * because PHP-written and trigger-written timestamps on prod can sit an hour apart.
 *
 * Brought back: the family (when it was deleted too), the monthly subscription, the teacher(s),
 * group places, a centre's blocks (with a fresh bill when the old one was voided — a VOID bill is
 * terminal), the timetable and its coming lessons, the lessons the removal cancelled or hid, and a
 * trial still in the future. Left as they are, and said so: a Quran lesson package (closing it may
 * have billed the hours used), a settled centre block, money let go with the delete, and anything
 * whose teacher or group is gone.
 *
 * Runs inside the caller's transaction and tenant context.
 */
final class StudentRestore
{
    /** How far either side of the delete a change without a marker still counts as the delete's. */
    public const WINDOW_HOURS = 3;

    /** The status_reason the lesson-delete tombstone writes (SessionController::deleteLesson). */
    private const LESSON_DELETED_REASON = 'Deleted / حُذفت';

    public function __construct(
        private readonly SessionGenerator $generator,
        private readonly SubscriptionBilling $billing,
    ) {}

    /**
     * @return array{done: list<array<string, mixed>>, skipped: list<array<string, mixed>>}
     */
    public function run(string $studentId, ?string $actorUserId, string $actorRole = 'SUPER_ADMIN'): array
    {
        $student = DB::table('students')->where('id', $studentId)->first();
        if ($student === null || $student->deleted_at === null) {
            abort(409, 'This student is not deleted.');
        }

        $academyId = (string) $student->academy_id;
        $at = Carbon::parse((string) $student->deleted_at);
        $window = [$at->copy()->subHours(self::WINDOW_HOURS), $at->copy()->addHours(self::WINDOW_HOURS)];
        $done = [];
        $skipped = [];

        // Someone with the same name is on the roster: probably added again after the delete.
        $twin = DB::table('students')->where('academy_id', $academyId)->whereNull('deleted_at')
            ->where('id', '<>', $studentId)->where('full_name', $student->full_name)->exists();
        if ($twin) {
            $skipped[] = ['key' => 'same_name_active', 'label' => (string) $student->full_name];
        }

        // ── The student, and the family they sit in ───────────────────────
        if ($student->guardian_id !== null) {
            $guardian = DB::table('guardians')->where('id', $student->guardian_id)->first(['id', 'full_name', 'deleted_at']);
            if ($guardian !== null && $guardian->deleted_at !== null) {
                DB::table('guardians')->where('id', $guardian->id)->update(['deleted_at' => null, 'updated_at' => now()]);
                $done[] = ['key' => 'family', 'label' => (string) $guardian->full_name];
            }
        }
        DB::table('students')->where('id', $studentId)->update(['deleted_at' => null, 'updated_at' => now()]);
        $done[] = ['key' => 'student', 'label' => (string) $student->full_name];

        // ── The monthly subscription (only when nothing has replaced it) ──
        $hasActive = DB::table('subscriptions')->where('student_id', $studentId)->where('status', 'ACTIVE')->whereNull('deleted_at')->exists();
        if (! $hasActive) {
            $ended = DB::table('subscriptions')->where('student_id', $studentId)->where('status', 'ENDED')->whereNull('deleted_at')
                ->whereBetween('updated_at', $window)->orderByDesc('updated_at')->first(['id']);
            if ($ended !== null) {
                DB::table('subscriptions')->where('id', $ended->id)->update(['status' => 'ACTIVE', 'updated_at' => now()]);
                $done[] = ['key' => 'subscription'];
            }
        }

        // ── Teachers ─────────────────────────────────────────────────────
        $assignments = DB::table('student_teacher_assignments')->where('student_id', $studentId)
            ->whereNotNull('ended_at')->whereBetween('ended_at', $window)->get(['id', 'teacher_id', 'course']);
        foreach ($assignments as $a) {
            $teacher = DB::table('teachers')->where('id', $a->teacher_id)->first(['full_name', 'deleted_at']);
            if ($teacher === null || $teacher->deleted_at !== null) {
                $skipped[] = ['key' => 'teacher_gone', 'label' => $teacher?->full_name];

                continue;
            }
            $open = DB::table('student_teacher_assignments')->where('student_id', $studentId)->where('teacher_id', $a->teacher_id)
                ->whereNull('ended_at')->where(fn ($q) => $a->course === null ? $q->whereNull('course') : $q->where('course', $a->course))->exists();
            if (! $open) {
                DB::table('student_teacher_assignments')->where('id', $a->id)->update(['ended_at' => null, 'updated_at' => now()]);
            }
            $done[] = ['key' => 'teacher', 'label' => (string) $teacher->full_name];
        }

        // ── Group places ─────────────────────────────────────────────────
        $places = DB::table('class_group_members as m')->join('class_groups as g', 'g.id', '=', 'm.group_id')
            ->where('m.student_id', $studentId)->where('m.status', 'LEFT')->where('m.left_reason', StudentWindDown::REASON)
            ->whereBetween('m.updated_at', $window)->get(['m.id', 'm.group_id', 'g.name', 'g.status']);
        foreach ($places as $p) {
            $alreadyIn = DB::table('class_group_members')->where('group_id', $p->group_id)->where('student_id', $studentId)->where('status', 'ACTIVE')->exists();
            if ($p->status !== 'ACTIVE') {
                $skipped[] = ['key' => 'group_closed', 'label' => (string) $p->name];

                continue;
            }
            if (! $alreadyIn) {
                DB::table('class_group_members')->where('id', $p->id)->update(['status' => 'ACTIVE', 'left_on' => null, 'left_reason' => null, 'updated_at' => now()]);
            }
            $done[] = ['key' => 'group', 'label' => (string) $p->name];
        }

        // ── A centre's blocks ────────────────────────────────────────────
        $blocks = DB::table('centre_subscriptions')->where('student_id', $studentId)->where('closed_reason', 'STUDENT_REMOVED')
            ->whereIn('status', ['CANCELLED', 'CLOSED'])->whereBetween('closed_at', $window)->get();
        $academy = $blocks->isNotEmpty() ? DB::table('academies')->where('id', $academyId)->first() : null;
        foreach ($blocks as $b) {
            if ($b->settlement !== null && $b->settlement !== 'PENDING') {
                $skipped[] = ['key' => 'block_settled', 'label' => (string) $b->label];

                continue;
            }
            $replaced = DB::table('centre_subscriptions')->where('student_id', $studentId)->where('status', 'OPEN')->where('id', '<>', $b->id)
                ->where(fn ($q) => $b->teacher_id === null ? $q->whereNull('teacher_id') : $q->where('teacher_id', $b->teacher_id))
                ->where(fn ($q) => $b->course === null ? $q->whereNull('course') : $q->where('course', $b->course))->exists();
            if ($replaced) {
                $skipped[] = ['key' => 'block_replaced', 'label' => (string) $b->label];

                continue;
            }
            DB::table('centre_subscriptions')->where('id', $b->id)->update([
                'status' => 'OPEN', 'closed_at' => null, 'closed_reason' => null, 'closed_by' => null, 'settlement' => null, 'updated_at' => now(),
            ]);
            $bill = $b->invoice_id !== null ? DB::table('invoices')->where('id', $b->invoice_id)->value('status') : null;
            $rebilled = false;
            if ($bill === 'VOID') {
                // A VOID bill can never reopen (trg_invoice_immutable): the block gets a new one.
                $this->billing->raise(DB::table('centre_subscriptions')->where('id', $b->id)->first(), $academy, $actorUserId, $actorRole);
                $rebilled = true;
            }
            $done[] = ['key' => $rebilled ? 'block_rebilled' : 'block', 'label' => (string) $b->label];
        }

        // ── A Quran lesson package: not reopened ─────────────────────────
        foreach (DB::table('lesson_packages')->where('student_id', $studentId)->where('closed_reason', 'STUDENT_REMOVED')
            ->whereBetween('closed_at', $window)->get(['label']) as $pkg) {
            $skipped[] = ['key' => 'package_closed', 'label' => $pkg->label];
        }

        // ── Lessons the removal cancelled or hid ─────────────────────────
        $cancelled = DB::table('sessions')->where('student_id', $studentId)->where('status', 'CANCELLED_BY_STUDENT')
            ->where('status_reason', StudentWindDown::REASON)->pluck('id');
        if ($cancelled->isNotEmpty()) {
            DB::table('sessions')->whereIn('id', $cancelled)->update(['status' => 'SCHEDULED', 'status_reason' => null, 'updated_at' => now()]);
            DB::table('session_cancellation_requests')->whereIn('session_id', $cancelled)->where('status', 'REJECTED')
                ->where('decision_note', StudentWindDown::REASON)
                ->update(['status' => 'PENDING', 'decided_by_user_id' => null, 'decided_at' => null, 'decision_note' => null, 'updated_at' => now()]);
            $done[] = ['key' => 'lessons_reopened', 'n' => $cancelled->count()];
        }

        // A lesson deleted on its own (the tombstone) stays hidden.
        $tombstones = DB::table('audit_log')->where('academy_id', $academyId)->where('action', 'session.deleted')
            ->where('entity_type', 'session')->pluck('entity_id')->map(fn ($id) => (string) $id)->all();
        $unhidden = DB::table('sessions')->where('student_id', $studentId)->whereNotNull('hidden_at')
            ->whereBetween('hidden_at', $window)
            ->where(fn ($q) => $q->whereNull('status_reason')->orWhere('status_reason', '<>', self::LESSON_DELETED_REASON))
            ->when($tombstones !== [], fn ($q) => $q->whereNotIn('id', $tombstones))
            ->update(['hidden_at' => null]);
        if ($unhidden > 0) {
            $done[] = ['key' => 'lessons_shown', 'n' => $unhidden];
        }

        // ── The timetable, and its lessons from today on ─────────────────
        $schedules = DB::table('schedules')->where('student_id', $studentId)->where('is_active', false)
            ->whereNotNull('deleted_at')->whereBetween('deleted_at', $window)->get(['id', 'teacher_id']);
        $created = 0;
        $revived = 0;
        foreach ($schedules as $s) {
            $teacherGone = $s->teacher_id !== null && ! DB::table('teachers')->where('id', $s->teacher_id)->whereNull('deleted_at')->exists();
            if ($teacherGone) {
                $skipped[] = ['key' => 'timetable_teacher_gone'];

                continue;
            }
            DB::table('schedules')->where('id', $s->id)->update(['is_active' => true, 'deleted_at' => null, 'updated_at' => now()]);
            [$from, $to] = SessionGenerator::defaultWindow();
            $created += (int) ($this->generator->generateForSchedule((string) $s->id, $from, $to)['created'] ?? 0);
            $revived++;
        }
        if ($revived > 0) {
            $done[] = ['key' => 'timetable', 'n' => $created];
        }

        // ── A trial still ahead ──────────────────────────────────────────
        $trials = DB::table('trials')->where('student_id', $studentId)->where('status', 'CANCELLED')->whereNull('deleted_at')
            ->whereBetween('updated_at', $window)->where('scheduled_at_utc', '>', now())
            ->update(['status' => 'SCHEDULED', 'updated_at' => now()]);
        if ($trials > 0) {
            $done[] = ['key' => 'trial_back', 'n' => $trials];
        }

        // ── Money the delete let go: told, not undone ────────────────────
        $deleteAudit = DB::table('audit_log')->where('academy_id', $academyId)->where('action', 'student.delete')
            ->where('entity_id', $studentId)->orderByDesc('created_at')->value('after');
        $letGo = (int) (json_decode((string) $deleteAudit, true)['dues_let_go'] ?? 0);
        if ($letGo > 0) {
            $skipped[] = ['key' => 'dues_let_go', 'n' => $letGo];
        }

        $report = ['done' => $done, 'skipped' => $skipped];
        Audit::log('student.restored', 'student', $studentId, $academyId, $actorUserId, $actorRole,
            after: $report, before: ['deleted_at' => (string) $student->deleted_at]);

        return $report;
    }
}
