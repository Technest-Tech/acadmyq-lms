<?php

declare(strict_types=1);

use App\Services\CourseTerm;
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
 * A group as a course term (docs/centre-profile, Phase 2 §2). Pinned here:
 *   - the payload says how far the term has run and when it is "ending soon" — by date or by lessons;
 *   - renewing copies the course into a new term (times, seats, level, members on the new start) and
 *     archives the old one RENEWED; promoting writes each student's level history through the seam
 *     and leaves the rest behind; closing archives CLOSED and lets the queue go;
 *   - the waiting list seats through the members path (so a full group refuses), never by itself;
 *   - all of it is a centre's: a Quran academy gets 402 and its group payload only gains nullable keys.
 */
beforeEach(function () {
    // Wednesday 17 June 2026, 12:00 Cairo.
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-term@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 't-term@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona', 'user_id' => $this->teacherUser->getKey()]);
    $this->guardian = $this->createGuardian($this->academy);
    $this->students = [];
    foreach (['Adam', 'Bassel', 'Celine', 'Dina'] as $name) {
        $this->students[$name] = $this->createStudent($this->academy, $this->guardian, ['full_name' => $name, 'status' => 'REGULAR']);
    }
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

function ctInContext(string $academyId, callable $fn): mixed
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

function ctCentreOn(string $academyId): void
{
    ctInContext($academyId, fn () => DB::table('module_subscriptions')
        ->where('academy_id', $academyId)->where('module', 'MANAGEMENT')
        ->update(['overrides' => json_encode(['enabled' => ['centre']])]));
}

/** Mondays and Wednesdays at 17:00 Cairo, from 1 June. */
function ctGroup($test, array $over = []): string
{
    Sanctum::actingAs($test->owner);

    return $test->postJson('/api/groups', array_merge([
        'name' => 'English A1 — evening', 'teacher_id' => $test->teacher, 'start_date' => '2026-06-01', 'capacity' => 4,
        'location' => 'Room 2', 'mode' => 'OFFLINE',
        'slots' => [
            ['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60],
            ['weekday' => 3, 'start_time_local' => '17:00', 'duration_minutes' => 60],
        ],
    ], $over))->assertCreated()->json('group.id');
}

function ctLevel($test, string $name, int $order): string
{
    Sanctum::actingAs($test->owner);

    return $test->postJson('/api/levels', ['name' => $name, 'sort_order' => $order])->assertCreated()->json('levelId');
}

/** Mark the group's first `$n` past lessons HELD, straight in the table. */
function ctHold($test, string $groupId, int $n): void
{
    ctInContext($test->academy, function () use ($groupId, $n) {
        $ids = DB::table('class_group_lessons')->where('group_id', $groupId)
            ->where('occurrence_local_date', '<', '2026-06-17')->orderBy('occurrence_local_date')->limit($n)->pluck('id');
        DB::table('class_group_lessons')->whereIn('id', $ids)->update(['status' => 'HELD', 'outcome_set_at' => now()]);
    });
}

function ctMembers($test, string $groupId): array
{
    return ctInContext($test->academy, fn () => DB::table('class_group_members as m')
        ->join('students as st', 'st.id', '=', 'm.student_id')
        ->where('m.group_id', $groupId)->orderBy('st.full_name')
        ->get(['st.full_name', 'm.status', 'm.joined_on', 'm.left_on', 'm.left_reason'])
        ->map(fn ($m) => [
            'name' => $m->full_name, 'status' => $m->status,
            'joined_on' => Carbon::parse($m->joined_on)->format('Y-m-d'),
            'left_on' => $m->left_on !== null ? Carbon::parse($m->left_on)->format('Y-m-d') : null,
            'left_reason' => $m->left_reason,
        ])->all());
}

// ── The switch ───────────────────────────────────────────────────────────────

it('answers 402 on every term and waiting-list route for an academy without the centre switch', function () {
    $groupId = ctGroup($this);
    $entry = (string) Str::uuid();

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$groupId}/renew", ['start_date' => '2026-07-01'])->assertStatus(402);
    $this->postJson("/api/groups/{$groupId}/promote", ['start_date' => '2026-07-01', 'member_ids' => []])->assertStatus(402);
    $this->postJson("/api/groups/{$groupId}/close")->assertStatus(402);
    $this->getJson("/api/groups/{$groupId}/waitlist")->assertStatus(402);
    $this->postJson("/api/groups/{$groupId}/waitlist", ['name' => 'Walk-in'])->assertStatus(402);
    $this->patchJson("/api/groups/{$groupId}/waitlist/reorder", ['ids' => [$entry]])->assertStatus(402);
    $this->deleteJson("/api/groups/{$groupId}/waitlist/{$entry}")->assertStatus(402);
    $this->postJson("/api/groups/{$groupId}/waitlist/{$entry}/seat")->assertStatus(402);
});

it('only adds nullable keys to a Quran academy\'s group payload, and its list stays whole', function () {
    $groupId = ctGroup($this, ['student_ids' => [$this->students['Adam']]]);

    Sanctum::actingAs($this->owner);
    $group = $this->getJson("/api/groups/{$groupId}")->assertOk()->json('group');
    expect($group['lessons_planned'])->toBeNull()
        ->and($group['lessons_held'])->toBe(0)
        ->and($group['lessons_remaining'])->toBeNull()
        ->and($group['ends_in_days'])->toBeNull()
        ->and($group['ending_soon'])->toBeFalse()
        ->and($group['waiting_count'])->toBe(0)
        ->and($group['continues_group_id'])->toBeNull()
        ->and($group['continues_group_name'])->toBeNull()
        ->and($group['closed_reason'])->toBeNull()
        // The keys it always had are still there, unchanged.
        ->and($group['member_count'])->toBe(1)
        ->and($group['state'])->toBe('RUNNING')
        ->and($group['lessons']['held'])->toBe(0);

    $rows = $this->getJson('/api/groups')->assertOk()->json('groups');
    expect($rows)->toHaveCount(1)->and($rows[0]['ending_soon'])->toBeFalse();
    // The filter is honoured even here: data-driven, and nothing is ending.
    expect($this->getJson('/api/groups?ending_soon=1')->assertOk()->json('groups'))->toBe([]);
});

// ── The payload ──────────────────────────────────────────────────────────────

it('counts the term\'s progress and says when it is ending soon, by lessons or by date', function () {
    ctCentreOn($this->academy);

    // 5 past lessons (1, 3, 8, 10, 15 June); 6 planned, 4 held ⇒ 2 left ⇒ ending soon.
    $byLessons = ctGroup($this, ['name' => 'By lessons', 'lessons_planned' => 6]);
    ctHold($this, $byLessons, 4);
    // Ends in 8 days.
    $byDate = ctGroup($this, ['name' => 'By date', 'end_date' => '2026-06-25']);
    // Ends in 33 days, 20 planned: not soon.
    $later = ctGroup($this, ['name' => 'Later', 'end_date' => '2026-07-20', 'lessons_planned' => 20]);
    // Already finished: ended, not ending.
    $finished = ctGroup($this, ['name' => 'Finished', 'end_date' => '2026-06-10']);
    // Not started: one day long, but not running.
    $upcoming = ctGroup($this, ['name' => 'Upcoming', 'start_date' => '2026-06-20', 'end_date' => '2026-06-22']);

    Sanctum::actingAs($this->owner);
    $g = $this->getJson("/api/groups/{$byLessons}")->assertOk()->json('group');
    expect($g['lessons_planned'])->toBe(6)->and($g['lessons_held'])->toBe(4)->and($g['lessons_remaining'])->toBe(2)
        ->and($g['ends_in_days'])->toBeNull()->and($g['ending_soon'])->toBeTrue();

    $g = $this->getJson("/api/groups/{$byDate}")->assertOk()->json('group');
    expect($g['ends_in_days'])->toBe(8)->and($g['lessons_remaining'])->toBeNull()->and($g['ending_soon'])->toBeTrue();

    $g = $this->getJson("/api/groups/{$later}")->assertOk()->json('group');
    expect($g['ends_in_days'])->toBe(33)->and($g['lessons_remaining'])->toBe(20)->and($g['ending_soon'])->toBeFalse();

    $g = $this->getJson("/api/groups/{$finished}")->assertOk()->json('group');
    expect($g['state'])->toBe('FINISHED')->and($g['ends_in_days'])->toBe(-7)->and($g['ending_soon'])->toBeFalse();

    $g = $this->getJson("/api/groups/{$upcoming}")->assertOk()->json('group');
    expect($g['state'])->toBe('UPCOMING')->and($g['ending_soon'])->toBeFalse();

    $soon = collect($this->getJson('/api/groups?ending_soon=1')->assertOk()->json('groups'))->pluck('name')->sort()->values()->all();
    expect($soon)->toBe(['By date', 'By lessons']);

    // The plan is editable like any other detail, and lifts the signal.
    $this->patchJson("/api/groups/{$byLessons}", ['lessons_planned' => 12])->assertOk()
        ->assertJsonPath('group.lessons_remaining', 8)
        ->assertJsonPath('group.ending_soon', false);
    $this->postJson('/api/groups', ['name' => 'Bad', 'teacher_id' => $this->teacher, 'start_date' => '2026-06-01', 'lessons_planned' => 0,
        'slots' => [['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60]]])->assertStatus(422);

    // The dashboard counts by the same rule: one left now that the plan was lifted.
    $this->getJson('/api/dashboard/centre')->assertOk()
        ->assertJsonPath('groups.ending_soon', 1)
        ->assertJsonPath('groups.waiting', 0);
});

// ── Renew ────────────────────────────────────────────────────────────────────

it('renews a finished term into a new one — same course, members on the new start, old one archived RENEWED', function () {
    ctCentreOn($this->academy);
    $a1 = ctLevel($this, 'A1', 1);
    $old = ctGroup($this, [
        'end_date' => '2026-06-15', 'lessons_planned' => 5, 'level_id' => $a1, 'notes' => 'Front room',
        'student_ids' => [$this->students['Adam'], $this->students['Bassel'], $this->students['Celine']],
    ]);
    ctHold($this, $old, 5);
    Sanctum::actingAs($this->owner);
    $this->getJson("/api/groups/{$old}")->assertOk()->assertJsonPath('group.state', 'FINISHED');
    // A name waiting at the door follows the course into its new term.
    $this->postJson("/api/groups/{$old}/waitlist", ['student_id' => $this->students['Dina']])->assertCreated();

    $res = $this->postJson("/api/groups/{$old}/renew", [
        'start_date' => '2026-06-22', 'end_date' => '2026-07-22', 'lessons_planned' => 9,
        'keep_members' => false, 'member_ids' => [$this->students['Adam'], $this->students['Bassel']],
    ])->assertCreated();
    $new = $res->json('group');
    expect($res->json('previous_group_id'))->toBe($old)
        ->and($new['id'])->not->toBe($old)
        ->and($new['name'])->toBe('English A1 — evening')
        ->and($new['level_id'])->toBe($a1)->and($new['level'])->toBe('A1')
        ->and($new['teacher_id'])->toBe($this->teacher)
        ->and($new['capacity'])->toBe(4)->and($new['location'])->toBe('Room 2')->and($new['mode'])->toBe('OFFLINE')
        ->and($new['slots'])->toBe([
            ['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60],
            ['weekday' => 3, 'start_time_local' => '17:00', 'duration_minutes' => 60],
        ])
        ->and($new['start_date'])->toBe('2026-06-22')->and($new['end_date'])->toBe('2026-07-22')
        ->and($new['lessons_planned'])->toBe(9)->and($new['lessons_held'])->toBe(0)->and($new['lessons_remaining'])->toBe(9)
        ->and($new['state'])->toBe('UPCOMING')
        ->and($new['continues_group_id'])->toBe($old)
        ->and($new['continues_group_name'])->toBe('English A1 — evening')
        ->and($new['member_count'])->toBe(2)
        ->and($new['waiting_count'])->toBe(1)
        ->and($new['notes'])->toBe('Front room');

    // Its lessons exist, Mondays and Wednesdays from 22 June to 22 July.
    $dates = ctInContext($this->academy, fn () => DB::table('class_group_lessons')->where('group_id', $new['id'])
        ->orderBy('occurrence_local_date')->pluck('occurrence_local_date')->map(fn ($d) => Carbon::parse($d)->format('Y-m-d'))->all());
    expect($dates)->toBe(['2026-06-22', '2026-06-24', '2026-06-29', '2026-07-01', '2026-07-06', '2026-07-08', '2026-07-13', '2026-07-15', '2026-07-20', '2026-07-22']);

    // New members joined on the new start; everyone left the old term on the day it ended.
    expect(ctMembers($this, $new['id']))->toBe([
        ['name' => 'Adam', 'status' => 'ACTIVE', 'joined_on' => '2026-06-22', 'left_on' => null, 'left_reason' => null],
        ['name' => 'Bassel', 'status' => 'ACTIVE', 'joined_on' => '2026-06-22', 'left_on' => null, 'left_reason' => null],
    ]);
    expect(collect(ctMembers($this, $old))->map(fn ($m) => [$m['status'], $m['left_on']])->all())
        ->toBe([['LEFT', '2026-06-15'], ['LEFT', '2026-06-15'], ['LEFT', '2026-06-15']]);

    $oldPayload = $this->getJson("/api/groups/{$old}")->assertOk()->json('group');
    expect($oldPayload['status'])->toBe('ARCHIVED')->and($oldPayload['closed_reason'])->toBe('RENEWED')
        ->and($oldPayload['waiting_count'])->toBe(0)
        ->and($oldPayload['lessons']['held'])->toBe(5); // history stays

    expect($this->getJson("/api/groups/{$new['id']}/waitlist")->assertOk()->json('entries.0.name'))->toBe('Dina');

    // Once archived, it cannot be renewed again.
    $this->postJson("/api/groups/{$old}/renew", ['start_date' => '2026-08-01', 'keep_members' => true])->assertStatus(422);
});

it('renews a running term with every member by default-dates, and refuses a stranger or an upcoming one', function () {
    ctCentreOn($this->academy);
    $old = ctGroup($this, ['end_date' => '2026-06-30', 'student_ids' => [$this->students['Adam'], $this->students['Bassel']]]);
    $upcoming = ctGroup($this, ['name' => 'Not yet', 'start_date' => '2026-07-01']);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$upcoming}/renew", ['start_date' => '2026-08-01', 'keep_members' => true])->assertStatus(422);
    $this->postJson("/api/groups/{$old}/renew", ['start_date' => '2026-07-01', 'member_ids' => [$this->students['Dina']]])
        ->assertStatus(422)->assertJsonValidationErrors(['member_ids']);
    $this->postJson("/api/groups/{$old}/renew", ['start_date' => '2026-07-01', 'end_date' => '2026-06-01', 'keep_members' => true])
        ->assertStatus(422)->assertJsonValidationErrors(['end_date']);
    // Nothing half-done behind the refusals.
    expect(ctInContext($this->academy, fn () => DB::table('class_groups')->count()))->toBe(2);

    $new = $this->postJson("/api/groups/{$old}/renew", ['start_date' => '2026-07-01', 'keep_members' => true, 'name' => 'English A1 — July'])
        ->assertCreated()->json('group');
    expect($new['name'])->toBe('English A1 — July')->and($new['member_count'])->toBe(2)->and($new['end_date'])->toBeNull();
    // A running term archived today has its members leave today, not on an end date still ahead.
    expect(collect(ctMembers($this, $old))->pluck('left_on')->unique()->all())->toBe(['2026-06-17']);
});

// ── Promote ──────────────────────────────────────────────────────────────────

it('promotes the chosen students to the next level in a new term, through the level seam, and leaves the rest', function () {
    ctCentreOn($this->academy);
    $a1 = ctLevel($this, 'A1', 1);
    $a2 = ctLevel($this, 'A2', 2);
    $old = ctGroup($this, ['level_id' => $a1, 'end_date' => '2026-06-15', 'student_ids' => [$this->students['Adam'], $this->students['Bassel'], $this->students['Celine']]]);
    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/students/{$this->students['Adam']}", ['level_id' => $a1])->assertOk();
    $this->postJson("/api/groups/{$old}/waitlist", ['name' => 'Walk-in', 'phone' => '0100 000 0000'])->assertCreated();

    $res = $this->postJson("/api/groups/{$old}/promote", [
        'start_date' => '2026-06-22', 'end_date' => '2026-08-22', 'lessons_planned' => 16,
        'member_ids' => [$this->students['Adam'], $this->students['Bassel']],
    ])->assertCreated();
    $new = $res->json('group');
    expect($res->json('to_level_id'))->toBe($a2)
        ->and($res->json('promoted'))->toBe([$this->students['Adam'], $this->students['Bassel']])
        ->and($res->json('not_promoted'))->toBe([['student_id' => $this->students['Celine'], 'full_name' => 'Celine']])
        ->and($new['level_id'])->toBe($a2)->and($new['level'])->toBe('A2')
        ->and($new['continues_group_id'])->toBe($old)
        ->and($new['lessons_planned'])->toBe(16)
        ->and($new['member_count'])->toBe(2)
        ->and($new['waiting_count'])->toBe(0);

    // Each promoted student: level A2, one history line from the old group to the new, dated the new start.
    foreach (['Adam', 'Bassel'] as $name) {
        $id = $this->students[$name];
        $this->getJson("/api/students/{$id}")->assertOk()->assertJsonPath('student.level_id', $a2);
        $history = $this->getJson("/api/students/{$id}/level-history")->assertOk()->json('history');
        expect($history)->toHaveCount(1)
            ->and($history[0]['to_level_name'])->toBe('A2')
            ->and($history[0]['from_group_id'])->toBe($old)
            ->and($history[0]['to_group_id'])->toBe($new['id'])
            ->and($history[0]['effective_on'])->toBe('2026-06-22');
    }
    expect($this->getJson("/api/students/{$this->students['Adam']}/level-history")->json('history.0.from_level_name'))->toBe('A1');

    // Celine left the old term, kept her (missing) level, and wrote no history.
    $this->getJson("/api/students/{$this->students['Celine']}")->assertOk()->assertJsonPath('student.level_id', null);
    expect($this->getJson("/api/students/{$this->students['Celine']}/level-history")->json('history'))->toBe([]);
    expect(collect(ctMembers($this, $old))->map(fn ($m) => [$m['name'], $m['status'], $m['left_on']])->all())->toBe([
        ['Adam', 'LEFT', '2026-06-15'], ['Bassel', 'LEFT', '2026-06-15'], ['Celine', 'LEFT', '2026-06-15'],
    ]);
    expect(collect(ctMembers($this, $new['id']))->map(fn ($m) => [$m['name'], $m['joined_on']])->all())
        ->toBe([['Adam', '2026-06-22'], ['Bassel', '2026-06-22']]);

    $oldPayload = $this->getJson("/api/groups/{$old}")->assertOk()->json('group');
    expect($oldPayload['status'])->toBe('ARCHIVED')->and($oldPayload['closed_reason'])->toBe('PROMOTED');
    // The old level's queue was let go, not carried to a level those names never asked for.
    expect(ctInContext($this->academy, fn () => DB::table('class_group_waitlist')->pluck('status')->all()))->toBe(['REMOVED']);
});

it('needs a level to promote to — the group\'s next one by default, or a named one — and refuses whole', function () {
    ctCentreOn($this->academy);
    $a1 = ctLevel($this, 'A1', 1);
    $noLevel = ctGroup($this, ['name' => 'Unlevelled', 'student_ids' => [$this->students['Adam']]]);
    $last = ctGroup($this, ['name' => 'Top', 'level_id' => $a1, 'student_ids' => [$this->students['Bassel']]]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$noLevel}/promote", ['start_date' => '2026-07-01', 'member_ids' => [$this->students['Adam']]])
        ->assertStatus(422)->assertJsonValidationErrors(['to_level_id']);
    // A1 is the last level: no "next" one.
    $this->postJson("/api/groups/{$last}/promote", ['start_date' => '2026-07-01', 'member_ids' => [$this->students['Bassel']]])
        ->assertStatus(422)->assertJsonValidationErrors(['to_level_id']);
    $this->postJson("/api/groups/{$last}/promote", ['start_date' => '2026-07-01', 'member_ids' => [$this->students['Bassel']], 'to_level_id' => (string) Str::uuid()])
        ->assertStatus(422)->assertJsonValidationErrors(['to_level_id']);

    // Nothing moved: both groups still active with their members, no history, no successor.
    expect(ctInContext($this->academy, fn () => DB::table('class_groups')->where('status', 'ACTIVE')->count()))->toBe(2);
    expect(ctInContext($this->academy, fn () => DB::table('student_level_history')->count()))->toBe(0);

    // Named explicitly, the same level works even as the "top".
    $b1 = ctLevel($this, 'B1', 2);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$noLevel}/promote", ['start_date' => '2026-07-01', 'member_ids' => [$this->students['Adam']], 'to_level_id' => $b1])
        ->assertCreated()->assertJsonPath('group.level', 'B1')->assertJsonPath('to_level_id', $b1);
    $this->getJson("/api/students/{$this->students['Adam']}")->assertOk()->assertJsonPath('student.level_id', $b1);
});

// ── Close ────────────────────────────────────────────────────────────────────

it('closes a term: everyone leaves, the queue is let go, the group is archived CLOSED', function () {
    ctCentreOn($this->academy);
    $groupId = ctGroup($this, ['end_date' => '2026-06-30', 'student_ids' => [$this->students['Adam'], $this->students['Bassel']]]);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$groupId}/waitlist", ['student_id' => $this->students['Celine']])->assertCreated();

    $this->postJson("/api/groups/{$groupId}/close", ['reason' => 'Teacher moved abroad'])->assertOk()
        ->assertJsonPath('group.status', 'ARCHIVED')
        ->assertJsonPath('group.closed_reason', 'CLOSED')
        ->assertJsonPath('group.member_count', 0)
        ->assertJsonPath('group.waiting_count', 0);

    expect(collect(ctMembers($this, $groupId))->map(fn ($m) => [$m['status'], $m['left_on'], $m['left_reason']])->all())
        ->toBe([['LEFT', '2026-06-17', 'Course closed'], ['LEFT', '2026-06-17', 'Course closed']]);
    expect(ctInContext($this->academy, fn () => DB::table('class_group_waitlist')->value('status')))->toBe('REMOVED');

    // Twice is a refusal, not a silent no-op; and the audit trail has the reason.
    $this->postJson("/api/groups/{$groupId}/close")->assertStatus(422);
    $audit = ctInContext($this->academy, fn () => DB::table('audit_log')->where('action', 'class_group.closed')->where('entity_id', $groupId)->first());
    expect($audit)->not->toBeNull()->and(json_decode((string) $audit->after, true)['reason'])->toBe('Teacher moved abroad');
});

// ── Waiting list ─────────────────────────────────────────────────────────────

it('keeps a queue for a full group and seats through the members path, which refuses while it is full', function () {
    ctCentreOn($this->academy);
    $groupId = ctGroup($this, ['capacity' => 2, 'student_ids' => [$this->students['Adam'], $this->students['Bassel']]]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$groupId}/waitlist", ['student_id' => $this->students['Celine'], 'note' => 'Called twice'])
        ->assertCreated()->assertJsonPath('waiting_count', 1)->assertJsonPath('free_seats', 0);
    $this->postJson("/api/groups/{$groupId}/waitlist", ['name' => '  Yusuf (walk-in) ', 'phone' => '0100 123 4567'])->assertCreated();
    // Duplicates and members are refused; nobody is refused for lack of a name.
    $this->postJson("/api/groups/{$groupId}/waitlist", ['student_id' => $this->students['Celine']])->assertStatus(422)->assertJsonValidationErrors(['student_id']);
    $this->postJson("/api/groups/{$groupId}/waitlist", ['student_id' => $this->students['Adam']])->assertStatus(422)->assertJsonValidationErrors(['student_id']);
    $this->postJson("/api/groups/{$groupId}/waitlist", ['note' => 'who?'])->assertStatus(422);

    $list = $this->getJson("/api/groups/{$groupId}/waitlist")->assertOk()->json();
    expect($list['waiting_count'])->toBe(2)->and($list['member_count'])->toBe(2)->and($list['capacity'])->toBe(2)->and($list['free_seats'])->toBe(0)
        ->and($list['entries'][0]['position'])->toBe(1)->and($list['entries'][0]['name'])->toBe('Celine')->and($list['entries'][0]['student_id'])->toBe($this->students['Celine'])
        ->and($list['entries'][0]['note'])->toBe('Called twice')
        ->and($list['entries'][1]['position'])->toBe(2)->and($list['entries'][1]['name'])->toBe('Yusuf (walk-in)')->and($list['entries'][1]['phone'])->toBe('0100 123 4567')
        ->and($list['entries'][1]['student_id'])->toBeNull();
    [$celine, $yusuf] = [$list['entries'][0]['id'], $list['entries'][1]['id']];

    // The group payload says who is waiting.
    $this->getJson("/api/groups/{$groupId}")->assertOk()->assertJsonPath('group.waiting_count', 2);
    $this->getJson('/api/dashboard/centre')->assertOk()->assertJsonPath('groups.waiting', 2);

    // Full: seating is refused by the same rule the members tab uses, and the entry stays WAITING.
    $this->postJson("/api/groups/{$groupId}/waitlist/{$celine}/seat")->assertStatus(422)->assertJsonValidationErrors(['student_ids']);
    $this->getJson("/api/groups/{$groupId}/waitlist")->assertOk()->assertJsonPath('waiting_count', 2);

    // A seat opens — nothing happens by itself; the page offers the next name and the desk seats it.
    $this->deleteJson("/api/groups/{$groupId}/members/{$this->students['Bassel']}", ['left_on' => '2026-06-17'])->assertOk()
        ->assertJsonPath('group.member_count', 1)->assertJsonPath('group.waiting_count', 2);
    $res = $this->postJson("/api/groups/{$groupId}/waitlist/{$celine}/seat", ['joined_on' => '2026-06-22'])->assertOk();
    expect($res->json('waiting_count'))->toBe(1)->and($res->json('group.member_count'))->toBe(2)
        ->and($res->json('entries.0.id'))->toBe($yusuf)->and($res->json('entries.0.position'))->toBe(1);
    expect(collect(ctMembers($this, $groupId))->firstWhere('name', 'Celine'))->toBe(['name' => 'Celine', 'status' => 'ACTIVE', 'joined_on' => '2026-06-22', 'left_on' => null, 'left_reason' => null]);

    // A walk-in has no student row to seat.
    $this->deleteJson("/api/groups/{$groupId}/members/{$this->students['Adam']}")->assertOk();
    $this->postJson("/api/groups/{$groupId}/waitlist/{$yusuf}/seat")->assertStatus(422)->assertJsonValidationErrors(['student_id']);

    // Reorder takes the whole queue; remove closes the gap.
    $this->postJson("/api/groups/{$groupId}/waitlist", ['student_id' => $this->students['Dina']])->assertCreated();
    $ids = collect($this->getJson("/api/groups/{$groupId}/waitlist")->json('entries'))->pluck('id')->all();
    $this->patchJson("/api/groups/{$groupId}/waitlist/reorder", ['ids' => [$ids[0]]])->assertStatus(422);
    $this->patchJson("/api/groups/{$groupId}/waitlist/reorder", ['ids' => array_reverse($ids)])->assertOk()
        ->assertJsonPath('entries.0.name', 'Dina')->assertJsonPath('entries.0.position', 1)
        ->assertJsonPath('entries.1.name', 'Yusuf (walk-in)')->assertJsonPath('entries.1.position', 2);
    $this->deleteJson("/api/groups/{$groupId}/waitlist/{$ids[1]}")->assertOk()
        ->assertJsonPath('waiting_count', 1)->assertJsonPath('entries.0.name', 'Yusuf (walk-in)')->assertJsonPath('entries.0.position', 1);
    $this->deleteJson("/api/groups/{$groupId}/waitlist/{$ids[1]}")->assertNotFound();

    $statuses = ctInContext($this->academy, fn () => DB::table('class_group_waitlist')->pluck('status', 'id')->all());
    expect($statuses[$celine])->toBe('SEATED')->and($statuses[$yusuf])->toBe('WAITING')->and($statuses[$ids[1]])->toBe('REMOVED');
});

it('scopes a teacher to their own group\'s queue and keeps the writes to group.manage', function () {
    ctCentreOn($this->academy);
    $mine = ctGroup($this, ['name' => 'Mine']);
    $otherTeacher = $this->createTeacher($this->academy, ['full_name' => 'Mr Karim']);
    $this->clearTenantContext();
    $theirs = ctGroup($this, ['name' => 'Theirs', 'teacher_id' => $otherTeacher]);

    Sanctum::actingAs($this->teacherUser);
    $this->getJson("/api/groups/{$mine}/waitlist")->assertOk()->assertJsonPath('waiting_count', 0);
    $this->getJson("/api/groups/{$theirs}/waitlist")->assertForbidden();
    $this->postJson("/api/groups/{$mine}/waitlist", ['name' => 'X'])->assertForbidden();
    $this->postJson("/api/groups/{$mine}/close")->assertForbidden();
});

it('exposes the ending-soon rule as one function the dashboard and the payload share', function () {
    expect(CourseTerm::isEndingSoon('RUNNING', 14, null))->toBeTrue()
        ->and(CourseTerm::isEndingSoon('RUNNING', 15, null))->toBeFalse()
        ->and(CourseTerm::isEndingSoon('RUNNING', null, 2))->toBeTrue()
        ->and(CourseTerm::isEndingSoon('RUNNING', null, 3))->toBeFalse()
        ->and(CourseTerm::isEndingSoon('RUNNING', -1, null))->toBeFalse()
        ->and(CourseTerm::isEndingSoon('FINISHED', 0, 0))->toBeFalse()
        ->and(CourseTerm::isEndingSoon('UPCOMING', 3, 1))->toBeFalse()
        ->and(CourseTerm::isEndingSoon('ARCHIVED', 3, 1))->toBeFalse();
});
