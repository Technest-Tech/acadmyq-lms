<?php

declare(strict_types=1);

use App\Jobs\RollSessionWindowJob;
use App\Services\GroupLessonGenerator;
use App\Services\ModuleBilling;
use App\Services\SessionGenerator;
use App\Support\Entitlement;
use App\Support\FeatureCatalog;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * Group classes (docs/groups). The rules pinned here:
 *   - a group lesson is its own row, ONE per lesson however many students sit in it;
 *   - generation is idempotent, back-fills from the start date, and never rewrites history;
 *   - the sheet defaults everyone to present, and membership is a half-open date range;
 *   - seats are enforced, a TEACHER reaches only their own groups, and the switch 402s.
 */
beforeEach(function () {
    // Wednesday 17 June 2026, 12:00 Cairo.
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-groups@test.local']);

    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 't1-groups@test.local']);
    $this->otherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 't2-groups@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona', 'user_id' => $this->teacherUser->getKey()]);
    $this->other = $this->createTeacher($this->academy, ['full_name' => 'Mr Karim', 'user_id' => $this->otherUser->getKey()]);

    $this->students = [];
    foreach (['Adam', 'Bassel', 'Celine', 'Dina'] as $name) {
        $this->students[$name] = $this->createStudent($this->academy, null, ['full_name' => $name, 'status' => 'REGULAR']);
    }
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

/** Mondays and Wednesdays at 17:00 Cairo, an hour each. */
function groupPayload(array $over = []): array
{
    return array_merge([
        'name' => 'English A1 — evening',
        'level' => 'A1',
        'capacity' => 3,
        'start_date' => '2026-06-01',
        'slots' => [
            ['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60],
            ['weekday' => 3, 'start_time_local' => '17:00', 'duration_minutes' => 60],
        ],
    ], $over);
}

function makeGroup($test, array $over = []): string
{
    Sanctum::actingAs($test->owner);

    return $test->postJson('/api/groups', groupPayload($over + ['teacher_id' => $test->teacher]))
        ->assertCreated()
        ->json('group.id');
}

if (! function_exists('asTenant')) {
    /** Read under the academy's own tenant context, then drop it again (the helpers are global). */
    function asTenant(string $academyId, callable $fn): mixed
    {
        DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
        DB::statement("select set_config('app.current_role', 'ACADEMY_OWNER', true)");
        try {
            return $fn();
        } finally {
            DB::statement("select set_config('app.current_academy_id', '', true)");
            DB::statement("select set_config('app.current_role', '', true)");
        }
    }
}

if (! function_exists('lessonOn')) {
    function lessonOn($test, string $groupId, string $date): object
    {
        return asTenant($test->academy, fn () => DB::table('class_group_lessons')
            ->where('group_id', $groupId)->where('occurrence_local_date', $date)->first());
    }
}

function groupLessonDates($test, string $groupId): array
{
    return asTenant($test->academy, fn () => DB::table('class_group_lessons')->where('group_id', $groupId)
        ->orderBy('scheduled_at_utc')->pluck('occurrence_local_date')
        ->map(fn ($d) => Carbon::parse($d)->format('Y-m-d'))->all());
}

// ── The switch ───────────────────────────────────────────────────────────────

it('is a feature of the management module, on for a new client', function () {
    expect(FeatureCatalog::moduleOfCapability('groups'))->toBe('MANAGEMENT');

    $this->asAcademy($this->academy);
    expect(Entitlement::resolve($this->academy)['capabilities'])->toContain('groups');
});

it('answers 402 everywhere once the Super Admin switches it off', function () {
    $groupId = makeGroup($this);

    $this->asAcademy($this->academy, 'SUPER_ADMIN');
    app(ModuleBilling::class)->setDisabledFeatures($this->academy, 'MANAGEMENT', ['groups']);
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/groups')->assertStatus(402);
    $this->getJson("/api/groups/{$groupId}")->assertStatus(402);
    $this->postJson('/api/groups', groupPayload(['teacher_id' => $this->teacher]))->assertStatus(402);

    // …and the calendar stops carrying its lessons, though the rows are still there.
    $this->getJson('/api/calendar?from=2026-06-15&to=2026-06-21')->assertOk()->assertJsonCount(0, 'group_lessons');
    $this->asAcademy($this->academy);
    expect(DB::table('class_group_lessons')->where('group_id', $groupId)->count())->toBeGreaterThan(0);
});

it('ships switched OFF for every client that already exists, and only for them', function () {
    // One client with another feature already off, one with no overrides at all.
    $this->asAcademy($this->academy, 'SUPER_ADMIN');
    app(ModuleBilling::class)->setDisabledFeatures($this->academy, 'MANAGEMENT', ['crm']);
    $this->clearTenantContext();
    $plain = $this->createAcademy();
    $this->clearTenantContext();

    $migration = require database_path('migrations/2026_10_19_000002_class_groups.php');
    $migration->switchOffForExistingClients();
    $migration->switchOffForExistingClients(); // a second run adds nothing
    $this->clearTenantContext();

    $disabled = function (string $academyId): array {
        return asTenant($academyId, fn () => json_decode((string) DB::table('module_subscriptions')
            ->where('academy_id', $academyId)->where('module', 'MANAGEMENT')->value('overrides'), true)['disabled'] ?? []);
    };
    expect($disabled($this->academy))->toBe(['crm', 'groups']);
    expect($disabled($plain))->toBe(['groups']);

    $caps = asTenant($this->academy, fn () => Entitlement::resolve($this->academy)['capabilities']);
    expect($caps)->not->toContain('groups')->toContain('invoicing');

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/groups')->assertStatus(402);

    // A client created afterwards is untouched: the module grants everything it owns.
    $later = $this->createAcademy();
    $this->clearTenantContext();
    expect(asTenant($later, fn () => Entitlement::resolve($later)['capabilities']))->toContain('groups');
});

// ── Generation ───────────────────────────────────────────────────────────────

it('creates one lesson per weekly time, back-filled from the start date, all pending', function () {
    $groupId = makeGroup($this);
    $dates = groupLessonDates($this, $groupId);

    // June 1 (Mon), 3 (Wed), 8, 10, 15 — before today, back-filled so the academy can mark them.
    expect($dates)->toContain('2026-06-01')->toContain('2026-06-03')->toContain('2026-06-15');
    // …and forward to the end of next month.
    expect($dates)->toContain('2026-07-29');
    expect($dates)->not->toContain('2026-05-27');

    $this->asAcademy($this->academy);
    expect(DB::table('class_group_lessons')->where('group_id', $groupId)->distinct()->pluck('status')->all())->toBe(['SCHEDULED']);
    // One row per lesson — never one per student.
    expect(DB::table('class_group_lessons')->where('group_id', $groupId)->count())->toBe(count($dates));
});

it('is idempotent: regenerating creates nothing new', function () {
    $groupId = makeGroup($this);
    $before = count(groupLessonDates($this, $groupId));

    $this->asAcademy($this->academy);
    $counts = app(GroupLessonGenerator::class)->regenerate($groupId, backfill: true);

    expect($counts['created'])->toBe(0)->and($counts['removed'])->toBe(0);
    expect(count(groupLessonDates($this, $groupId)))->toBe($before);
});

it('stops at the end date', function () {
    $groupId = makeGroup($this, ['end_date' => '2026-06-24']);
    $dates = groupLessonDates($this, $groupId);

    expect(end($dates))->toBe('2026-06-24');
    expect($dates)->not->toContain('2026-06-29');
});

it('moves future pending lessons with a timetable edit, but never a held one', function () {
    $groupId = makeGroup($this);
    $past = lessonOn($this, $groupId, '2026-06-15');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$past->id}/attendance")->assertOk();

    // Wednesday moves from 17:00 to 18:30; Monday stays.
    $this->patchJson("/api/groups/{$groupId}", ['slots' => [
        ['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60],
        ['weekday' => 3, 'start_time_local' => '18:30', 'duration_minutes' => 60],
    ]])->assertOk();

    $held = lessonOn($this, $groupId, '2026-06-15');
    expect($held->status)->toBe('HELD');

    $this->asAcademy($this->academy);
    $nextWed = DB::table('class_group_lessons')->where('group_id', $groupId)->where('occurrence_local_date', '2026-06-24')->get();
    expect($nextWed)->toHaveCount(1);
    expect(Carbon::parse($nextWed[0]->scheduled_at_utc)->setTimezone('Africa/Cairo')->format('H:i'))->toBe('18:30');

    // The old Wednesday 17:00 lesson already in the past is still there, exactly once.
    expect(DB::table('class_group_lessons')->where('group_id', $groupId)->where('occurrence_local_date', '2026-06-10')->count())->toBe(1);
});

it('archiving drops the future pending lessons and keeps the history', function () {
    $groupId = makeGroup($this);
    $past = lessonOn($this, $groupId, '2026-06-15');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$past->id}/attendance")->assertOk();
    $this->postJson("/api/groups/{$groupId}/archive")->assertOk()->assertJsonPath('group.state', 'ARCHIVED');

    $dates = groupLessonDates($this, $groupId);
    expect($dates)->toContain('2026-06-15');
    expect($dates)->not->toContain('2026-06-22');

    $this->postJson("/api/groups/{$groupId}/restore")->assertOk();
    expect(groupLessonDates($this, $groupId))->toContain('2026-06-22');
});

it('refuses to delete a group that has held a lesson, and deletes one that has not', function () {
    $groupId = makeGroup($this);
    $past = lessonOn($this, $groupId, '2026-06-15');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$past->id}/attendance")->assertOk();
    $this->deleteJson("/api/groups/{$groupId}")->assertStatus(422);

    $fresh = makeGroup($this, ['name' => 'Mistake', 'start_date' => '2026-07-01']);
    $this->deleteJson("/api/groups/{$fresh}")->assertOk();
    $this->asAcademy($this->academy);
    expect(DB::table('class_groups')->where('id', $fresh)->exists())->toBeFalse();
});

it('runs in the nightly roll only for academies that have the feature', function () {
    $groupId = makeGroup($this, ['end_date' => null]);

    // Forget everything after this week, then let the roll put it back.
    $this->asAcademy($this->academy);
    DB::table('class_group_lessons')->where('group_id', $groupId)->where('occurrence_local_date', '>', '2026-06-21')->delete();
    $this->clearTenantContext();

    (new RollSessionWindowJob(onlyAcademyId: $this->academy))->handle(app(SessionGenerator::class));
    expect(groupLessonDates($this, $groupId))->toContain('2026-07-29');

    $this->asAcademy($this->academy, 'SUPER_ADMIN');
    app(ModuleBilling::class)->setDisabledFeatures($this->academy, 'MANAGEMENT', ['groups']);
    DB::table('class_group_lessons')->where('group_id', $groupId)->where('occurrence_local_date', '>', '2026-06-21')->delete();
    $this->clearTenantContext();

    (new RollSessionWindowJob(onlyAcademyId: $this->academy))->handle(app(SessionGenerator::class));
    expect(groupLessonDates($this, $groupId))->not->toContain('2026-07-29');
});

// ── Members & seats ──────────────────────────────────────────────────────────

it('enforces the seats unless told to go over', function () {
    $groupId = makeGroup($this, ['student_ids' => [$this->students['Adam'], $this->students['Bassel'], $this->students['Celine']]]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$groupId}/members", ['student_ids' => [$this->students['Dina']]])
        ->assertStatus(422)->assertJsonValidationErrors('student_ids');

    $this->postJson("/api/groups/{$groupId}/members", ['student_ids' => [$this->students['Dina']], 'allow_over_capacity' => true])
        ->assertCreated()->assertJsonPath('group.member_count', 4);
});

it('creates nothing when the members it was created with do not fit', function () {
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/groups', groupPayload([
        'teacher_id' => $this->teacher,
        'capacity' => 1,
        'student_ids' => [$this->students['Adam'], $this->students['Bassel']],
    ]))->assertStatus(422);

    // The 422 must not leave a half-made group (or its lessons) behind it.
    $this->asAcademy($this->academy);
    expect(DB::table('class_groups')->count())->toBe(0);
    expect(DB::table('class_group_lessons')->count())->toBe(0);
});

it('keeps the student where they were when the move is refused', function () {
    $from = makeGroup($this, ['student_ids' => [$this->students['Adam']]]);
    $to = makeGroup($this, ['name' => 'Full', 'capacity' => 1, 'student_ids' => [$this->students['Bassel']]]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$from}/members/{$this->students['Adam']}/move", ['to_group_id' => $to])->assertStatus(422);

    expect($this->getJson("/api/groups/{$from}")->json('group.member_count'))->toBe(1);
});

it('refuses the same student twice', function () {
    $groupId = makeGroup($this, ['student_ids' => [$this->students['Adam']]]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$groupId}/members", ['student_ids' => [$this->students['Adam']]])->assertStatus(422);
});

it('expects a member only on the lessons their membership covers', function () {
    $groupId = makeGroup($this, ['capacity' => null, 'student_ids' => [$this->students['Adam'], $this->students['Bassel']]]);

    Sanctum::actingAs($this->owner);
    // Celine joins on the 10th; Bassel leaves on the 15th.
    $this->postJson("/api/groups/{$groupId}/members", ['student_ids' => [$this->students['Celine']], 'joined_on' => '2026-06-10'])->assertCreated();
    $this->deleteJson("/api/groups/{$groupId}/members/{$this->students['Bassel']}", ['left_on' => '2026-06-15'])->assertOk();

    $names = fn (string $date) => collect($this->getJson('/api/group-lessons/'.lessonOn($this, $groupId, $date)->id)->assertOk()->json('roster'))
        ->pluck('full_name')->all();

    expect($names('2026-06-08'))->toBe(['Adam', 'Bassel']);
    expect($names('2026-06-10'))->toBe(['Adam', 'Bassel', 'Celine']);
    expect($names('2026-06-15'))->toBe(['Adam', 'Celine']);
});

it('keeps a sheet as it was when a member leaves afterwards', function () {
    $groupId = makeGroup($this, ['student_ids' => [$this->students['Adam'], $this->students['Bassel']]]);
    $lesson = lessonOn($this, $groupId, '2026-06-15');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$lesson->id}/attendance")->assertOk();
    $this->deleteJson("/api/groups/{$groupId}/members/{$this->students['Bassel']}", ['left_on' => '2026-06-01'])->assertOk();

    $roster = collect($this->getJson("/api/group-lessons/{$lesson->id}")->json('roster'));
    expect($roster->pluck('full_name')->all())->toBe(['Adam', 'Bassel']);
    expect($roster->firstWhere('full_name', 'Bassel')['member'])->toBeFalse();
});

it('moves a student to another group on the same day', function () {
    $from = makeGroup($this, ['student_ids' => [$this->students['Adam']]]);
    $to = makeGroup($this, ['name' => 'English A2', 'student_ids' => []]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$from}/members/{$this->students['Adam']}/move", ['to_group_id' => $to, 'on' => '2026-06-17'])->assertOk();

    expect($this->getJson("/api/groups/{$from}")->json('group.member_count'))->toBe(0);
    expect($this->getJson("/api/groups/{$to}")->json('group.member_count'))->toBe(1);
});

it('takes a removed student out of every group', function () {
    $groupId = makeGroup($this, ['student_ids' => [$this->students['Adam'], $this->students['Bassel']]]);

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/students/{$this->students['Adam']}")->assertOk();

    expect($this->getJson("/api/groups/{$groupId}")->json('group.member_count'))->toBe(1);
    $roster = collect($this->getJson('/api/group-lessons/'.lessonOn($this, $groupId, '2026-06-22')->id)->json('roster'));
    expect($roster->pluck('full_name')->all())->toBe(['Bassel']);
});

// ── The sheet ────────────────────────────────────────────────────────────────

it('marks everyone present except the exceptions, and the lesson held', function () {
    $groupId = makeGroup($this, ['student_ids' => [$this->students['Adam'], $this->students['Bassel'], $this->students['Celine']]]);
    $lesson = lessonOn($this, $groupId, '2026-06-15');

    Sanctum::actingAs($this->owner);
    $res = $this->postJson("/api/group-lessons/{$lesson->id}/attendance", [
        'entries' => [
            ['student_id' => $this->students['Bassel'], 'status' => 'ABSENT'],
            ['student_id' => $this->students['Celine'], 'status' => 'LATE', 'note' => '10 min'],
        ],
        'topic' => 'Present simple',
        'homework' => 'Workbook p. 12',
    ])->assertOk();

    expect($res->json('lesson.status'))->toBe('HELD');
    expect($res->json('lesson.topic'))->toBe('Present simple');
    expect($res->json('lesson.counts'))->toMatchArray(['present' => 1, 'late' => 1, 'absent' => 1, 'excused' => 0, 'marked' => 3, 'expected' => 3]);

    $statuses = collect($res->json('roster'))->pluck('status', 'full_name')->all();
    expect($statuses)->toBe(['Adam' => 'PRESENT', 'Bassel' => 'ABSENT', 'Celine' => 'LATE']);

    // The group page rolls it up per member.
    $members = collect($this->getJson("/api/groups/{$groupId}")->json('group.members'))->keyBy('full_name');
    expect($members['Bassel']['attendance']['absent'])->toBe(1);
    expect($members['Adam']['attendance']['rate'])->toEqual(1);
});

it('re-saving edits the sheet in place', function () {
    $groupId = makeGroup($this, ['student_ids' => [$this->students['Adam']]]);
    $lesson = lessonOn($this, $groupId, '2026-06-15');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$lesson->id}/attendance")->assertOk();
    $this->postJson("/api/group-lessons/{$lesson->id}/attendance", [
        'entries' => [['student_id' => $this->students['Adam'], 'status' => 'EXCUSED']],
    ])->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('class_group_attendance')->where('lesson_id', $lesson->id)->pluck('status')->all())->toBe(['EXCUSED']);
});

it('refuses a student who is not in the group on that date', function () {
    $groupId = makeGroup($this, ['student_ids' => [$this->students['Adam']]]);
    $lesson = lessonOn($this, $groupId, '2026-06-15');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$lesson->id}/attendance", [
        'entries' => [['student_id' => $this->students['Dina'], 'status' => 'PRESENT']],
    ])->assertStatus(422);
});

it('will not mark a lesson that has not started, unless the owner overrides it', function () {
    $groupId = makeGroup($this, ['student_ids' => [$this->students['Adam']]]);
    $future = lessonOn($this, $groupId, '2026-06-22');

    Sanctum::actingAs($this->teacherUser);
    $this->postJson("/api/group-lessons/{$future->id}/attendance", ['override_timing' => true])->assertStatus(422);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$future->id}/attendance", ['override_timing' => true])->assertOk();
});

it('cancels a lesson for the whole class, and undoes it', function () {
    $groupId = makeGroup($this, ['student_ids' => [$this->students['Adam']]]);
    $lesson = lessonOn($this, $groupId, '2026-06-22');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$lesson->id}/cancel", ['reason' => 'Public holiday'])
        ->assertOk()->assertJsonPath('lesson.status', 'CANCELLED')->assertJsonPath('lesson.cancel_reason', 'Public holiday');
    $this->postJson("/api/group-lessons/{$lesson->id}/attendance", ['override_timing' => true])->assertStatus(422);

    $this->postJson("/api/group-lessons/{$lesson->id}/attendance/revert")->assertOk()->assertJsonPath('lesson.status', 'SCHEDULED');
});

it('a moved lesson stays where it was put', function () {
    $groupId = makeGroup($this);
    $lesson = lessonOn($this, $groupId, '2026-06-22');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$lesson->id}/reschedule", ['local_datetime' => '2026-06-23 19:00'])
        ->assertOk()->assertJsonPath('lesson.moved', true);

    // A later edit to the group regenerates — and must not drag the lesson back to Monday.
    $this->patchJson("/api/groups/{$groupId}", ['name' => 'Renamed'])->assertOk();

    $moved = lessonOn($this, $groupId, '2026-06-22');
    expect(Carbon::parse($moved->scheduled_at_utc)->setTimezone('Africa/Cairo')->format('Y-m-d H:i'))->toBe('2026-06-23 19:00');
    $this->asAcademy($this->academy);
    expect(DB::table('class_group_lessons')->where('group_id', $groupId)->where('occurrence_local_date', '2026-06-22')->count())->toBe(1);
});

it('adds an extra lesson the timetable never produced', function () {
    $groupId = makeGroup($this);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$groupId}/lessons", ['local_datetime' => '2026-06-20 11:00', 'duration_minutes' => 90])
        ->assertCreated()->assertJsonPath('lesson.extra', true)->assertJsonPath('lesson.occurrence_local_date', '2026-06-20');

    // …and regeneration leaves it alone.
    $this->patchJson("/api/groups/{$groupId}", ['name' => 'Renamed'])->assertOk();
    expect(groupLessonDates($this, $groupId))->toContain('2026-06-20');
});

// ── Who sees what ────────────────────────────────────────────────────────────

it('shows a teacher only their own groups, and lets them mark their own lessons', function () {
    $mine = makeGroup($this, ['student_ids' => [$this->students['Adam']]]);
    $theirs = makeGroup($this, ['name' => 'Maths G9', 'teacher_id' => $this->other, 'student_ids' => [$this->students['Bassel']]]);

    Sanctum::actingAs($this->teacherUser);
    expect(collect($this->getJson('/api/groups')->assertOk()->json('groups'))->pluck('id')->all())->toBe([$mine]);
    $this->getJson("/api/groups/{$theirs}")->assertForbidden();
    $this->postJson('/api/group-lessons/'.lessonOn($this, $theirs, '2026-06-15')->id.'/attendance')->assertForbidden();

    $this->postJson('/api/group-lessons/'.lessonOn($this, $mine, '2026-06-15')->id.'/attendance')->assertOk();

    // Running the group is not theirs.
    $this->patchJson("/api/groups/{$mine}", ['name' => 'Mine now'])->assertForbidden();
    $this->postJson('/api/group-lessons/'.lessonOn($this, $mine, '2026-06-22')->id.'/cancel')->assertForbidden();
});

// ── The calendar ─────────────────────────────────────────────────────────────

it('puts a group lesson on the calendar once, with its member count', function () {
    $groupId = makeGroup($this, ['student_ids' => [$this->students['Adam'], $this->students['Bassel'], $this->students['Celine']]]);

    Sanctum::actingAs($this->owner);
    $res = $this->getJson('/api/calendar?from=2026-06-22&to=2026-06-22')->assertOk();

    expect($res->json('group_lessons'))->toHaveCount(1);
    expect($res->json('group_lessons.0.group_id'))->toBe($groupId);
    expect($res->json('group_lessons.0.member_count'))->toBe(3);
    // Nothing leaked into the private-lesson feed.
    expect($res->json('sessions'))->toHaveCount(0);

    // A student filter keeps the lessons of the groups that student is in.
    $this->getJson("/api/calendar?from=2026-06-22&to=2026-06-22&studentId={$this->students['Dina']}")->assertJsonCount(0, 'group_lessons');
    $this->getJson("/api/calendar?from=2026-06-22&to=2026-06-22&studentId={$this->students['Adam']}")->assertJsonCount(1, 'group_lessons');
});

it('warns about a private lesson booked over the teacher’s group lesson', function () {
    makeGroup($this);
    $this->assignTeacher($this->academy, $this->students['Dina'], $this->teacher);
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    $warnings = $this->postJson('/api/sessions', [
        'student_id' => $this->students['Dina'],
        'teacher_id' => $this->teacher,
        'local_datetime' => '2026-06-22 17:30',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertCreated()->json('warnings');

    expect(collect($warnings)->pluck('type')->all())->toContain('conflict');
});
