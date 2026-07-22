<?php

declare(strict_types=1);

namespace App\Http\Controllers\Learner;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Learner\Concerns\InteractsWithLearner;
use App\Http\Controllers\Learner\Concerns\IssuesCertificates;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The learner quiz runner (docs/lms/04 §quizzes). Taking a quiz needs an ACTIVE enrollment. The quiz
 * is served WITHOUT the correct-answer flags; grading is server-side ONLY. On submit the attempt is
 * recorded, and on a pass the QUIZ lesson is marked COMPLETED — which may complete the course and
 * issue a certificate. Re-attempts are allowed until the quiz's `max_attempts`.
 */
final class QuizController extends Controller
{
    use InteractsWithLearner, IssuesCertificates;

    /** GET /api/learn/lessons/{id}/quiz — the quiz to take (no is_correct) + this learner's attempt state. */
    public function show(string $lessonId): JsonResponse
    {
        $this->currentAcademyId();
        $learner = $this->learner();
        [, $quiz] = $this->resolveQuiz($lessonId);

        $questions = DB::table('quiz_questions')->where('quiz_id', $quiz->id)
            ->orderBy('position')->orderBy('created_at')
            ->get(['id', 'prompt', 'type', 'points']);

        $options = DB::table('quiz_options')
            ->whereIn('question_id', $questions->pluck('id'))
            ->orderBy('position')
            ->get(['id', 'question_id', 'text']);   // NEVER is_correct

        $byQuestion = [];
        foreach ($options as $o) {
            $byQuestion[(string) $o->question_id][] = ['id' => (string) $o->id, 'text' => (string) $o->text];
        }

        $attempts = DB::table('quiz_attempts')
            ->where('learner_id', $learner->getKey())->where('quiz_id', $quiz->id)
            ->whereNotNull('submitted_at')
            ->get(['score', 'passed']);

        return response()->json([
            'quiz' => [
                'id' => (string) $quiz->id,
                'title' => $quiz->title,
                'pass_mark' => (int) $quiz->pass_mark,
                'max_attempts' => $quiz->max_attempts !== null ? (int) $quiz->max_attempts : null,
                'attempts_used' => $attempts->count(),
                'passed' => $attempts->contains(fn (object $a): bool => (bool) $a->passed),
                'best_score' => $attempts->max('score') !== null ? (int) $attempts->max('score') : null,
            ],
            'questions' => $questions->map(fn (object $q): array => [
                'id' => (string) $q->id,
                'prompt' => (string) $q->prompt,
                'type' => (string) $q->type,
                'points' => (int) $q->points,
                'options' => $byQuestion[(string) $q->id] ?? [],
            ])->all(),
        ]);
    }

    /** POST /api/learn/lessons/{id}/quiz/submit — grade server-side, record the attempt, complete on pass. */
    public function submit(Request $request, string $lessonId): JsonResponse
    {
        $academyId = $this->currentAcademyId();
        $learner = $this->learner();
        [$lesson, $quiz] = $this->resolveQuiz($lessonId);

        $used = DB::table('quiz_attempts')
            ->where('learner_id', $learner->getKey())->where('quiz_id', $quiz->id)
            ->whereNotNull('submitted_at')->count();
        if ($quiz->max_attempts !== null && $used >= (int) $quiz->max_attempts) {
            abort(422, 'You have used all your attempts for this quiz.');
        }

        $data = $request->validate([
            'answers' => ['present', 'array'],
            'answers.*.question_id' => ['required', 'uuid'],
            'answers.*.selected_option_ids' => ['sometimes', 'array'],
            'answers.*.selected_option_ids.*' => ['uuid'],
        ]);

        $score = $this->grade($quiz->id, $data['answers']);
        $passed = $score >= (int) $quiz->pass_mark;

        $attemptId = (string) Str::uuid();
        DB::transaction(function () use ($attemptId, $academyId, $learner, $quiz, $lesson, $data, $score, $passed): void {
            DB::table('quiz_attempts')->insert([
                'id' => $attemptId,
                'academy_id' => $academyId,
                'learner_id' => $learner->getKey(),
                'quiz_id' => $quiz->id,
                'score' => $score,
                'passed' => $passed,
                'submitted_at' => now(),
            ]);

            foreach ($data['answers'] as $a) {
                DB::table('quiz_answers')->insert([
                    'id' => (string) Str::uuid(),
                    'academy_id' => $academyId,
                    'attempt_id' => $attemptId,
                    'question_id' => (string) $a['question_id'],
                    'selected_option_ids' => json_encode(array_values(array_map('strval', $a['selected_option_ids'] ?? []))),
                ]);
            }

            if ($passed) {
                DB::table('lesson_progress')->updateOrInsert(
                    ['learner_id' => $learner->getKey(), 'lesson_id' => $lesson->id],
                    [
                        'academy_id' => $academyId,
                        'course_id' => $lesson->course_id,
                        'status' => 'COMPLETED',
                        'completed_at' => now(),
                        'updated_at' => now(),
                    ],
                );
            }
        });

        $certificate = $passed
            ? $this->maybeIssueCertificate($academyId, (string) $learner->getKey(), (string) $lesson->course_id)
            : null;

        return response()->json([
            'score' => $score,
            'passed' => $passed,
            'attempts_used' => $used + 1,
            'max_attempts' => $quiz->max_attempts !== null ? (int) $quiz->max_attempts : null,
            'certificate' => $certificate !== null ? ['serial' => (string) $certificate->serial] : null,
        ]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /**
     * Grade an attempt. All-or-nothing per question: the selected option set must EXACTLY equal the
     * correct set to earn the question's points. score = 100 * earned / total (percent). Junk option
     * ids (not of this question) are ignored, so a client can't smuggle points in.
     *
     * @param  list<array{question_id:string, selected_option_ids?:list<string>}>  $answers
     * @return int  score as a percent (0–100)
     */
    private function grade(string $quizId, array $answers): int
    {
        $questions = DB::table('quiz_questions')->where('quiz_id', $quizId)->get(['id', 'points']);
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

        $answerByQ = [];
        foreach ($answers as $a) {
            $answerByQ[(string) $a['question_id']] = array_map('strval', $a['selected_option_ids'] ?? []);
        }

        $total = 0;
        $earned = 0;
        foreach ($questions as $q) {
            $qid = (string) $q->id;
            $points = (int) $q->points;
            $total += $points;

            $correct = $correctByQ[$qid] ?? [];
            $selected = array_values(array_intersect($answerByQ[$qid] ?? [], $validByQ[$qid] ?? []));
            sort($correct);
            sort($selected);
            if ($correct !== [] && $correct === $selected) {
                $earned += $points;
            }
        }

        return $total > 0 ? (int) round(100 * $earned / $total) : 0;
    }

    /**
     * The QUIZ lesson + its quiz, enrollment-checked. 404 if the lesson isn't a QUIZ or has no quiz;
     * 403 if the learner isn't enrolled in its course.
     *
     * @return array{0:object,1:object}
     */
    private function resolveQuiz(string $lessonId): array
    {
        $lesson = DB::table('lessons')->where('id', $lessonId)->where('type', 'QUIZ')
            ->first(['id', 'course_id', 'quiz_id']);
        if ($lesson === null || $lesson->quiz_id === null) {
            abort(404, 'Quiz not found.');
        }
        $this->assertEnrolled((string) $lesson->course_id);

        $quiz = DB::table('quizzes')->where('id', $lesson->quiz_id)->first(['id', 'title', 'pass_mark', 'max_attempts']);
        if ($quiz === null) {
            abort(404, 'Quiz not found.');
        }

        return [$lesson, $quiz];
    }
}
