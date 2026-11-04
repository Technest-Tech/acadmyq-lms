<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Audit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Exams and grades for a group, and the term report they feed (docs/centre-profile, Phase 2 §5).
 *
 * The grade sheet is members × assessments. An assessment is one column (a quiz, the mid-term, the
 * final…) with the mark it is out of and a weight; a score is one cell, or "absent from it". The
 * term report for a student in a group is COMPOSED every time it is read — attendance from the
 * sheets over the dates they were a member, grades from the scores, the weighted total from both —
 * and the only thing stored about it is what the system cannot know: the teacher's comment, the
 * overall grade, and whether it has been published to the parent.
 *
 * Numbers, as the sheet shows them:
 *   - a score's percent is score / max_score; an absence counts as 0 in the total and is flagged;
 *     an empty cell is not graded and does not count at all;
 *   - the weighted total is Σ(weight × percent) / Σ(weight) over the graded cells — null until one
 *     is graded (or when every graded weight is 0);
 *   - attendance counts marks on HELD lessons dated inside the membership window; a held lesson the
 *     sheet skipped the student on is not a mark. The rate counts late as present, like the portal.
 *
 * Who is on the sheet: the active members, plus anyone who left after the group started (flagged
 * `left`) — they sat the quizzes and their report still means something. A student removed from the
 * academy drops off.
 *
 * A Quran academy has no rows here and none of this runs: every route is behind `entitled:centre`.
 */
final class GroupAssessments
{
    public const KINDS = ['QUIZ', 'HOMEWORK', 'MIDTERM', 'FINAL', 'ORAL', 'PROJECT', 'OTHER'];

    // ── Assessments (the columns) ─────────────────────────────────────────────

    /** @return list<array<string, mixed>> */
    public function assessments(string $groupId): array
    {
        return $this->assessmentQuery($groupId)->get()->map(fn (object $a) => $this->presentAssessment($a))->values()->all();
    }

    public function findAssessment(string $groupId, string $assessmentId): object
    {
        $row = $this->assessmentQuery($groupId)->where('a.id', $assessmentId)->first();
        if ($row === null) {
            abort(404, 'Assessment not found.');
        }

        return $row;
    }

    /** @param  array<string, mixed>  $data */
    public function create(object $group, array $data, string $actorUserId, string $actorRole): array
    {
        $id = (string) Str::uuid();
        $next = (int) DB::table('group_assessments')->where('group_id', $group->id)->max('sort_order') + 1;
        DB::table('group_assessments')->insert([
            'id' => $id,
            'academy_id' => (string) $group->academy_id,
            'group_id' => (string) $group->id,
            'title' => trim((string) $data['title']),
            'kind' => $data['kind'] ?? 'QUIZ',
            'held_on' => $data['held_on'] ?? null,
            'max_score' => $data['max_score'],
            'weight' => $data['weight'] ?? 1,
            'sort_order' => $data['sort_order'] ?? $next,
            'created_by' => $actorUserId,
        ]);

        Audit::log('group_assessment.created', 'group_assessment', $id, (string) $group->academy_id, $actorUserId, $actorRole,
            after: ['group_id' => (string) $group->id, 'title' => trim((string) $data['title']), 'kind' => $data['kind'] ?? 'QUIZ', 'max_score' => $data['max_score']]);

        return $this->presentAssessment($this->findAssessment((string) $group->id, $id));
    }

    /** @param  array<string, mixed>  $data */
    public function update(object $group, object $assessment, array $data, string $actorUserId, string $actorRole): array
    {
        $patch = array_intersect_key($data, array_flip(['title', 'kind', 'held_on', 'max_score', 'weight', 'sort_order']));
        if (isset($patch['title'])) {
            $patch['title'] = trim((string) $patch['title']);
        }

        // Lowering the ceiling below a score already on the sheet would leave a cell over 100 %.
        if (isset($patch['max_score'])) {
            $top = DB::table('group_assessment_scores')->where('assessment_id', $assessment->id)->max('score');
            if ($top !== null && (float) $top > (float) $patch['max_score']) {
                throw ValidationException::withMessages([
                    'max_score' => ['A score on the sheet is higher than this. / توجد درجة مسجّلة أعلى من هذه القيمة.'],
                ]);
            }
        }

        if ($patch !== []) {
            DB::table('group_assessments')->where('id', $assessment->id)->update($patch + ['updated_at' => now()]);
            Audit::log('group_assessment.updated', 'group_assessment', (string) $assessment->id, (string) $group->academy_id, $actorUserId, $actorRole,
                after: $patch, before: array_intersect_key((array) $assessment, $patch));
        }

        return $this->presentAssessment($this->findAssessment((string) $group->id, (string) $assessment->id));
    }

    /**
     * Delete a column. With scores on it the delete is refused unless forced — a forced delete takes
     * the scores with it (cascade), and the audit line says how many went.
     */
    public function delete(object $group, object $assessment, bool $force, string $actorUserId, string $actorRole): void
    {
        $scores = DB::table('group_assessment_scores')->where('assessment_id', $assessment->id)->count();
        if ($scores > 0 && ! $force) {
            throw ValidationException::withMessages([
                'assessment' => ["This assessment has {$scores} score(s). Delete them with it? / هذا الاختبار عليه {$scores} درجة مسجّلة. احذفها معه؟"],
            ]);
        }

        DB::table('group_assessments')->where('id', $assessment->id)->delete();
        Audit::log('group_assessment.deleted', 'group_assessment', (string) $assessment->id, (string) $group->academy_id, $actorUserId, $actorRole,
            before: ['title' => (string) $assessment->title, 'kind' => (string) $assessment->kind, 'scores' => $scores]);
    }

    // ── Scores (the cells) ────────────────────────────────────────────────────

    /**
     * The whole sheet: who is on it, the columns, and every cell with its percent and each
     * student's weighted total.
     *
     * @return array{members: list<array>, assessments: list<array>, scores: array<string, array<string, array>>, totals: array<string, ?float>}
     */
    public function sheet(object $group): array
    {
        $members = $this->members($group);
        $assessments = $this->assessmentQuery((string) $group->id)->get();
        $byAssessment = $assessments->keyBy(fn (object $a) => (string) $a->id);

        $scores = [];
        $totals = [];
        $cells = DB::table('group_assessment_scores')
            ->whereIn('assessment_id', $byAssessment->keys()->all())
            ->get()
            ->groupBy(fn (object $s) => (string) $s->student_id);

        foreach ($members as $m) {
            $sid = $m['student_id'];
            $own = $cells->get($sid, collect())->keyBy(fn (object $s) => (string) $s->assessment_id);
            $row = [];
            foreach ($assessments as $a) {
                $cell = $own->get((string) $a->id);
                $row[(string) $a->id] = $this->presentScore($cell, $a);
            }
            $scores[$sid] = $row;
            $totals[$sid] = $this->weightedTotal($row, $byAssessment);
        }

        return [
            'members' => $members,
            'assessments' => $assessments->map(fn (object $a) => $this->presentAssessment($a))->values()->all(),
            'scores' => $scores,
            'totals' => $totals,
        ];
    }

    /**
     * Upsert one column's cells in one transaction. A cell with no score, not absent and no note is
     * cleared (the row goes); anything else is written. Refused as a whole when a score is over the
     * ceiling or a student is not on the sheet — the request transaction would otherwise commit the
     * rows before the 422.
     *
     * @param  list<array{student_id: string, score?: ?float, absent?: bool, note?: ?string}>  $entries
     */
    public function saveScores(object $group, object $assessment, array $entries, string $actorUserId, string $actorRole): void
    {
        $onSheet = array_flip(array_column($this->members($group), 'student_id'));
        $max = (float) $assessment->max_score;

        DB::transaction(function () use ($group, $assessment, $entries, $onSheet, $max, $actorUserId, $actorRole): void {
            $written = 0;
            $cleared = 0;
            foreach ($entries as $i => $e) {
                $sid = (string) $e['student_id'];
                if (! isset($onSheet[$sid])) {
                    throw ValidationException::withMessages(["scores.{$i}.student_id" => ['Not a member of this group. / هذا الطالب ليس في المجموعة.']]);
                }
                $absent = (bool) ($e['absent'] ?? false);
                $score = $absent ? null : ($e['score'] ?? null);
                $note = isset($e['note']) && trim((string) $e['note']) !== '' ? trim((string) $e['note']) : null;
                if ($score !== null && (float) $score > $max) {
                    throw ValidationException::withMessages(["scores.{$i}.score" => ["Over the maximum of {$assessment->max_score}. / الدرجة أعلى من الحد الأقصى {$assessment->max_score}."]]);
                }

                if ($score === null && ! $absent && $note === null) {
                    $cleared += DB::table('group_assessment_scores')->where('assessment_id', $assessment->id)->where('student_id', $sid)->delete();

                    continue;
                }

                DB::table('group_assessment_scores')->upsert([[
                    'id' => (string) Str::uuid(),
                    'academy_id' => (string) $group->academy_id,
                    'assessment_id' => (string) $assessment->id,
                    'student_id' => $sid,
                    'score' => $score,
                    'absent' => $absent,
                    'note' => $note,
                    'graded_by' => $actorUserId,
                    'graded_at' => now()->utc()->format('Y-m-d H:i:sP'),
                    'updated_at' => now()->utc()->format('Y-m-d H:i:sP'),
                ]], ['assessment_id', 'student_id'], ['score', 'absent', 'note', 'graded_by', 'graded_at', 'updated_at']);
                $written++;
            }

            Audit::log('group_assessment.scored', 'group_assessment', (string) $assessment->id, (string) $group->academy_id, $actorUserId, $actorRole,
                after: ['group_id' => (string) $group->id, 'written' => $written, 'cleared' => $cleared]);
        });
    }

    // ── The term report ───────────────────────────────────────────────────────

    /**
     * One student's report in one group, composed now. Null when the student was never a member.
     *
     * @return ?array<string, mixed>
     */
    public function report(object $group, string $studentId): ?array
    {
        $member = collect($this->members($group, includeRemoved: true))->firstWhere('student_id', $studentId);
        if ($member === null) {
            return null;
        }

        $assessments = $this->assessmentQuery((string) $group->id)->get();
        $byAssessment = $assessments->keyBy(fn (object $a) => (string) $a->id);
        $cells = DB::table('group_assessment_scores')
            ->whereIn('assessment_id', $byAssessment->keys()->all())
            ->where('student_id', $studentId)
            ->get()
            ->keyBy(fn (object $s) => (string) $s->assessment_id);

        $grades = [];
        foreach ($assessments as $a) {
            $grades[(string) $a->id] = $this->presentScore($cells->get((string) $a->id), $a);
        }

        $stored = DB::table('group_term_reports as r')
            ->leftJoin('users as u', 'u.id', '=', 'r.published_by')
            ->where('r.group_id', $group->id)->where('r.student_id', $studentId)
            ->first(['r.*', 'u.full_name as published_by_name']);

        $teacher = DB::table('teachers')->where('id', $group->teacher_id)->value('full_name');
        $today = ClassGroups::localToday((string) $group->timezone);

        return [
            'student' => [
                'id' => $studentId,
                'full_name' => $member['full_name'],
                'level' => $member['level'],
            ],
            'group' => [
                'id' => (string) $group->id,
                'name' => (string) $group->name,
                'level' => $group->level !== null && trim((string) $group->level) !== '' ? (string) $group->level : null,
                'teacher_name' => $teacher !== null ? (string) $teacher : null,
            ],
            'period' => [
                'from' => $member['joined_on'],
                'to' => $member['left_on'] ?? $today,
                'left' => $member['left'],
            ],
            'attendance' => $this->attendance($group, $studentId, $today),
            'grades' => array_values($grades),
            'total' => ['weighted_percent' => $this->weightedTotal($grades, $byAssessment)],
            'comment' => $stored?->comment,
            'overall_grade' => $stored?->overall_grade,
            'published_at' => $stored?->published_at !== null ? Carbon::parse($stored->published_at)->utc()->toIso8601String() : null,
            'published_by_name' => $stored?->published_by_name,
            'updated_at' => $stored?->updated_at !== null ? Carbon::parse($stored->updated_at)->utc()->toIso8601String() : null,
        ];
    }

    /**
     * One row per student on the sheet: the attendance rate, the weighted total and whether the
     * report is out — the list, and what bulk publish works from.
     *
     * @return list<array<string, mixed>>
     */
    public function reportRows(object $group): array
    {
        $sheet = $this->sheet($group);
        $today = ClassGroups::localToday((string) $group->timezone);
        $stored = DB::table('group_term_reports')->where('group_id', $group->id)->get()->keyBy(fn (object $r) => (string) $r->student_id);

        $rows = [];
        foreach ($sheet['members'] as $m) {
            $sid = $m['student_id'];
            $r = $stored->get($sid);
            $rows[] = [
                'student_id' => $sid,
                'full_name' => $m['full_name'],
                'left' => $m['left'],
                'attendance' => $this->attendance($group, $sid, $today),
                'total' => ['weighted_percent' => $sheet['totals'][$sid]],
                'graded_count' => count(array_filter($sheet['scores'][$sid], fn (array $c) => $c['score'] !== null || $c['absent'])),
                'has_comment' => $r !== null && trim((string) ($r->comment ?? '')) !== '',
                'overall_grade' => $r?->overall_grade,
                'published_at' => $r?->published_at !== null ? Carbon::parse($r->published_at)->utc()->toIso8601String() : null,
            ];
        }

        return $rows;
    }

    /** Write the comment and the overall grade; the row is created on first write. */
    public function saveReport(object $group, string $studentId, ?string $comment, ?string $overallGrade, string $actorUserId, string $actorRole): void
    {
        $this->assertOnSheet($group, $studentId);
        $comment = $comment !== null && trim($comment) !== '' ? trim($comment) : null;
        $overallGrade = $overallGrade !== null && trim($overallGrade) !== '' ? trim($overallGrade) : null;

        $now = now()->utc()->format('Y-m-d H:i:sP');
        DB::table('group_term_reports')->upsert([[
            'id' => (string) Str::uuid(),
            'academy_id' => (string) $group->academy_id,
            'group_id' => (string) $group->id,
            'student_id' => $studentId,
            'comment' => $comment,
            'overall_grade' => $overallGrade,
            'created_by' => $actorUserId,
            'created_at' => $now,
            'updated_at' => $now,
        ]], ['group_id', 'student_id'], ['comment', 'overall_grade', 'updated_at']);

        Audit::log('group_term_report.saved', 'group_term_report', $this->reportId($group, $studentId), (string) $group->academy_id, $actorUserId, $actorRole,
            after: ['student_id' => $studentId, 'overall_grade' => $overallGrade, 'has_comment' => $comment !== null]);
    }

    /** Publish (or take back) one student's report. Publishing with nothing written yet creates the row. */
    public function setPublished(object $group, string $studentId, bool $published, string $actorUserId, string $actorRole): void
    {
        $this->assertOnSheet($group, $studentId);
        $now = now()->utc()->format('Y-m-d H:i:sP');

        DB::table('group_term_reports')->upsert([[
            'id' => (string) Str::uuid(),
            'academy_id' => (string) $group->academy_id,
            'group_id' => (string) $group->id,
            'student_id' => $studentId,
            'published_at' => $published ? $now : null,
            'published_by' => $published ? $actorUserId : null,
            'created_by' => $actorUserId,
            'created_at' => $now,
            'updated_at' => $now,
        ]], ['group_id', 'student_id'], ['published_at', 'published_by', 'updated_at']);

        Audit::log($published ? 'group_term_report.published' : 'group_term_report.unpublished', 'group_term_report',
            $this->reportId($group, $studentId), (string) $group->academy_id, $actorUserId, $actorRole, after: ['student_id' => $studentId]);
    }

    /** Publish every unpublished report on the sheet; returns how many went out. */
    public function publishAll(object $group, string $actorUserId, string $actorRole): int
    {
        $published = DB::table('group_term_reports')->where('group_id', $group->id)->whereNotNull('published_at')
            ->pluck('student_id')->map(fn ($id) => (string) $id)->flip()->all();

        $count = 0;
        DB::transaction(function () use ($group, $published, $actorUserId, $actorRole, &$count): void {
            foreach ($this->members($group) as $m) {
                if (isset($published[$m['student_id']])) {
                    continue;
                }
                $this->setPublished($group, $m['student_id'], true, $actorUserId, $actorRole);
                $count++;
            }
        });

        return $count;
    }

    /**
     * The published reports of these children, for the parent's page — keyed by student id, the
     * parent's allow-list only (no staff names, no score notes). A child with none is absent from
     * the result, so the page's payload is unchanged for them.
     *
     * @param  list<string>  $childIds
     * @return array<string, list<array<string, mixed>>>
     */
    public function publishedFor(array $childIds): array
    {
        if ($childIds === []) {
            return [];
        }

        $rows = DB::table('group_term_reports as r')
            ->join('class_groups as g', 'g.id', '=', 'r.group_id')
            ->whereIn('r.student_id', $childIds)
            ->whereNotNull('r.published_at')
            ->orderByDesc('r.published_at')
            ->get(['r.student_id', 'r.group_id']);

        $out = [];
        foreach ($rows as $row) {
            $group = DB::table('class_groups')->where('id', $row->group_id)->first();
            $report = $group !== null ? $this->report($group, (string) $row->student_id) : null;
            if ($report === null) {
                continue;
            }
            $out[(string) $row->student_id][] = [
                'group_id' => $report['group']['id'],
                'group_name' => $report['group']['name'],
                'level' => $report['group']['level'],
                'teacher_name' => $report['group']['teacher_name'],
                'period' => $report['period'],
                'attendance' => $report['attendance'],
                'grades' => array_map(fn (array $g) => array_intersect_key($g, array_flip(['title', 'kind', 'held_on', 'max_score', 'weight', 'score', 'absent', 'percent'])), $report['grades']),
                'total' => $report['total'],
                'comment' => $report['comment'],
                'overall_grade' => $report['overall_grade'],
                'published_at' => $report['published_at'],
            ];
        }

        return $out;
    }

    // ── internals ────────────────────────────────────────────────────────────

    private function assessmentQuery(string $groupId)
    {
        return DB::table('group_assessments as a')
            ->where('a.group_id', $groupId)
            ->select('a.*')
            ->selectRaw('(select count(*) from group_assessment_scores s where s.assessment_id = a.id) as graded_count')
            ->orderBy('a.sort_order')
            ->orderBy('a.held_on')
            ->orderBy('a.created_at');
    }

    /** @return array<string, mixed> */
    private function presentAssessment(object $a): array
    {
        return [
            'id' => (string) $a->id,
            'group_id' => (string) $a->group_id,
            'title' => (string) $a->title,
            'kind' => (string) $a->kind,
            'held_on' => $a->held_on !== null ? Carbon::parse($a->held_on)->format('Y-m-d') : null,
            'max_score' => (float) $a->max_score,
            'weight' => (float) $a->weight,
            'sort_order' => (int) $a->sort_order,
            'graded_count' => (int) ($a->graded_count ?? 0),
        ];
    }

    /** A cell as the sheet and the report show it; an empty cell still names its column. */
    private function presentScore(?object $cell, object $a): array
    {
        $score = $cell?->score !== null ? (float) $cell->score : null;
        $absent = (bool) ($cell?->absent ?? false);
        $max = (float) $a->max_score;

        return [
            'assessment_id' => (string) $a->id,
            'title' => (string) $a->title,
            'kind' => (string) $a->kind,
            'held_on' => $a->held_on !== null ? Carbon::parse($a->held_on)->format('Y-m-d') : null,
            'max_score' => $max,
            'weight' => (float) $a->weight,
            'score' => $score,
            'absent' => $absent,
            'note' => $cell?->note,
            'percent' => $absent ? 0.0 : ($score !== null && $max > 0 ? round($score * 100 / $max, 1) : null),
        ];
    }

    /**
     * @param  array<string, array>  $cells  assessment id → presented cell
     * @param  Collection<string, object>  $byAssessment
     */
    private function weightedTotal(array $cells, Collection $byAssessment): ?float
    {
        $sum = 0.0;
        $weights = 0.0;
        foreach ($cells as $aid => $c) {
            if ($c['percent'] === null) {
                continue;
            }
            $w = (float) ($byAssessment->get($aid)?->weight ?? 0);
            $sum += $w * (float) $c['percent'];
            $weights += $w;
        }

        return $weights > 0 ? round($sum / $weights, 1) : null;
    }

    /**
     * Who is on the sheet: one row per student, memberships collapsed (a student who left and came
     * back is one person). `left` is true when no membership is open.
     *
     * @return list<array{student_id: string, full_name: string, level: ?string, joined_on: string, left_on: ?string, left: bool}>
     */
    private function members(object $group, bool $includeRemoved = false): array
    {
        $rows = DB::table('class_group_members as m')
            ->join('students as st', 'st.id', '=', 'm.student_id')
            ->leftJoin('academy_levels as lv', 'lv.id', '=', 'st.level_id')
            ->where('m.group_id', $group->id)
            ->when(! $includeRemoved, fn ($q) => $q->whereNull('st.deleted_at'))
            // Someone who left before the first lesson never sat anything.
            ->where(function ($q) use ($group): void {
                $q->where('m.status', 'ACTIVE')->orWhere('m.left_on', '>=', $group->start_date);
            })
            ->groupBy('m.student_id', 'st.full_name', 'lv.name')
            ->selectRaw("m.student_id, st.full_name, lv.name as level,
                min(m.joined_on) as joined_on,
                max(m.left_on) as left_on,
                bool_or(m.status = 'ACTIVE') as active")
            ->orderBy('st.full_name')
            ->get();

        return $rows->map(fn (object $r): array => [
            'student_id' => (string) $r->student_id,
            'full_name' => (string) $r->full_name,
            'level' => $r->level !== null ? (string) $r->level : null,
            'joined_on' => Carbon::parse($r->joined_on)->format('Y-m-d'),
            'left_on' => $r->active || $r->left_on === null ? null : Carbon::parse($r->left_on)->format('Y-m-d'),
            'left' => ! $r->active,
        ])->values()->all();
    }

    private function assertOnSheet(object $group, string $studentId): void
    {
        if (collect($this->members($group))->firstWhere('student_id', $studentId) === null) {
            throw ValidationException::withMessages(['student_id' => ['Not a member of this group. / هذا الطالب ليس في المجموعة.']]);
        }
    }

    private function reportId(object $group, string $studentId): ?string
    {
        $id = DB::table('group_term_reports')->where('group_id', $group->id)->where('student_id', $studentId)->value('id');

        return $id !== null ? (string) $id : null;
    }

    /**
     * Marks on the group's HELD lessons dated inside the student's membership window(s), a lesson
     * they were taken off excluded. `lessons_held` is how many such lessons there were; the counts
     * are what the sheets recorded for them, so a skipped sheet is neither present nor absent.
     *
     * @return array{present: int, late: int, absent: int, excused: int, rate: ?int, lessons_held: int}
     */
    private function attendance(object $group, string $studentId, string $today): array
    {
        $lessons = DB::table('class_group_lessons as l')
            ->where('l.group_id', $group->id)
            ->where('l.status', 'HELD')
            ->where('l.occurrence_local_date', '<=', $today)
            ->whereExists(fn ($q) => $q->select(DB::raw(1))
                ->from('class_group_members as m')
                ->whereColumn('m.group_id', 'l.group_id')
                ->where('m.student_id', $studentId)
                ->whereColumn('m.joined_on', '<=', 'l.occurrence_local_date')
                ->where(fn ($w) => $w->whereNull('m.left_on')->orWhereColumn('m.left_on', '>=', 'l.occurrence_local_date')))
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))
                ->from('class_group_lesson_removals as x')
                ->whereColumn('x.lesson_id', 'l.id')
                ->where('x.student_id', $studentId))
            ->leftJoin('class_group_attendance as a', function ($j) use ($studentId): void {
                $j->on('a.lesson_id', '=', 'l.id')->where('a.student_id', '=', $studentId);
            })
            ->selectRaw("count(*) as held,
                count(*) filter (where a.status = 'PRESENT') as present,
                count(*) filter (where a.status = 'LATE') as late,
                count(*) filter (where a.status = 'ABSENT') as absent,
                count(*) filter (where a.status = 'EXCUSED') as excused")
            ->first();

        $present = (int) $lessons->present;
        $late = (int) $lessons->late;
        $marked = $present + $late + (int) $lessons->absent + (int) $lessons->excused;

        return [
            'present' => $present,
            'late' => $late,
            'absent' => (int) $lessons->absent,
            'excused' => (int) $lessons->excused,
            'rate' => $marked > 0 ? (int) round(($present + $late) * 100 / $marked) : null,
            'lessons_held' => (int) $lessons->held,
        ];
    }
}
