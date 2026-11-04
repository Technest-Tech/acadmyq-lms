<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * Exams, grades and the term report (docs/centre-profile, Phase 2 §5). Pinned here:
 *   - the whole thing is a centre's (402 without the switch) and the group's teacher may grade it,
 *     another teacher may not; publishing is the office's alone;
 *   - a score never passes its ceiling, a cell belongs to a member, a column with scores is only
 *     deleted on purpose;
 *   - the report's numbers: attendance over the membership window only, the weighted total with its
 *     weights, an absence counting as 0 and flagged, a student who left still on the sheet;
 *   - the parent reads a report once it is published — and a payload with none published is the
 *     one the page always sent.
 */
beforeEach(function () {
    // Wednesday 17 June 2026, 12:00 Cairo.
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['name' => 'Lingo Centre', 'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-grades@test.local']);
    $this->monaUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'mona-grades@test.local']);
    $this->karimUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'karim-grades@test.local']);
    $this->mona = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona', 'user_id' => $this->monaUser->getKey()]);
    $this->karim = $this->createTeacher($this->academy, ['full_name' => 'Mr Karim', 'user_id' => $this->karimUser->getKey()]);

    $this->parent = $this->createGuardian($this->academy, ['full_name' => 'Umm Adam', 'whatsapp_phone' => '+201001112224']);
    $this->adam = $this->createStudent($this->academy, $this->parent, ['full_name' => 'Adam']);
    $this->bassel = $this->createStudent($this->academy, $this->parent, ['full_name' => 'Bassel']);
    $this->otherParent = $this->createGuardian($this->academy, ['full_name' => 'Other Family']);
    $this->celine = $this->createStudent($this->academy, $this->otherParent, ['full_name' => 'Celine']);
    $this->dina = $this->createStudent($this->academy, $this->otherParent, ['full_name' => 'Dina']);
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

function gradesAs(string $academyId, callable $fn): mixed
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    try {
        return $fn();
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

function gradesCentreOn(string $academyId): void
{
    gradesAs($academyId, fn () => DB::table('module_subscriptions')
        ->where('academy_id', $academyId)->where('module', 'MANAGEMENT')
        ->update(['overrides' => json_encode(['enabled' => ['centre']])]));
}

/**
 * The group under test, written straight to the tables: Mona's English A1 since 1 May. Bassel from
 * the start, Adam from 1 June, Celine from the start until she left on 10 June. Four held lessons
 * and a cancelled one; Bassel is skipped on the last sheet.
 */
function gradesGroup($test): string
{
    $groupId = (string) Str::uuid();
    gradesAs($test->academy, function () use ($test, $groupId): void {
        DB::table('class_groups')->insert(['id' => $groupId, 'academy_id' => $test->academy, 'name' => 'English A1', 'level' => 'A1',
            'teacher_id' => $test->mona, 'timezone' => 'Africa/Cairo', 'start_date' => '2026-05-01']);
        foreach ([[$test->bassel, '2026-05-01', null], [$test->adam, '2026-06-01', null], [$test->celine, '2026-05-01', '2026-06-10']] as [$sid, $joined, $left]) {
            DB::table('class_group_members')->insert(['id' => (string) Str::uuid(), 'academy_id' => $test->academy, 'group_id' => $groupId,
                'student_id' => $sid, 'joined_on' => $joined, 'left_on' => $left, 'status' => $left === null ? 'ACTIVE' : 'LEFT']);
        }
        $lessons = [
            ['2026-05-27', 'HELD', [$test->bassel => 'PRESENT', $test->celine => 'PRESENT']],
            ['2026-06-01', 'HELD', [$test->adam => 'LATE', $test->bassel => 'PRESENT', $test->celine => 'ABSENT']],
            ['2026-06-08', 'HELD', [$test->adam => 'ABSENT', $test->bassel => 'PRESENT', $test->celine => 'PRESENT']],
            ['2026-06-10', 'CANCELLED', []],
            ['2026-06-15', 'HELD', [$test->adam => 'PRESENT']],
        ];
        foreach ($lessons as [$date, $status, $marks]) {
            $lessonId = (string) Str::uuid();
            DB::table('class_group_lessons')->insert(['id' => $lessonId, 'academy_id' => $test->academy, 'group_id' => $groupId,
                'teacher_id' => $test->mona, 'occurrence_local_date' => $date, 'scheduled_at_utc' => $date.' 15:00:00+00',
                'duration_minutes' => 60, 'status' => $status]);
            foreach ($marks as $sid => $mark) {
                DB::table('class_group_attendance')->insert(['id' => (string) Str::uuid(), 'academy_id' => $test->academy, 'lesson_id' => $lessonId,
                    'group_id' => $groupId, 'student_id' => $sid, 'status' => $mark]);
            }
        }
    });

    return $groupId;
}

function gradesAssessment($test, string $groupId, array $over = []): string
{
    Sanctum::actingAs($test->owner);

    return $test->postJson("/api/groups/{$groupId}/assessments", array_merge(['title' => 'Quiz 1', 'kind' => 'QUIZ', 'max_score' => 10, 'held_on' => '2026-06-03'], $over))
        ->assertCreated()->json('assessment.id');
}

function gradesPortalPage($test, string $guardianId)
{
    Sanctum::actingAs($test->owner);
    $url = $test->postJson("/api/guardians/{$guardianId}/portal")->assertOk()->json('url');
    $token = substr((string) $url, strrpos((string) $url, '/p/') + 3);
    foreach (['app.current_academy_id', 'app.current_role', 'app.current_user_id'] as $guc) {
        DB::statement('select set_config(?, \'\', true)', [$guc]);
    }

    return $test->getJson("/api/p/{$token}");
}

// ── The switch ───────────────────────────────────────────────────────────────

it('is a centre’s only: a Quran academy gets 402 on every route', function () {
    $groupId = gradesGroup($this);
    Sanctum::actingAs($this->owner);

    $this->getJson("/api/groups/{$groupId}/assessments")->assertStatus(402);
    $this->postJson("/api/groups/{$groupId}/assessments", ['title' => 'Quiz', 'max_score' => 10])->assertStatus(402);
    $this->getJson("/api/groups/{$groupId}/grades")->assertStatus(402);
    $this->getJson("/api/groups/{$groupId}/reports")->assertStatus(402);
    $this->getJson("/api/groups/{$groupId}/students/{$this->adam}/report")->assertStatus(402);
});

// ── Assessments ──────────────────────────────────────────────────────────────

it('lets the office and the group’s own teacher shape the sheet, and nobody else', function () {
    gradesCentreOn($this->academy);
    $groupId = gradesGroup($this);

    // The owner adds the mid-term; weight defaults to 1 and the column is empty.
    $midterm = gradesAssessment($this, $groupId, ['title' => 'Mid-term', 'kind' => 'MIDTERM', 'max_score' => 50, 'weight' => 2]);

    // Mona teaches it: she may add a column too.
    Sanctum::actingAs($this->monaUser);
    $this->postJson("/api/groups/{$groupId}/assessments", ['title' => 'Homework 1', 'kind' => 'HOMEWORK', 'max_score' => 5])
        ->assertCreated()->assertJsonPath('assessment.weight', 1)->assertJsonPath('assessment.graded_count', 0);
    $res = $this->getJson("/api/groups/{$groupId}/assessments")->assertOk();
    expect($res->json('assessments'))->toHaveCount(2);
    expect($res->json('can_mark'))->toBeTrue()->and($res->json('can_publish'))->toBeFalse();

    // Karim does not: the group is not his to read, let alone grade.
    Sanctum::actingAs($this->karimUser);
    $this->getJson("/api/groups/{$groupId}/assessments")->assertForbidden();
    $this->postJson("/api/groups/{$groupId}/assessments", ['title' => 'Nope', 'max_score' => 10])->assertForbidden();
    $this->getJson("/api/groups/{$groupId}/grades")->assertForbidden();

    // Edits and a plain delete.
    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/groups/{$groupId}/assessments/{$midterm}", ['title' => 'Mid-term exam', 'held_on' => '2026-06-09'])
        ->assertOk()->assertJsonPath('assessment.title', 'Mid-term exam')->assertJsonPath('assessment.held_on', '2026-06-09');
    $this->postJson("/api/groups/{$groupId}/assessments", ['title' => 'Bad', 'max_score' => 0])->assertUnprocessable();
    $this->postJson("/api/groups/{$groupId}/assessments", ['title' => 'Bad', 'max_score' => 10, 'kind' => 'EXAM'])->assertUnprocessable();
    $this->deleteJson("/api/groups/{$groupId}/assessments/{$midterm}")->assertOk();
    expect($this->getJson("/api/groups/{$groupId}/assessments")->json('assessments'))->toHaveCount(1);
});

it('keeps a graded column unless the delete is forced', function () {
    gradesCentreOn($this->academy);
    $groupId = gradesGroup($this);
    $quiz = gradesAssessment($this, $groupId);

    Sanctum::actingAs($this->owner);
    $this->putJson("/api/groups/{$groupId}/assessments/{$quiz}/scores", ['scores' => [['student_id' => $this->adam, 'score' => 7]]])->assertOk();
    expect($this->getJson("/api/groups/{$groupId}/assessments")->json('assessments.0.graded_count'))->toBe(1);

    $this->deleteJson("/api/groups/{$groupId}/assessments/{$quiz}")->assertUnprocessable();
    // A ceiling under a score already on the sheet is refused too.
    $this->patchJson("/api/groups/{$groupId}/assessments/{$quiz}", ['max_score' => 5])->assertUnprocessable();

    $this->deleteJson("/api/groups/{$groupId}/assessments/{$quiz}?force=1")->assertOk();
    expect(gradesAs($this->academy, fn () => DB::table('group_assessment_scores')->where('assessment_id', $quiz)->count()))->toBe(0);
});

// ── Scores ───────────────────────────────────────────────────────────────────

it('upserts a column’s cells as one, within the ceiling and for members only', function () {
    gradesCentreOn($this->academy);
    $groupId = gradesGroup($this);
    $quiz = gradesAssessment($this, $groupId);

    // Over the maximum: nothing of the batch is written.
    Sanctum::actingAs($this->monaUser);
    $this->putJson("/api/groups/{$groupId}/assessments/{$quiz}/scores", ['scores' => [
        ['student_id' => $this->adam, 'score' => 8],
        ['student_id' => $this->bassel, 'score' => 11],
    ]])->assertUnprocessable()->assertJsonValidationErrors(['scores.1.score']);
    expect(gradesAs($this->academy, fn () => DB::table('group_assessment_scores')->count()))->toBe(0);

    // Dina never sat in this group.
    $this->putJson("/api/groups/{$groupId}/assessments/{$quiz}/scores", ['scores' => [['student_id' => $this->dina, 'score' => 8]]])
        ->assertUnprocessable()->assertJsonValidationErrors(['scores.0.student_id']);

    // The teacher's sheet: Adam 8, Bassel 10, Celine (who left) absent.
    $res = $this->putJson("/api/groups/{$groupId}/assessments/{$quiz}/scores", ['scores' => [
        ['student_id' => $this->adam, 'score' => 8, 'note' => 'Good effort'],
        ['student_id' => $this->bassel, 'score' => 10],
        ['student_id' => $this->celine, 'absent' => true],
    ]])->assertOk();

    expect(collect($res->json('members'))->pluck('full_name')->all())->toBe(['Adam', 'Bassel', 'Celine']);
    expect(collect($res->json('members'))->firstWhere('student_id', $this->celine))->toMatchArray(['left' => true, 'left_on' => '2026-06-10']);
    expect($res->json("scores.{$this->adam}.{$quiz}"))->toMatchArray(['score' => 8, 'absent' => false, 'percent' => 80, 'note' => 'Good effort']);
    expect($res->json("scores.{$this->celine}.{$quiz}"))->toMatchArray(['score' => null, 'absent' => true, 'percent' => 0]);
    expect($res->json("totals.{$this->adam}"))->toBe(80)->and($res->json("totals.{$this->bassel}"))->toBe(100)->and($res->json("totals.{$this->celine}"))->toBe(0);

    // Re-saving edits in place; a blank cell clears the row.
    $res = $this->putJson("/api/groups/{$groupId}/assessments/{$quiz}/scores", ['scores' => [
        ['student_id' => $this->adam, 'score' => 9],
        ['student_id' => $this->bassel, 'score' => null, 'absent' => false],
    ]])->assertOk();
    expect($res->json("scores.{$this->adam}.{$quiz}.score"))->toBe(9);
    expect($res->json("scores.{$this->bassel}.{$quiz}.score"))->toBeNull()->and($res->json("totals.{$this->bassel}"))->toBeNull();
    expect(gradesAs($this->academy, fn () => DB::table('group_assessment_scores')->where('assessment_id', $quiz)->count()))->toBe(2);

    // Not Karim's group.
    Sanctum::actingAs($this->karimUser);
    $this->putJson("/api/groups/{$groupId}/assessments/{$quiz}/scores", ['scores' => [['student_id' => $this->adam, 'score' => 1]]])->assertForbidden();
});

// ── The report ───────────────────────────────────────────────────────────────

it('composes the report from the membership window, the weights and the absences', function () {
    gradesCentreOn($this->academy);
    $groupId = gradesGroup($this);
    $quiz = gradesAssessment($this, $groupId);                                                                   // /10, weight 1
    $midterm = gradesAssessment($this, $groupId, ['title' => 'Mid-term', 'kind' => 'MIDTERM', 'max_score' => 50, 'weight' => 2]);
    gradesAssessment($this, $groupId, ['title' => 'Project', 'kind' => 'PROJECT', 'max_score' => 20]);          // nobody graded

    Sanctum::actingAs($this->owner);
    $this->putJson("/api/groups/{$groupId}/assessments/{$quiz}/scores", ['scores' => [
        ['student_id' => $this->adam, 'score' => 8], ['student_id' => $this->celine, 'absent' => true],
    ]])->assertOk();
    $this->putJson("/api/groups/{$groupId}/assessments/{$midterm}/scores", ['scores' => [
        ['student_id' => $this->adam, 'score' => 40], ['student_id' => $this->celine, 'score' => 25],
    ]])->assertOk();

    // Adam: a member since 1 June — the 27 May sheet is not his. 3 held, late + absent + present.
    $adam = $this->getJson("/api/groups/{$groupId}/students/{$this->adam}/report")->assertOk()->json('report');
    expect($adam['student'])->toMatchArray(['id' => $this->adam, 'full_name' => 'Adam']);
    expect($adam['group'])->toMatchArray(['name' => 'English A1', 'level' => 'A1', 'teacher_name' => 'Miss Mona']);
    expect($adam['period'])->toBe(['from' => '2026-06-01', 'to' => '2026-06-17', 'left' => false]);
    expect($adam['attendance'])->toBe(['present' => 1, 'late' => 1, 'absent' => 1, 'excused' => 0, 'rate' => 67, 'lessons_held' => 3]);
    expect(collect($adam['grades'])->pluck('title')->all())->toBe(['Quiz 1', 'Mid-term', 'Project']);
    expect($adam['grades'][0])->toMatchArray(['score' => 8, 'max_score' => 10, 'percent' => 80, 'weight' => 1, 'kind' => 'QUIZ', 'held_on' => '2026-06-03']);
    expect($adam['grades'][2])->toMatchArray(['score' => null, 'absent' => false, 'percent' => null]);
    // (80×1 + 80×2) / 3 — the ungraded project does not weigh in.
    expect($adam['total'])->toBe(['weighted_percent' => 80]);
    expect($adam['comment'])->toBeNull()->and($adam['published_at'])->toBeNull();

    // Celine left on 10 June: still on the sheet, flagged, her window closed, the absence a 0 that counts.
    $celine = $this->getJson("/api/groups/{$groupId}/students/{$this->celine}/report")->assertOk()->json('report');
    expect($celine['period'])->toBe(['from' => '2026-05-01', 'to' => '2026-06-10', 'left' => true]);
    expect($celine['attendance'])->toBe(['present' => 2, 'late' => 0, 'absent' => 1, 'excused' => 0, 'rate' => 67, 'lessons_held' => 3]);
    expect($celine['grades'][0])->toMatchArray(['absent' => true, 'percent' => 0]);
    expect($celine['total']['weighted_percent'])->toBe(33.3);

    // Bassel: skipped on the last sheet — four lessons held for him, three marks.
    $bassel = $this->getJson("/api/groups/{$groupId}/students/{$this->bassel}/report")->assertOk()->json('report');
    expect($bassel['attendance'])->toBe(['present' => 3, 'late' => 0, 'absent' => 0, 'excused' => 0, 'rate' => 100, 'lessons_held' => 4]);
    expect($bassel['total']['weighted_percent'])->toBeNull();

    // Never a member.
    $this->getJson("/api/groups/{$groupId}/students/{$this->dina}/report")->assertNotFound();

    // The list carries the same numbers, one row each.
    $rows = collect($this->getJson("/api/groups/{$groupId}/reports")->assertOk()->json('reports'));
    expect($rows->pluck('full_name')->all())->toBe(['Adam', 'Bassel', 'Celine']);
    expect($rows->firstWhere('student_id', $this->adam))->toMatchArray(['total' => ['weighted_percent' => 80], 'graded_count' => 2, 'published_at' => null, 'has_comment' => false]);
    expect($rows->firstWhere('student_id', $this->adam)['attendance']['rate'])->toBe(67);
});

it('lets the teacher write the comment but only the office publish', function () {
    gradesCentreOn($this->academy);
    $groupId = gradesGroup($this);

    Sanctum::actingAs($this->monaUser);
    $res = $this->putJson("/api/groups/{$groupId}/students/{$this->adam}/report", ['comment' => 'Works hard, needs to revise tenses.', 'overall_grade' => 'B+'])->assertOk();
    expect($res->json('report.comment'))->toBe('Works hard, needs to revise tenses.')->and($res->json('report.overall_grade'))->toBe('B+');
    expect($res->json('can_mark'))->toBeTrue()->and($res->json('can_publish'))->toBeFalse();
    $this->postJson("/api/groups/{$groupId}/students/{$this->adam}/report/publish")->assertForbidden();
    $this->postJson("/api/groups/{$groupId}/reports/publish-all")->assertForbidden();

    Sanctum::actingAs($this->karimUser);
    $this->putJson("/api/groups/{$groupId}/students/{$this->adam}/report", ['comment' => 'Not mine'])->assertForbidden();

    Sanctum::actingAs($this->owner);
    $this->putJson("/api/groups/{$groupId}/students/{$this->dina}/report", ['comment' => 'Not a member'])->assertUnprocessable();
    $res = $this->postJson("/api/groups/{$groupId}/students/{$this->adam}/report/publish")->assertOk();
    expect($res->json('report.published_at'))->not->toBeNull()->and($res->json('report.comment'))->toBe('Works hard, needs to revise tenses.');
    expect($res->json('academy.name'))->toBe('Lingo Centre');

    // Publishing the rest in one go publishes the two left, not Adam again.
    $res = $this->postJson("/api/groups/{$groupId}/reports/publish-all")->assertOk();
    expect($res->json('published'))->toBe(2);
    expect(collect($res->json('reports'))->pluck('published_at')->filter()->count())->toBe(3);

    $res = $this->postJson("/api/groups/{$groupId}/students/{$this->adam}/report/unpublish")->assertOk();
    expect($res->json('report.published_at'))->toBeNull()->and($res->json('report.comment'))->toBe('Works hard, needs to revise tenses.');

    expect(gradesAs($this->academy, fn () => DB::table('audit_log')->whereIn('action', ['group_term_report.saved', 'group_term_report.published', 'group_term_report.unpublished'])->count()))->toBe(5);
});

// ── The parent ───────────────────────────────────────────────────────────────

it('reaches the parent once published, and leaves the page untouched until then', function () {
    gradesCentreOn($this->academy);
    $groupId = gradesGroup($this);
    $quiz = gradesAssessment($this, $groupId);
    Sanctum::actingAs($this->owner);
    $this->putJson("/api/groups/{$groupId}/assessments/{$quiz}/scores", ['scores' => [
        ['student_id' => $this->adam, 'score' => 8, 'note' => 'Staff-only note'], ['student_id' => $this->bassel, 'score' => 6],
    ]])->assertOk();
    $this->putJson("/api/groups/{$groupId}/students/{$this->adam}/report", ['comment' => 'Well done Adam', 'overall_grade' => 'A'])->assertOk();
    $this->putJson("/api/groups/{$groupId}/students/{$this->bassel}/report", ['comment' => 'Bassel draft comment'])->assertOk();

    // Written but not published: the payload is exactly what the page sent before.
    $before = gradesPortalPage($this, $this->parent)->assertOk();
    foreach ($before->json('children') as $child) {
        expect($child)->not->toHaveKey('term_reports');
    }
    expect($before->getContent())->not->toContain('Well done Adam', 'Bassel draft comment');

    $this->postJson("/api/groups/{$groupId}/students/{$this->adam}/report/publish")->assertOk();

    $after = gradesPortalPage($this, $this->parent)->assertOk();
    $adam = collect($after->json('children'))->firstWhere('id', $this->adam);
    $bassel = collect($after->json('children'))->firstWhere('id', $this->bassel);
    expect($adam['term_reports'])->toHaveCount(1);
    expect($adam['term_reports'][0])->toMatchArray(['group_name' => 'English A1', 'level' => 'A1', 'teacher_name' => 'Miss Mona', 'comment' => 'Well done Adam', 'overall_grade' => 'A']);
    expect($adam['term_reports'][0]['attendance'])->toBe(['present' => 1, 'late' => 1, 'absent' => 1, 'excused' => 0, 'rate' => 67, 'lessons_held' => 3]);
    expect($adam['term_reports'][0]['grades'][0])->toMatchArray(['title' => 'Quiz 1', 'score' => 8, 'max_score' => 10, 'percent' => 80]);
    expect($adam['term_reports'][0]['grades'][0])->not->toHaveKey('note');
    expect($adam['term_reports'][0]['total'])->toBe(['weighted_percent' => 80]);
    expect($bassel)->not->toHaveKey('term_reports');
    expect($after->getContent())->not->toContain('Staff-only note', 'Bassel draft comment');

    // Every other key of the child is as it was.
    $adamBefore = collect($before->json('children'))->firstWhere('id', $this->adam);
    unset($adam['term_reports']);
    expect($adam)->toBe($adamBefore);

    // The other family sees nothing of Adam's.
    $other = gradesPortalPage($this, $this->otherParent)->assertOk();
    expect($other->getContent())->not->toContain('Well done Adam');

    // Taken back: gone from the page again.
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$groupId}/students/{$this->adam}/report/unpublish")->assertOk();
    $again = gradesPortalPage($this, $this->parent)->assertOk();
    expect(collect($again->json('children'))->firstWhere('id', $this->adam))->not->toHaveKey('term_reports');
});
