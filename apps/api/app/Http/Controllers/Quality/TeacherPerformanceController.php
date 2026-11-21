<?php

declare(strict_types=1);

namespace App\Http\Controllers\Quality;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Services\TeacherPerformance;
use App\Support\Audit;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Teacher performance — the monthly evaluation page (/teacher-quality).
 *
 * For a month, every teacher gets four parts and a total ({@see TeacherPerformance}): the
 * supervisor's lesson visits, the reports written after lessons and trials, entering lessons on
 * time, and conduct. The first and last are typed in here by the supervisor; the middle two are
 * read from what the system already records.
 *
 * Who may do what:
 *   • read  — `teacher_quality.insights` (the owner's scorecard) OR `teacher_quality.read`: the
 *     supervisor who writes the evaluation has to see the page it is written on.
 *   • write a note or a visit — `teacher_quality.manage`.
 *   • change the weights, points and lists — `settings.manage`: they decide every teacher's
 *     number, so they are the academy's call, not the day's.
 */
final class TeacherPerformanceController extends Controller
{
    use InteractsWithScheduling;

    /** GET /api/teacher-performance?month=YYYY-MM */
    public function index(Request $request): JsonResponse
    {
        $this->authorizeRead();
        $academyId = $this->currentAcademyId();
        $settings = TeacherPerformance::settings($academyId);
        $window = TeacherPerformance::window($this->month($request, $academyId), $this->academyTimezone($academyId));
        $month = $window['month'];

        $scored = TeacherPerformance::monthly($academyId, $window, $settings);

        // Every current teacher is listed — one with nothing this month is still on the staff —
        // plus anyone who has since left but was taught, visited or noted in the month.
        $teachers = DB::table('teachers')
            ->where('academy_id', $academyId)
            ->where(function ($q) use ($scored): void {
                $q->where(fn ($q) => $q->whereNull('deleted_at')->where('is_active', true));
                if ($scored !== []) {
                    $q->orWhereIn('id', array_keys($scored));
                }
            })
            ->orderBy('full_name')
            ->get(['id', 'full_name', 'is_active', 'deleted_at', 'meeting_url']);

        $blank = TeacherPerformance::blank($settings);
        $list = [];
        $summary = [
            'teachers' => 0, 'scored' => 0, 'total_sum' => 0.0,
            'visits' => 0, 'visited' => 0, 'visits_due' => 0,
            'reports_missing' => 0, 'notes' => 0, 'unclassified' => 0,
        ];
        foreach ($teachers as $te) {
            $row = $scored[(string) $te->id][$month] ?? $blank;
            $active = (bool) $te->is_active && $te->deleted_at === null;
            $list[] = $this->teacher($te) + $row;

            $summary['teachers']++;
            if ($row['total'] !== null) {
                $summary['scored']++;
                $summary['total_sum'] += $row['total'];
            }
            $summary['visits'] += $row['quality']['visits'];
            // A visit is owed to a teacher who is on the staff and taught this month.
            if ($active && $row['lessons']['total'] > 0) {
                $summary['visits_due']++;
                $summary['visited'] += $row['quality']['visits'] > 0 ? 1 : 0;
            }
            $summary['reports_missing'] += $row['reports']['missing'];
            $summary['notes'] += $row['conduct']['absences'] + $row['conduct']['apologies'] + $row['conduct']['violations'];
            $summary['unclassified'] += $row['conduct']['unclassified'];
        }

        return response()->json([
            'month' => $month,
            'timezone' => $window['timezone'],
            'settings' => $settings,
            'can' => $this->abilities(),
            'summary' => [
                'teachers' => $summary['teachers'],
                'average' => $summary['scored'] > 0 ? round($summary['total_sum'] / $summary['scored'], 1) : null,
                'visits' => $summary['visits'],
                'visited' => $summary['visited'],
                'visits_due' => $summary['visits_due'],
                'reports_missing' => $summary['reports_missing'],
                'notes' => $summary['notes'],
                'unclassified' => $summary['unclassified'],
            ],
            'teachers' => $list,
        ]);
    }

    /** GET /api/teacher-performance/teachers/{id}?month=YYYY-MM — everything behind one teacher's month. */
    public function show(Request $request, string $teacherId): JsonResponse
    {
        $this->authorizeRead();
        $academyId = $this->currentAcademyId();
        $teacher = $this->findTeacher($teacherId);
        $settings = TeacherPerformance::settings($academyId);
        $tz = $this->academyTimezone($academyId);
        $month = $this->month($request, $academyId);
        $window = TeacherPerformance::window($month, $tz);

        $scored = TeacherPerformance::monthly($academyId, $window, $settings, $teacherId);

        // The trend re-reads the months before with the same definition, never a stored number.
        $trendWindow = TeacherPerformance::window($month, $tz, TeacherPerformance::TREND_MONTHS - 1);
        $history = TeacherPerformance::monthly($academyId, $trendWindow, $settings, $teacherId)[$teacherId] ?? [];
        $trend = [];
        $cursor = CarbonImmutable::parse($month.'-01');
        for ($i = TeacherPerformance::TREND_MONTHS - 1; $i >= 0; $i--) {
            $key = $cursor->subMonths($i)->format('Y-m');
            $trend[] = [
                'month' => $key,
                'total' => $history[$key]['total'] ?? null,
                'quality' => $history[$key]['quality']['score'] ?? null,
                'reports' => $history[$key]['reports']['score'] ?? null,
                'entry' => $history[$key]['entry']['score'] ?? null,
                'conduct' => $history[$key]['conduct']['score'] ?? null,
            ];
        }

        $lessons = TeacherPerformance::lessons($academyId, $window, $settings, $teacherId);
        $truncated = count($lessons) > TeacherPerformance::LESSON_LIMIT;
        $lessons = array_slice($lessons, 0, TeacherPerformance::LESSON_LIMIT);

        $notes = DB::table('teacher_conduct_notes as n')
            ->leftJoin('sessions as se', 'se.id', '=', 'n.session_id')
            ->leftJoin('students as st', 'st.id', '=', 'se.student_id')
            ->where('n.teacher_id', $teacherId)
            ->whereNull('n.deleted_at')
            ->whereBetween('n.occurred_on', [$window['first_day'], $window['last_day']])
            ->orderByDesc('n.occurred_on')->orderByDesc('n.created_at')
            ->get(['n.*', 'se.scheduled_at_utc as lesson_at', 'st.full_name as lesson_student']);

        $visits = DB::table('teacher_lesson_visits as v')
            ->leftJoin('sessions as se', 'se.id', '=', 'v.session_id')
            ->leftJoin('students as st', 'st.id', '=', 'se.student_id')
            ->where('v.teacher_id', $teacherId)
            ->whereNull('v.deleted_at')
            ->whereBetween('v.visited_on', [$window['first_day'], $window['last_day']])
            ->orderByDesc('v.visited_on')->orderByDesc('v.created_at')
            ->get(['v.*', 'se.scheduled_at_utc as lesson_at', 'st.full_name as lesson_student']);

        return response()->json([
            'month' => $month,
            'timezone' => $tz,
            'settings' => $settings,
            'can' => $this->abilities(),
            'teacher' => $this->teacher($teacher) + ($scored[$teacherId][$month] ?? TeacherPerformance::blank($settings)),
            'trend' => $trend,
            'lessons' => array_map(fn (object $l): array => [
                'id' => (string) $l->id,
                'scheduled_at_utc' => $this->iso($l->scheduled_at_utc),
                'local_date' => CarbonImmutable::parse($l->scheduled_at_utc)->setTimezone($tz)->toDateString(),
                'duration_minutes' => (int) $l->duration_minutes,
                'status' => (string) $l->status,
                'student_name' => $l->student_name,
                'is_trial' => (bool) $l->is_trial,
                'noted' => (bool) $l->noted,
                'join_bucket' => (string) $l->join_bucket,
                'first_joined_at' => $this->iso($l->first_join),
                'join_delay_minutes' => $l->join_delay !== null ? (int) $l->join_delay : null,
                'presses' => (int) $l->presses,
                'report_bucket' => (string) $l->report_bucket,
                'reported_at' => $this->iso($l->reported_at),
                'report_delay_minutes' => $l->report_delay !== null ? (int) $l->report_delay : null,
            ], $lessons),
            'truncated' => $truncated,
            'notes' => $notes->map(fn (object $n): array => $this->note($n))->all(),
            'visits' => $visits->map(fn (object $v): array => $this->visit($v))->all(),
        ]);
    }

    /** GET /api/teacher-performance/settings */
    public function settings(): JsonResponse
    {
        $this->authorizeRead();

        return response()->json(['settings' => TeacherPerformance::settings($this->currentAcademyId()), 'can' => $this->abilities()]);
    }

    /** PUT /api/teacher-performance/settings — the whole sheet at once. */
    public function updateSettings(Request $request): JsonResponse
    {
        Gate::authorize('settings.manage');
        $this->authorizeRead();
        $academyId = $this->currentAcademyId();

        $data = $request->validate([
            'weights' => ['required', 'array'],
            'weights.quality' => ['required', 'integer', 'min:0', 'max:100'],
            'weights.reports' => ['required', 'integer', 'min:0', 'max:100'],
            'weights.entry' => ['required', 'integer', 'min:0', 'max:100'],
            'weights.conduct' => ['required', 'integer', 'min:0', 'max:100'],
            'points' => ['required', 'array'],
            'points.ABSENCE' => ['required', 'integer', 'min:0', 'max:100'],
            'points.APOLOGY' => ['required', 'integer', 'min:0', 'max:100'],
            'points.VIOLATION' => ['required', 'integer', 'min:0', 'max:100'],
            'visits_target' => ['required', 'integer', 'min:0', 'max:31'],
            'late_minutes' => ['required', 'integer', 'min:0', 'max:240'],
            'report_minutes' => ['required', 'integer', 'min:0', 'max:10080'],
            'criteria' => ['required', 'array', 'min:1', 'max:12'],
            'criteria.*.id' => ['nullable', 'string', 'max:64'],
            'criteria.*.name' => ['required', 'string', 'max:80'],
            'rules' => ['present', 'array', 'max:30'],
            'rules.*' => ['required', 'string', 'max:120'],
        ]);

        if (array_sum($data['weights']) !== 100) {
            throw ValidationException::withMessages(['weights' => 'The four weights must add up to 100.']);
        }

        // A criterion keeps its id across renames, so an old visit's answer still points at it.
        $criteria = [];
        $seen = [];
        foreach ($data['criteria'] as $c) {
            $name = trim((string) $c['name']);
            $id = isset($c['id']) && $c['id'] !== '' && ! isset($seen[$c['id']]) ? (string) $c['id'] : (string) Str::uuid();
            if ($name === '') {
                continue;
            }
            $seen[$id] = true;
            $criteria[] = ['id' => $id, 'name' => $name];
        }
        if ($criteria === []) {
            throw ValidationException::withMessages(['criteria' => 'Keep at least one thing to rate a lesson on.']);
        }
        $rules = array_values(array_unique(array_filter(array_map(static fn ($r): string => trim((string) $r), $data['rules']))));

        $before = TeacherPerformance::settings($academyId);
        $values = [
            'weight_quality' => $data['weights']['quality'],
            'weight_reports' => $data['weights']['reports'],
            'weight_entry' => $data['weights']['entry'],
            'weight_conduct' => $data['weights']['conduct'],
            'absence_points' => $data['points']['ABSENCE'],
            'apology_points' => $data['points']['APOLOGY'],
            'violation_points' => $data['points']['VIOLATION'],
            'visits_target' => $data['visits_target'],
            'late_minutes' => $data['late_minutes'],
            'report_minutes' => $data['report_minutes'],
            'criteria' => json_encode($criteria, JSON_UNESCAPED_UNICODE),
            'rules' => json_encode($rules, JSON_UNESCAPED_UNICODE),
            'updated_by' => $this->ctx()->userId,
        ];
        $exists = DB::table('teacher_performance_settings')->where('academy_id', $academyId)->exists();
        if ($exists) {
            DB::table('teacher_performance_settings')->where('academy_id', $academyId)->update($values);
        } else {
            DB::table('teacher_performance_settings')->insert($values + ['id' => (string) Str::uuid(), 'academy_id' => $academyId]);
        }

        $after = TeacherPerformance::settings($academyId);
        Audit::log('teacher_performance.settings', 'teacher_performance_settings', null, $academyId, $this->ctx()->userId, $this->ctx()->role, after: $after, before: $before);

        return response()->json(['settings' => $after, 'can' => $this->abilities()]);
    }

    // ── The supervisor's notes: absence, apology, a rule not kept ───────────────

    /** POST /api/teacher-performance/teachers/{id}/notes */
    public function storeNote(Request $request, string $teacherId): JsonResponse
    {
        Gate::authorize('teacher_quality.manage');
        $academyId = $this->currentAcademyId();
        $this->findTeacher($teacherId);
        $data = $this->validateNote($request);
        $settings = TeacherPerformance::settings($academyId);

        $session = $this->lessonOf($teacherId, $data['session_id'] ?? null);
        if ($session !== null && DB::table('teacher_conduct_notes')->where('session_id', $session->id)->whereNull('deleted_at')->exists()) {
            throw ValidationException::withMessages(['session_id' => 'This lesson already has a note.']);
        }

        $id = (string) Str::uuid();
        $row = [
            'id' => $id,
            'academy_id' => $academyId,
            'teacher_id' => $teacherId,
            'kind' => $data['kind'],
            'occurred_on' => $this->dayOf($session, $data['occurred_on'] ?? null, $academyId, 'occurred_on'),
            'session_id' => $session?->id,
            'rule' => $data['kind'] === 'VIOLATION' ? trim((string) $data['rule']) : null,
            'note' => $this->text($data['note'] ?? null),
            // The price of the day it was written: later changes to the points never restate it.
            'points' => $settings['points'][$data['kind']],
            'author_user_id' => $this->ctx()->userId,
            'author_name' => $this->authorName(),
        ];
        DB::table('teacher_conduct_notes')->insert($row);

        Audit::log('teacher_conduct.create', 'teacher_conduct_note', $id, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'teacher_id' => $teacherId, 'kind' => $row['kind'], 'occurred_on' => $row['occurred_on'],
            'session_id' => $row['session_id'], 'rule' => $row['rule'], 'points' => $row['points'],
        ]);

        return response()->json(['note' => $this->note($this->findNote($id))], 201);
    }

    /** PATCH /api/teacher-performance/notes/{id} */
    public function updateNote(Request $request, string $id): JsonResponse
    {
        Gate::authorize('teacher_quality.manage');
        $academyId = $this->currentAcademyId();
        $note = $this->findNote($id);
        $data = $this->validateNote($request);
        $settings = TeacherPerformance::settings($academyId);

        $session = $note->session_id !== null ? DB::table('sessions')->where('id', $note->session_id)->first() : null;
        $changes = [
            'kind' => $data['kind'],
            // A note about a lesson stays on that lesson's day.
            'occurred_on' => $this->dayOf($session, $data['occurred_on'] ?? (string) $note->occurred_on, $academyId, 'occurred_on'),
            'rule' => $data['kind'] === 'VIOLATION' ? trim((string) $data['rule']) : null,
            'note' => $this->text($data['note'] ?? null),
        ];
        // Re-priced only when it becomes a different kind of note.
        if ($data['kind'] !== $note->kind) {
            $changes['points'] = $settings['points'][$data['kind']];
        }
        DB::table('teacher_conduct_notes')->where('id', $id)->update($changes);

        Audit::log('teacher_conduct.update', 'teacher_conduct_note', $id, $academyId, $this->ctx()->userId, $this->ctx()->role, after: $changes, before: [
            'kind' => $note->kind, 'occurred_on' => (string) $note->occurred_on, 'rule' => $note->rule, 'note' => $note->note, 'points' => (int) $note->points,
        ]);

        return response()->json(['note' => $this->note($this->findNote($id))]);
    }

    /** DELETE /api/teacher-performance/notes/{id} */
    public function destroyNote(string $id): JsonResponse
    {
        Gate::authorize('teacher_quality.manage');
        $academyId = $this->currentAcademyId();
        $note = $this->findNote($id);

        DB::table('teacher_conduct_notes')->where('id', $id)->update(['deleted_at' => DB::raw('now()')]);
        Audit::log('teacher_conduct.delete', 'teacher_conduct_note', $id, $academyId, $this->ctx()->userId, $this->ctx()->role, before: [
            'teacher_id' => (string) $note->teacher_id, 'kind' => $note->kind, 'occurred_on' => (string) $note->occurred_on,
            'rule' => $note->rule, 'note' => $note->note, 'points' => (int) $note->points,
        ]);

        return response()->json(['deleted' => true]);
    }

    // ── Lesson visits: the supervisor sat in and rated the lesson ───────────────

    /** POST /api/teacher-performance/teachers/{id}/visits */
    public function storeVisit(Request $request, string $teacherId): JsonResponse
    {
        Gate::authorize('teacher_quality.manage');
        $academyId = $this->currentAcademyId();
        $this->findTeacher($teacherId);
        $data = $this->validateVisit($request);
        [$items, $score] = $this->rate($data['ratings'], TeacherPerformance::settings($academyId));
        $session = $this->lessonOf($teacherId, $data['session_id'] ?? null);

        $id = (string) Str::uuid();
        $row = [
            'id' => $id,
            'academy_id' => $academyId,
            'teacher_id' => $teacherId,
            'visited_on' => $this->dayOf($session, $data['visited_on'] ?? null, $academyId, 'visited_on'),
            'session_id' => $session?->id,
            'score' => $score,
            'items' => json_encode($items, JSON_UNESCAPED_UNICODE),
            'strengths' => $this->text($data['strengths'] ?? null),
            'improvements' => $this->text($data['improvements'] ?? null),
            'author_user_id' => $this->ctx()->userId,
            'author_name' => $this->authorName(),
        ];
        DB::table('teacher_lesson_visits')->insert($row);

        Audit::log('teacher_visit.create', 'teacher_lesson_visit', $id, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'teacher_id' => $teacherId, 'visited_on' => $row['visited_on'], 'session_id' => $row['session_id'], 'score' => $score,
        ]);

        return response()->json(['visit' => $this->visit($this->findVisit($id))], 201);
    }

    /** PATCH /api/teacher-performance/visits/{id} */
    public function updateVisit(Request $request, string $id): JsonResponse
    {
        Gate::authorize('teacher_quality.manage');
        $academyId = $this->currentAcademyId();
        $visit = $this->findVisit($id);
        $data = $this->validateVisit($request);
        [$items, $score] = $this->rate($data['ratings'], TeacherPerformance::settings($academyId), (array) json_decode((string) $visit->items, true));
        $session = $visit->session_id !== null ? DB::table('sessions')->where('id', $visit->session_id)->first() : null;

        $changes = [
            'visited_on' => $this->dayOf($session, $data['visited_on'] ?? (string) $visit->visited_on, $academyId, 'visited_on'),
            'score' => $score,
            'items' => json_encode($items, JSON_UNESCAPED_UNICODE),
            'strengths' => $this->text($data['strengths'] ?? null),
            'improvements' => $this->text($data['improvements'] ?? null),
        ];
        DB::table('teacher_lesson_visits')->where('id', $id)->update($changes);

        Audit::log('teacher_visit.update', 'teacher_lesson_visit', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['visited_on' => $changes['visited_on'], 'score' => $score],
            before: ['visited_on' => (string) $visit->visited_on, 'score' => (int) $visit->score],
        );

        return response()->json(['visit' => $this->visit($this->findVisit($id))]);
    }

    /** DELETE /api/teacher-performance/visits/{id} */
    public function destroyVisit(string $id): JsonResponse
    {
        Gate::authorize('teacher_quality.manage');
        $academyId = $this->currentAcademyId();
        $visit = $this->findVisit($id);

        DB::table('teacher_lesson_visits')->where('id', $id)->update(['deleted_at' => DB::raw('now()')]);
        Audit::log('teacher_visit.delete', 'teacher_lesson_visit', $id, $academyId, $this->ctx()->userId, $this->ctx()->role, before: [
            'teacher_id' => (string) $visit->teacher_id, 'visited_on' => (string) $visit->visited_on, 'score' => (int) $visit->score,
        ]);

        return response()->json(['deleted' => true]);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────

    private function authorizeRead(): void
    {
        if (! Gate::any(['teacher_quality.insights', 'teacher_quality.read'])) {
            abort(403);
        }
    }

    /** @return array{manage: bool, settings: bool} */
    private function abilities(): array
    {
        return [
            'manage' => Gate::allows('teacher_quality.manage'),
            'settings' => Gate::allows('settings.manage'),
        ];
    }

    /** The asked-for month, or the academy's current one. */
    private function month(Request $request, string $academyId): string
    {
        $data = $request->validate(['month' => ['sometimes', 'regex:/^\d{4}-(0[1-9]|1[0-2])$/']]);

        return $data['month'] ?? CarbonImmutable::now($this->academyTimezone($academyId))->format('Y-m');
    }

    private function findTeacher(string $id): object
    {
        $teacher = ! Str::isUuid($id) ? null : DB::table('teachers')->where('id', $id)
            ->first(['id', 'full_name', 'is_active', 'deleted_at', 'meeting_url']);
        if ($teacher === null) {
            abort(404, 'Teacher not found.');
        }

        return $teacher;
    }

    private function findNote(string $id): object
    {
        $note = ! Str::isUuid($id) ? null : DB::table('teacher_conduct_notes as n')
            ->leftJoin('sessions as se', 'se.id', '=', 'n.session_id')
            ->leftJoin('students as st', 'st.id', '=', 'se.student_id')
            ->where('n.id', $id)->whereNull('n.deleted_at')
            ->first(['n.*', 'se.scheduled_at_utc as lesson_at', 'st.full_name as lesson_student']);
        if ($note === null) {
            abort(404, 'Note not found.');
        }

        return $note;
    }

    private function findVisit(string $id): object
    {
        $visit = ! Str::isUuid($id) ? null : DB::table('teacher_lesson_visits as v')
            ->leftJoin('sessions as se', 'se.id', '=', 'v.session_id')
            ->leftJoin('students as st', 'st.id', '=', 'se.student_id')
            ->where('v.id', $id)->whereNull('v.deleted_at')
            ->first(['v.*', 'se.scheduled_at_utc as lesson_at', 'st.full_name as lesson_student']);
        if ($visit === null) {
            abort(404, 'Visit not found.');
        }

        return $visit;
    }

    /** @return array<string, mixed> */
    private function validateNote(Request $request): array
    {
        return $request->validate([
            'kind' => ['required', Rule::in(TeacherPerformance::KINDS)],
            'occurred_on' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'session_id' => ['sometimes', 'nullable', 'uuid'],
            // A rule not kept has to say which rule.
            'rule' => ['required_if:kind,VIOLATION', 'nullable', 'string', 'max:200'],
            'note' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);
    }

    /** @return array<string, mixed> */
    private function validateVisit(Request $request): array
    {
        return $request->validate([
            'visited_on' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'session_id' => ['sometimes', 'nullable', 'uuid'],
            'ratings' => ['required', 'array', 'min:1', 'max:12'],
            'ratings.*.criterion_id' => ['required', 'string', 'max:64'],
            'ratings.*.rating' => ['required', 'integer', 'min:1', 'max:5'],
            'strengths' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'improvements' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);
    }

    /**
     * The answer sheet and its score. Names are copied in from the academy's list, so renaming a
     * criterion later never rewrites a visit; an edit may keep rating a criterion the academy has
     * since removed, under the name the visit already holds.
     *
     * @param  list<array{criterion_id: string, rating: int}>  $ratings
     * @param  array<string, mixed>  $settings
     * @param  list<array<string, mixed>>  $previous
     * @return array{0: list<array{criterion_id: string, name: string, rating: int}>, 1: int}
     */
    private function rate(array $ratings, array $settings, array $previous = []): array
    {
        $names = array_column($previous, 'name', 'criterion_id');
        foreach ($settings['criteria'] as $c) {
            $names[$c['id']] = $c['name'];
        }

        $items = [];
        foreach ($ratings as $r) {
            $id = (string) $r['criterion_id'];
            if (! isset($names[$id]) || isset($items[$id])) {
                throw ValidationException::withMessages(['ratings' => 'Rate each item of the list once.']);
            }
            $items[$id] = ['criterion_id' => $id, 'name' => (string) $names[$id], 'rating' => (int) $r['rating']];
        }
        $items = array_values($items);
        // Five out of five is 100; a lesson rated 4 on everything is 80.
        $score = (int) round(array_sum(array_column($items, 'rating')) / (count($items) * 5) * 100);

        return [$items, $score];
    }

    /** The teacher's own lesson a note or visit is about, or null when none was named. */
    private function lessonOf(string $teacherId, ?string $sessionId): ?object
    {
        if ($sessionId === null || $sessionId === '') {
            return null;
        }
        $session = DB::table('sessions')->where('id', $sessionId)->where('teacher_id', $teacherId)->whereNull('hidden_at')->first();
        if ($session === null) {
            throw ValidationException::withMessages(['session_id' => 'This lesson is not one of the teacher\'s.']);
        }

        return $session;
    }

    /** The academy day a record falls on: the lesson's own day, else the day given, never the future. */
    private function dayOf(?object $session, ?string $given, string $academyId, string $field): string
    {
        $tz = $this->academyTimezone($academyId);
        if ($session !== null) {
            return CarbonImmutable::parse($session->scheduled_at_utc)->setTimezone($tz)->toDateString();
        }
        $today = CarbonImmutable::now($tz)->toDateString();
        $day = $given !== null && $given !== '' ? $given : $today;
        if ($day > $today) {
            throw ValidationException::withMessages([$field => 'The date cannot be in the future.']);
        }

        return $day;
    }

    private function authorName(): ?string
    {
        $name = DB::table('users')->where('id', $this->ctx()->userId)->value('full_name');

        return $name !== null ? (string) $name : null;
    }

    private function text(?string $value): ?string
    {
        $value = $value !== null ? trim($value) : '';

        return $value === '' ? null : $value;
    }

    private function iso(mixed $value): ?string
    {
        return $value !== null ? CarbonImmutable::parse($value)->utc()->toIso8601String() : null;
    }

    /** @return array<string, mixed> */
    private function teacher(object $te): array
    {
        return [
            'id' => (string) $te->id,
            'name' => $te->full_name,
            'is_active' => (bool) $te->is_active && $te->deleted_at === null,
            'has_meeting_url' => $te->meeting_url !== null && $te->meeting_url !== '',
        ];
    }

    /** @return array<string, mixed> */
    private function note(object $n): array
    {
        return [
            'id' => (string) $n->id,
            'teacher_id' => (string) $n->teacher_id,
            'kind' => (string) $n->kind,
            'occurred_on' => (string) $n->occurred_on,
            'session_id' => $n->session_id !== null ? (string) $n->session_id : null,
            'lesson_at' => $this->iso($n->lesson_at ?? null),
            'lesson_student' => $n->lesson_student ?? null,
            'rule' => $n->rule,
            'note' => $n->note,
            'points' => (int) $n->points,
            'author_name' => $n->author_name,
            'created_at' => $this->iso($n->created_at),
        ];
    }

    /** @return array<string, mixed> */
    private function visit(object $v): array
    {
        return [
            'id' => (string) $v->id,
            'teacher_id' => (string) $v->teacher_id,
            'visited_on' => (string) $v->visited_on,
            'session_id' => $v->session_id !== null ? (string) $v->session_id : null,
            'lesson_at' => $this->iso($v->lesson_at ?? null),
            'lesson_student' => $v->lesson_student ?? null,
            'score' => (int) $v->score,
            'items' => array_values((array) json_decode((string) $v->items, true)),
            'strengths' => $v->strengths,
            'improvements' => $v->improvements,
            'author_name' => $v->author_name,
            'created_at' => $this->iso($v->created_at),
        ];
    }
}
