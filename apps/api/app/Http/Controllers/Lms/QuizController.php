<?php

declare(strict_types=1);

namespace App\Http\Controllers\Lms;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Lms\Concerns\InteractsWithLms;
use App\Support\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Quiz authoring — the builder side of phase 4 (docs/lms/04 §quizzes, LMS module, entitled:lms).
 * A quiz belongs to a course and is attached to a QUIZ lesson via `lessons.quiz_id`. Questions +
 * options are edited as a whole (replace-all save) — a quiz is small and form-shaped, so this is
 * simpler and race-free vs. per-row CRUD. `course.manage` writes, `course.read` reads; RLS scopes
 * every row to the academy.
 *
 * Correct-answer flags (`quiz_options.is_correct`) ARE returned here (staff builder) but NEVER by the
 * learner endpoints — grading is server-side only.
 */
final class QuizController extends Controller
{
    use InteractsWithLms;

    private const TYPES = ['SINGLE', 'MULTIPLE', 'TRUE_FALSE'];

    /** Most recent attempts returned by results(); the summary counts are always over the full set. */
    private const RESULTS_LIMIT = 200;

    /**
     * GET /api/courses/quizzes — every quiz in the academy, across all courses, with the counts the
     * listing needs (questions, attempts, pass rate). Cross-course by design: a quiz is otherwise
     * only reachable through the lesson it hangs off, which gives staff no overview.
     */
    public function index(): JsonResponse
    {
        Gate::authorize('course.read');
        $this->currentAcademyId();

        // Scalar subqueries rather than joins: `lessons.quiz_id` is not unique, so a join would
        // duplicate a quiz row per attached lesson and inflate every aggregate with it.
        $quizzes = DB::table('quizzes as q')
            ->join('courses as c', 'c.id', '=', 'q.course_id')
            ->orderBy('c.title')
            ->orderBy('q.created_at')
            ->get([
                'q.id', 'q.title', 'q.pass_mark', 'q.max_attempts', 'q.created_at',
                'c.id as course_id', 'c.title as course_title', 'c.status as course_status',
                DB::raw('(select count(*) from quiz_questions qq where qq.quiz_id = q.id) as question_count'),
                DB::raw('(select coalesce(sum(qq.points), 0) from quiz_questions qq where qq.quiz_id = q.id) as total_points'),
                DB::raw('(select l.id from lessons l where l.quiz_id = q.id order by l.created_at limit 1) as lesson_id'),
                DB::raw('(select l.title from lessons l where l.quiz_id = q.id order by l.created_at limit 1) as lesson_title'),
                DB::raw('(select count(*) from quiz_attempts qa where qa.quiz_id = q.id and qa.submitted_at is not null) as attempt_count'),
                DB::raw('(select count(distinct qa.learner_id) from quiz_attempts qa where qa.quiz_id = q.id and qa.submitted_at is not null) as learner_count'),
                DB::raw('(select count(*) from quiz_attempts qa where qa.quiz_id = q.id and qa.passed is true) as passed_count'),
                DB::raw('(select avg(qa.score) from quiz_attempts qa where qa.quiz_id = q.id and qa.submitted_at is not null) as avg_score'),
            ])
            ->map(fn (object $q): array => [
                'id' => (string) $q->id,
                'title' => $q->title,
                'pass_mark' => (int) $q->pass_mark,
                'max_attempts' => $q->max_attempts !== null ? (int) $q->max_attempts : null,
                'created_at' => $this->iso($q->created_at),
                'course_id' => (string) $q->course_id,
                'course_title' => (string) $q->course_title,
                'course_status' => (string) $q->course_status,
                // Null when the quiz is not attached to any lesson — it exists but no learner can reach it.
                'lesson_id' => $q->lesson_id !== null ? (string) $q->lesson_id : null,
                'lesson_title' => $q->lesson_title,
                'question_count' => (int) $q->question_count,
                'total_points' => (int) $q->total_points,
                'attempt_count' => (int) $q->attempt_count,
                'learner_count' => (int) $q->learner_count,
                'passed_count' => (int) $q->passed_count,
                'avg_score' => $q->avg_score !== null ? (int) round((float) $q->avg_score) : null,
            ]);

        return response()->json(['quizzes' => $quizzes]);
    }

    /**
     * GET /api/courses/quizzes/{id}/results — how learners actually did (docs/lms/04 §quizzes).
     * Course-agnostic (the listing is cross-course); RLS scopes the quiz to the academy. Returns the
     * quiz meta, summary stats over ALL submitted attempts, the most recent attempts, and a
     * per-question correct-rate so a consistently-failed question stands out.
     */
    public function results(string $id): JsonResponse
    {
        Gate::authorize('course.read');
        $this->currentAcademyId();

        $quiz = DB::table('quizzes as q')
            ->join('courses as c', 'c.id', '=', 'q.course_id')
            ->where('q.id', $id)
            ->first(['q.id', 'q.title', 'q.pass_mark', 'q.max_attempts', 'q.course_id', 'c.title as course_title']);
        if ($quiz === null) {
            abort(404, 'Quiz not found.');
        }

        // Unsubmitted rows are attempts in progress — they carry no score and would skew every stat.
        $summary = DB::table('quiz_attempts')
            ->where('quiz_id', $id)
            ->whereNotNull('submitted_at')
            ->first([
                DB::raw('count(*) as attempts'),
                DB::raw('count(distinct learner_id) as learners'),
                DB::raw('count(*) filter (where passed is true) as passed'),
                DB::raw('count(distinct learner_id) filter (where passed is true) as passed_learners'),
                DB::raw('avg(score) as avg_score'),
                DB::raw('max(score) as best_score'),
                DB::raw('min(score) as worst_score'),
            ]);

        $attempts = DB::table('quiz_attempts as qa')
            ->join('learners as l', 'l.id', '=', 'qa.learner_id')
            ->where('qa.quiz_id', $id)
            ->whereNotNull('qa.submitted_at')
            ->orderByDesc('qa.submitted_at')
            ->limit(self::RESULTS_LIMIT)
            ->get([
                'qa.id', 'qa.score', 'qa.passed', 'qa.started_at', 'qa.submitted_at',
                'l.id as learner_id', 'l.full_name', 'l.email',
            ])
            ->map(fn (object $a): array => [
                'id' => (string) $a->id,
                'learner_id' => (string) $a->learner_id,
                'learner_name' => (string) $a->full_name,
                'learner_email' => (string) $a->email,
                'score' => $a->score !== null ? (int) $a->score : null,
                'passed' => (bool) $a->passed,
                'started_at' => $this->iso($a->started_at),
                'submitted_at' => $this->iso($a->submitted_at),
            ]);

        $attemptCount = (int) ($summary->attempts ?? 0);

        return response()->json([
            'quiz' => [
                'id' => (string) $quiz->id,
                'title' => $quiz->title,
                'pass_mark' => (int) $quiz->pass_mark,
                'max_attempts' => $quiz->max_attempts !== null ? (int) $quiz->max_attempts : null,
                'course_id' => (string) $quiz->course_id,
                'course_title' => (string) $quiz->course_title,
            ],
            'summary' => [
                'attempts' => $attemptCount,
                'learners' => (int) ($summary->learners ?? 0),
                'passed' => (int) ($summary->passed ?? 0),
                'passed_learners' => (int) ($summary->passed_learners ?? 0),
                'avg_score' => $summary?->avg_score !== null ? (int) round((float) $summary->avg_score) : null,
                'best_score' => $summary?->best_score !== null ? (int) $summary->best_score : null,
                'worst_score' => $summary?->worst_score !== null ? (int) $summary->worst_score : null,
            ],
            'attempts' => $attempts,
            // The listing is capped; say so rather than let staff read a truncated list as the whole set.
            'attempts_truncated' => $attemptCount > self::RESULTS_LIMIT,
            'questions' => $this->questionStats($id),
        ]);
    }

    /** POST /api/courses/{course}/quizzes — create an (empty) quiz for the course. */
    public function store(Request $request, string $courseId): JsonResponse
    {
        Gate::authorize('course.manage');
        $academyId = $this->currentAcademyId();
        $this->findCourse($courseId);

        $data = $request->validate($this->metaRules(creating: true));

        $quizId = (string) Str::uuid();
        DB::table('quizzes')->insert([
            'id' => $quizId,
            'academy_id' => $academyId,
            'course_id' => $courseId,
            'title' => $data['title'] ?? null,
            'pass_mark' => $data['pass_mark'] ?? 60,
            'max_attempts' => $data['max_attempts'] ?? null,
        ]);

        Audit::log('quiz.create', 'quiz', $quizId, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['course_id' => $courseId]);

        return response()->json(['quizId' => $quizId], 201);
    }

    /** GET /api/courses/{course}/quizzes/{id} — the full builder payload (questions + options w/ answers). */
    public function show(string $courseId, string $id): JsonResponse
    {
        Gate::authorize('course.read');
        $this->currentAcademyId();
        $quiz = $this->findQuiz($courseId, $id);

        return response()->json($this->present($quiz, includeAnswers: true));
    }

    /**
     * PUT /api/courses/{course}/quizzes/{id} — save the quiz meta AND replace its questions/options.
     * The whole quiz is sent; questions/options are wiped and reinserted inside one transaction.
     */
    public function update(Request $request, string $courseId, string $id): JsonResponse
    {
        Gate::authorize('course.manage');
        $academyId = $this->currentAcademyId();
        $quiz = $this->findQuiz($courseId, $id);

        $data = $request->validate($this->metaRules(creating: false) + [
            'questions' => ['sometimes', 'array'],
            'questions.*.prompt' => ['required', 'string', 'max:2000'],
            'questions.*.type' => ['required', Rule::in(self::TYPES)],
            'questions.*.points' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'questions.*.options' => ['required', 'array', 'min:2', 'max:10'],
            'questions.*.options.*.text' => ['required', 'string', 'max:1000'],
            'questions.*.options.*.is_correct' => ['sometimes', 'boolean'],
        ]);

        if (array_key_exists('questions', $data)) {
            $this->validateQuestions($data['questions']);
        }

        $meta = [];
        foreach (['title', 'pass_mark', 'max_attempts'] as $field) {
            if (array_key_exists($field, $data)) {
                $meta[$field] = $data[$field];
            }
        }

        DB::transaction(function () use ($academyId, $id, $meta, $data): void {
            if ($meta !== []) {
                DB::table('quizzes')->where('id', $id)->update($meta + ['updated_at' => now()]);
            }

            if (! array_key_exists('questions', $data)) {
                return;
            }

            // Replace-all: cascade delete removes old options with their questions.
            DB::table('quiz_questions')->where('quiz_id', $id)->delete();

            foreach (array_values($data['questions']) as $qPos => $q) {
                $questionId = (string) Str::uuid();
                DB::table('quiz_questions')->insert([
                    'id' => $questionId,
                    'academy_id' => $academyId,
                    'quiz_id' => $id,
                    'prompt' => trim((string) $q['prompt']),
                    'type' => $q['type'],
                    'points' => (int) ($q['points'] ?? 1),
                    'position' => $qPos,
                ]);

                foreach (array_values($q['options']) as $oPos => $opt) {
                    DB::table('quiz_options')->insert([
                        'id' => (string) Str::uuid(),
                        'academy_id' => $academyId,
                        'question_id' => $questionId,
                        'text' => trim((string) $opt['text']),
                        'is_correct' => (bool) ($opt['is_correct'] ?? false),
                        'position' => $oPos,
                    ]);
                }
            }
        });

        Audit::log('quiz.update', 'quiz', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: array_keys($meta) + (array_key_exists('questions', $data) ? ['questions' => count($data['questions'])] : []));

        return response()->json(['ok' => true]);
    }

    /** DELETE /api/courses/{course}/quizzes/{id} — remove the quiz (the QUIZ lesson's FK is set null). */
    public function destroy(string $courseId, string $id): JsonResponse
    {
        Gate::authorize('course.manage');
        $academyId = $this->currentAcademyId();
        $this->findQuiz($courseId, $id);

        DB::table('quizzes')->where('id', $id)->delete();

        Audit::log('quiz.delete', 'quiz', $id, $academyId, $this->ctx()->userId, $this->ctx()->role);

        return response()->json(['ok' => true]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** @return array<string, list<mixed>> */
    private function metaRules(bool $creating): array
    {
        $opt = $creating ? 'sometimes' : 'sometimes';

        return [
            'title' => [$opt, 'nullable', 'string', 'max:255'],
            'pass_mark' => [$opt, 'integer', 'min:0', 'max:100'],
            'max_attempts' => [$opt, 'nullable', 'integer', 'min:1', 'max:100'],
        ];
    }

    /** Per-type correctness rules (server is the only judge of a valid quiz). */
    private function validateQuestions(array $questions): void
    {
        foreach ($questions as $i => $q) {
            $options = $q['options'] ?? [];
            $correct = count(array_filter($options, fn ($o): bool => (bool) ($o['is_correct'] ?? false)));
            $type = $q['type'] ?? '';

            if (in_array($type, ['SINGLE', 'TRUE_FALSE'], true) && $correct !== 1) {
                throw ValidationException::withMessages([
                    "questions.{$i}.options" => ['Pick exactly one correct answer.'],
                ]);
            }
            if ($type === 'MULTIPLE' && $correct < 1) {
                throw ValidationException::withMessages([
                    "questions.{$i}.options" => ['Mark at least one correct answer.'],
                ]);
            }
            if ($type === 'TRUE_FALSE' && count($options) !== 2) {
                throw ValidationException::withMessages([
                    "questions.{$i}.options" => ['A true/false question needs exactly two options.'],
                ]);
            }
        }
    }

    /**
     * Per-question correct-rate over every submitted attempt. The correctness rule is deliberately
     * identical to Learner\QuizController::grade() — exact match between the chosen options (minus
     * anything no longer on the question) and the correct set — so these rates reconcile with the
     * scores staff see next to them. An attempt that skipped a question writes no answer row and
     * counts as wrong, exactly as grading treats it, so the denominator is ALL submitted attempts.
     *
     * @return list<array<string,mixed>>
     */
    private function questionStats(string $quizId): array
    {
        $questions = DB::table('quiz_questions')->where('quiz_id', $quizId)
            ->orderBy('position')->orderBy('created_at')
            ->get(['id', 'prompt', 'type', 'points']);
        if ($questions->isEmpty()) {
            return [];
        }

        $options = DB::table('quiz_options')->whereIn('question_id', $questions->pluck('id'))
            ->get(['id', 'question_id', 'is_correct']);

        $correctByQ = [];
        $validByQ = [];
        foreach ($options as $o) {
            $validByQ[(string) $o->question_id][] = (string) $o->id;
            if ((bool) $o->is_correct) {
                $correctByQ[(string) $o->question_id][] = (string) $o->id;
            }
        }

        $attempts = (int) DB::table('quiz_attempts')
            ->where('quiz_id', $quizId)->whereNotNull('submitted_at')->count();

        $answers = DB::table('quiz_answers as qan')
            ->join('quiz_attempts as qa', 'qa.id', '=', 'qan.attempt_id')
            ->where('qa.quiz_id', $quizId)
            ->whereNotNull('qa.submitted_at')
            ->get(['qan.question_id', 'qan.selected_option_ids']);

        $correctCount = [];
        foreach ($answers as $a) {
            $qid = (string) $a->question_id;
            $decoded = json_decode((string) $a->selected_option_ids, true);
            $selected = is_array($decoded) ? array_map('strval', $decoded) : [];
            $selected = array_values(array_intersect($selected, $validByQ[$qid] ?? []));
            $correct = $correctByQ[$qid] ?? [];
            sort($correct);
            sort($selected);
            if ($correct !== [] && $correct === $selected) {
                $correctCount[$qid] = ($correctCount[$qid] ?? 0) + 1;
            }
        }

        return $questions->map(function (object $q) use ($correctCount, $attempts): array {
            $got = $correctCount[(string) $q->id] ?? 0;

            return [
                'id' => (string) $q->id,
                'prompt' => (string) $q->prompt,
                'type' => (string) $q->type,
                'points' => (int) $q->points,
                'correct_count' => $got,
                'attempts' => $attempts,
                'correct_rate' => $attempts > 0 ? (int) round(100 * $got / $attempts) : null,
            ];
        })->all();
    }

    /** Load a quiz in this course (RLS scopes it) or 404. */
    private function findQuiz(string $courseId, string $id): object
    {
        $this->findCourse($courseId);
        $quiz = DB::table('quizzes')->where('id', $id)->where('course_id', $courseId)->first();
        if ($quiz === null) {
            abort(404, 'Quiz not found.');
        }

        return $quiz;
    }

    /** @return array<string,mixed> */
    private function present(object $quiz, bool $includeAnswers): array
    {
        $questions = DB::table('quiz_questions')->where('quiz_id', $quiz->id)
            ->orderBy('position')->orderBy('created_at')
            ->get(['id', 'prompt', 'type', 'points', 'position']);

        $options = DB::table('quiz_options')
            ->whereIn('question_id', $questions->pluck('id'))
            ->orderBy('position')
            ->get(['id', 'question_id', 'text', 'is_correct', 'position']);

        $byQuestion = [];
        foreach ($options as $o) {
            $row = ['id' => (string) $o->id, 'text' => (string) $o->text];
            if ($includeAnswers) {
                $row['is_correct'] = (bool) $o->is_correct;
            }
            $byQuestion[(string) $o->question_id][] = $row;
        }

        return [
            'quiz' => [
                'id' => (string) $quiz->id,
                'course_id' => (string) $quiz->course_id,
                'title' => $quiz->title,
                'pass_mark' => (int) $quiz->pass_mark,
                'max_attempts' => $quiz->max_attempts !== null ? (int) $quiz->max_attempts : null,
            ],
            'questions' => $questions->map(fn (object $q): array => [
                'id' => (string) $q->id,
                'prompt' => (string) $q->prompt,
                'type' => (string) $q->type,
                'points' => (int) $q->points,
                'options' => $byQuestion[(string) $q->id] ?? [],
            ])->all(),
        ];
    }
}
