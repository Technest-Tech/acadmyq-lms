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
 * Optional questions under ANY lesson (not just a QUIZ lesson): the client attaches them per lesson,
 * the learner answers them under the content, graded by the same engine as a QUIZ lesson.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(modules: ['LMS'], overrides: ['client_type' => 'LMS', 'subdomain' => 'lqsite']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER');

    Sanctum::actingAs($this->owner);
    $this->courseId = $this->postJson('/api/courses', ['title' => 'Science'])->json('courseId');
    $sectionId = $this->postJson("/api/courses/{$this->courseId}/sections", ['title' => 'Unit 1'])->json('sectionId');

    $this->videoLessonId = $this->postJson("/api/courses/{$this->courseId}/lessons", [
        'section_id' => $sectionId, 'type' => 'YOUTUBE', 'title' => 'Atoms',
        'youtube_url' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    ])->assertCreated()->json('lessonId');
    $this->plainLessonId = $this->postJson("/api/courses/{$this->courseId}/lessons", [
        'section_id' => $sectionId, 'type' => 'TEXT', 'title' => 'Notes', 'body' => 'No questions here',
    ])->assertCreated()->json('lessonId');
});

function lqStaffLesson(string $courseId, string $lessonId): array
{
    return collect(test()->getJson("/api/courses/{$courseId}")->json('sections.0.lessons'))
        ->firstWhere('id', $lessonId);
}

function lqAddQuestions(string $courseId, string $lessonId): string
{
    $t = test();
    $quizId = $t->postJson("/api/courses/{$courseId}/lessons/{$lessonId}/questions")->assertOk()->json('quizId');
    $t->putJson("/api/courses/{$courseId}/quizzes/{$quizId}", [
        'questions' => [
            ['prompt' => 'Smallest unit?', 'type' => 'SINGLE', 'options' => [
                ['text' => 'Atom', 'is_correct' => true], ['text' => 'Cell'],
            ]],
        ],
    ])->assertOk();

    return $quizId;
}

it('lessons start with no questions', function () {
    $lesson = lqStaffLesson($this->courseId, $this->videoLessonId);
    expect($lesson['quiz_id'])->toBeNull();
    expect($lesson['question_count'])->toBe(0);
});

it('attaches questions to a non-quiz lesson, idempotently', function () {
    $quizId = lqAddQuestions($this->courseId, $this->videoLessonId);

    $again = $this->postJson("/api/courses/{$this->courseId}/lessons/{$this->videoLessonId}/questions")
        ->assertOk()->json('quizId');
    expect($again)->toBe($quizId);

    $lesson = lqStaffLesson($this->courseId, $this->videoLessonId);
    expect($lesson['type'])->toBe('YOUTUBE');
    expect($lesson['quiz_id'])->toBe($quizId);
    expect($lesson['question_count'])->toBe(1);
    expect(lqStaffLesson($this->courseId, $this->plainLessonId)['quiz_id'])->toBeNull();
});

it('keeps the questions when the lesson content is edited or its type changes', function () {
    $quizId = lqAddQuestions($this->courseId, $this->videoLessonId);

    $this->patchJson("/api/courses/{$this->courseId}/lessons/{$this->videoLessonId}", [
        'youtube_url' => 'https://youtu.be/9bZkp7q19f0',
    ])->assertOk();
    expect(lqStaffLesson($this->courseId, $this->videoLessonId)['quiz_id'])->toBe($quizId);

    $this->patchJson("/api/courses/{$this->courseId}/lessons/{$this->videoLessonId}", [
        'type' => 'TEXT', 'body' => 'Now a reading',
    ])->assertOk();
    expect(lqStaffLesson($this->courseId, $this->videoLessonId)['quiz_id'])->toBe($quizId);

    // Turning it into a QUIZ lesson reuses the same quiz rather than minting an empty one.
    $this->patchJson("/api/courses/{$this->courseId}/lessons/{$this->videoLessonId}", ['type' => 'QUIZ'])->assertOk();
    expect(lqStaffLesson($this->courseId, $this->videoLessonId)['quiz_id'])->toBe($quizId);
});

it('removes the questions when the quiz is deleted', function () {
    $quizId = lqAddQuestions($this->courseId, $this->videoLessonId);
    $this->deleteJson("/api/courses/{$this->courseId}/quizzes/{$quizId}")->assertOk();

    $lesson = lqStaffLesson($this->courseId, $this->videoLessonId);
    expect($lesson['quiz_id'])->toBeNull();
    expect($lesson['type'])->toBe('YOUTUBE');
});

it('lets an enrolled learner answer a lesson\'s questions, graded server-side', function () {
    lqAddQuestions($this->courseId, $this->videoLessonId);
    $this->postJson("/api/courses/{$this->courseId}/publish", ['status' => 'PUBLISHED'])->assertOk();
    $slug = $this->getJson("/api/courses/{$this->courseId}")->json('course.slug');
    $code = $this->postJson('/api/courses/codes/batch', [
        'course_ids' => [$this->courseId], 'count' => 1, 'max_redemptions' => 5,
    ])->assertCreated()->json('codes.0.code');
    app()['auth']->forgetGuards();

    $headers = ['X-Academy' => 'lqsite'];
    $token = $this->withHeaders($headers)->postJson('/api/learn/auth/register', [
        'full_name' => 'Learner', 'email' => 'l@example.com', 'password' => 'password123',
    ])->assertCreated()->json('token');
    $auth = $headers + ['Authorization' => "Bearer {$token}"];
    $this->withHeaders($auth)->postJson('/api/learn/redeem', ['code' => $code])->assertOk();

    // The outline tells the player which lessons carry questions.
    $lessons = collect($this->withHeaders($auth)->getJson("/api/learn/courses/{$slug}/content")
        ->assertOk()->json('sections.0.lessons'));
    expect($lessons->firstWhere('id', $this->videoLessonId)['question_count'])->toBe(1);
    expect($lessons->firstWhere('id', $this->plainLessonId)['question_count'])->toBe(0);

    $quiz = $this->withHeaders($auth)->getJson("/api/learn/lessons/{$this->videoLessonId}/quiz")->assertOk();
    $question = $quiz->json('questions.0');
    expect(array_key_exists('is_correct', $question['options'][0]))->toBeFalse();
    $right = collect($question['options'])->firstWhere('text', 'Atom')['id'];

    $res = $this->withHeaders($auth)->postJson("/api/learn/lessons/{$this->videoLessonId}/quiz/submit", [
        'answers' => [['question_id' => $question['id'], 'selected_option_ids' => [$right]]],
    ])->assertOk();
    expect($res->json('score'))->toBe(100);
    expect($res->json('passed'))->toBeTrue();

    // A lesson without questions has no quiz to fetch.
    $this->withHeaders($auth)->getJson("/api/learn/lessons/{$this->plainLessonId}/quiz")->assertNotFound();
});

it('needs course.manage to attach questions', function () {
    $teacher = $this->makeUser($this->academy, 'TEACHER');
    Sanctum::actingAs($teacher);
    $this->postJson("/api/courses/{$this->courseId}/lessons/{$this->videoLessonId}/questions")->assertForbidden();
    expect(DB::table('quizzes')->count())->toBe(0);
});
