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
