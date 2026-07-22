<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * LMS phase 4 — quizzes & certificates (docs/lms/04). Builder (staff), server-side grading (learner,
 * answers never leaked), attempt limits, and course-completion certificates.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $lmsPlan = DB::table('plans')->where('code', 'LMS_BASIC')->value('id');
    $this->academy = $this->createAcademy(overrides: ['plan_id' => $lmsPlan, 'subdomain' => 'quizsite']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER');

    Sanctum::actingAs($this->owner);
    $courseId = $this->postJson('/api/courses', ['title' => 'Math'])->json('courseId');
    $sectionId = $this->postJson("/api/courses/{$courseId}/sections", ['title' => 'Unit 1'])->json('sectionId');

    // A normal lesson (so full-course completion needs more than the quiz) + a QUIZ lesson.
    $this->textLessonId = $this->postJson("/api/courses/{$courseId}/lessons", [
        'section_id' => $sectionId, 'type' => 'TEXT', 'title' => 'Reading', 'body' => '# Notes',
    ])->assertCreated()->json('lessonId');
    $this->quizLessonId = $this->postJson("/api/courses/{$courseId}/lessons", [
        'section_id' => $sectionId, 'type' => 'QUIZ', 'title' => 'Quiz 1',
    ])->assertCreated()->json('lessonId');

    // The QUIZ lesson auto-created an empty quiz — find its id and fill it in.
    $lessons = collect($this->getJson("/api/courses/{$courseId}")->json('sections.0.lessons'));
    $this->quizId = $lessons->firstWhere('type', 'QUIZ')['quiz_id'];
    expect($this->quizId)->toBeString();

    $this->putJson("/api/courses/{$courseId}/quizzes/{$this->quizId}", [
        'pass_mark' => 60,
        'questions' => [
            ['prompt' => '2+2?', 'type' => 'SINGLE', 'points' => 1, 'options' => [
                ['text' => '3'], ['text' => '4', 'is_correct' => true], ['text' => '5'],
            ]],
            ['prompt' => 'Pick the primes', 'type' => 'MULTIPLE', 'points' => 1, 'options' => [
                ['text' => '2', 'is_correct' => true], ['text' => '3', 'is_correct' => true], ['text' => '4'],
            ]],
        ],
    ])->assertOk();

    $this->postJson("/api/courses/{$courseId}/publish", ['status' => 'PUBLISHED'])->assertOk();
    $this->courseId = $courseId;
    $this->slug = $this->getJson("/api/courses/{$courseId}")->json('course.slug');
    $this->code = $this->postJson('/api/courses/codes/batch', [
        'course_ids' => [$courseId], 'count' => 1, 'max_redemptions' => 5,
    ])->assertCreated()->json('codes.0.code');

    app()['auth']->forgetGuards();
});

/** Register a learner + redeem the course code; returns the auth headers. */
function enrolledLearner(string $email): array
{
    $t = test();
    $headers = ['X-Academy' => 'quizsite'];
    $token = $t->withHeaders($headers)->postJson('/api/learn/auth/register', [
        'full_name' => 'Q Learner', 'email' => $email, 'password' => 'password123',
    ])->assertCreated()->json('token');
    $auth = $headers + ['Authorization' => "Bearer {$token}"];
    $t->withHeaders($auth)->postJson('/api/learn/redeem', ['code' => test()->code])->assertOk();

    return $auth;
}

/** GET the quiz, choose options by their text per prompt, submit. @param array<string,list<string>> $pick */
function takeQuiz(array $auth, string $lessonId, array $pick): \Illuminate\Testing\TestResponse
{
    $t = test();
    $quiz = $t->withHeaders($auth)->getJson("/api/learn/lessons/{$lessonId}/quiz")->assertOk();
    $answers = [];
    foreach ($quiz->json('questions') as $q) {
        $want = $pick[$q['prompt']] ?? [];
        $selected = [];
        foreach ($q['options'] as $opt) {
            if (in_array($opt['text'], $want, true)) {
                $selected[] = $opt['id'];
            }
        }
        $answers[] = ['question_id' => $q['id'], 'selected_option_ids' => $selected];
    }

    return $t->withHeaders($auth)->postJson("/api/learn/lessons/{$lessonId}/quiz/submit", ['answers' => $answers]);
}

// ── builder validation ───────────────────────────────────────────────────────
it('rejects a SINGLE question without exactly one correct option', function () {
    Sanctum::actingAs($this->owner);
    $this->putJson("/api/courses/{$this->courseId}/quizzes/{$this->quizId}", [
        'questions' => [
            ['prompt' => 'bad', 'type' => 'SINGLE', 'options' => [
                ['text' => 'a', 'is_correct' => true], ['text' => 'b', 'is_correct' => true],
            ]],
        ],
    ])->assertStatus(422);
});

// ── the learner NEVER sees which option is correct ───────────────────────────
it('serves the quiz to an enrolled learner without the correct-answer flags', function () {
    $auth = enrolledLearner('a@example.com');
    $quiz = $this->withHeaders($auth)->getJson("/api/learn/lessons/{$this->quizLessonId}/quiz")->assertOk();

    $options = collect($quiz->json('questions'))->flatMap(fn ($q) => $q['options']);
    expect($options)->not->toBeEmpty();
    $options->each(fn ($o) => expect(array_key_exists('is_correct', $o))->toBeFalse());
    expect($quiz->json('quiz.pass_mark'))->toBe(60);
});

// ── enrollment gates the quiz ────────────────────────────────────────────────
it('refuses the quiz to a learner who is not enrolled', function () {
    $headers = ['X-Academy' => 'quizsite'];
    $token = $this->withHeaders($headers)->postJson('/api/learn/auth/register', [
        'full_name' => 'NoEnroll', 'email' => 'no@example.com', 'password' => 'password123',
    ])->json('token');

    $this->withHeaders($headers + ['Authorization' => "Bearer {$token}"])
        ->getJson("/api/learn/lessons/{$this->quizLessonId}/quiz")->assertStatus(403);
});

// ── server-side grading: correct → pass, partial → all-or-nothing fail ────────
it('grades server-side and marks the lesson complete on a pass', function () {
    $auth = enrolledLearner('pass@example.com');

    $res = takeQuiz($auth, $this->quizLessonId, ['2+2?' => ['4'], 'Pick the primes' => ['2', '3']])->assertOk();
    expect($res->json('score'))->toBe(100);
    expect($res->json('passed'))->toBeTrue();

    // The QUIZ lesson now reads back COMPLETED in the player payload.
    $content = $this->withHeaders($auth)->getJson("/api/learn/courses/{$this->slug}/content")->assertOk();
    expect($content->json("progress.{$this->quizLessonId}.status"))->toBe('COMPLETED');
});

it('scores per-question all-or-nothing (a partial MULTIPLE earns nothing)', function () {
    $auth = enrolledLearner('partial@example.com');

    // Q1 right (1pt), Q2 partially right → 0 → 50% → below the 60 pass mark.
    $res = takeQuiz($auth, $this->quizLessonId, ['2+2?' => ['4'], 'Pick the primes' => ['2']])->assertOk();
    expect($res->json('score'))->toBe(50);
    expect($res->json('passed'))->toBeFalse();
});

// ── attempt limit ────────────────────────────────────────────────────────────
it('enforces max_attempts', function () {
    Sanctum::actingAs($this->owner);
    $this->putJson("/api/courses/{$this->courseId}/quizzes/{$this->quizId}", ['max_attempts' => 1])->assertOk();
    app()['auth']->forgetGuards();

    $auth = enrolledLearner('once@example.com');
    takeQuiz($auth, $this->quizLessonId, ['2+2?' => ['3']])->assertOk();               // attempt 1 (fail)
    takeQuiz($auth, $this->quizLessonId, ['2+2?' => ['4'], 'Pick the primes' => ['2', '3']])
        ->assertStatus(422);                                                            // attempt 2 refused
});

// ── certificate on full course completion ────────────────────────────────────
it('issues a certificate once every lesson is complete', function () {
    $auth = enrolledLearner('cert@example.com');

    // No certificate before completion.
    $this->withHeaders($auth)->getJson("/api/learn/courses/{$this->slug}/certificate")->assertNotFound();

    // Pass the quiz — but the TEXT lesson is still incomplete, so no certificate yet.
    $quizRes = takeQuiz($auth, $this->quizLessonId, ['2+2?' => ['4'], 'Pick the primes' => ['2', '3']])->assertOk();
    expect($quizRes->json('certificate'))->toBeNull();

    // Complete the last lesson → the certificate is issued in that response.
    $progress = $this->withHeaders($auth)
        ->postJson("/api/learn/lessons/{$this->textLessonId}/progress", ['completed' => true])
        ->assertOk();
    expect($progress->json('certificate.serial'))->toBeString();

    // And the certificate endpoint now returns it.
    $cert = $this->withHeaders($auth)->getJson("/api/learn/courses/{$this->slug}/certificate")->assertOk();
    expect($cert->json('serial'))->toStartWith('C-');
    expect($cert->json('course_title'))->toBe('Math');
    expect($cert->json('learner_name'))->toBe('Q Learner');
});
