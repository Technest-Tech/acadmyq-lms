<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * The CRM pipeline's two BACKED stages — the ones a card cannot simply be dragged onto:
 * TRIAL (a real booking, which is what puts it on the calendar) and SUBSCRIBED (a real student,
 * which is what puts them on the Students page) — plus the links that keep the CRM, the trials
 * page and the calendar telling the same story about one person.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-05-15 06:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'plan_id' => $proPlan,
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-crm@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Ms Noor']);
    $this->guardian = $this->createGuardian($this->academy);

    Sanctum::actingAs($this->owner);
    $this->lead = $this->postJson('/api/crm/leads', [
        'full_name' => 'Sara Ahmed',
        'whatsapp_phone' => '+201112223334',
        'source' => 'WHATSAPP',
    ])->assertCreated()->json('leadId');
});

afterEach(fn () => Carbon::setTestNow());

it('books a trial when a lead is moved into the TRIAL stage', function () {
    $res = $this->postJson("/api/crm/leads/{$this->lead}/trial", [
        'teacher_id' => $this->teacher,
        'local_datetime' => '2026-06-16 17:00',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
        'notes' => 'Wants evening slots.',
    ])->assertCreated();

    $this->asAcademy($this->academy);

    $trial = DB::table('trials')->where('id', $res->json('trialId'))->first();
    expect($trial->lead_id)->toBe($this->lead);
    expect($trial->status)->toBe('SCHEDULED');
    expect($trial->teacher_id)->toBe($this->teacher);
    // The contact snapshot travels with the trial so the teacher taking it can read it.
    expect($trial->lead_name)->toBe('Sara Ahmed');
    expect($trial->lead_whatsapp)->toBe('+201112223334');
    // No phantom student was created for someone who has not enrolled.
    expect(DB::table('students')->where('full_name', 'Sara Ahmed')->exists())->toBeFalse();

    expect(DB::table('crm_leads')->where('id', $this->lead)->value('status'))->toBe('TRIAL');

    $types = DB::table('crm_lead_activities')->where('lead_id', $this->lead)->pluck('type');
    expect($types)->toContain('TRIAL_BOOKED')->toContain('STATUS_CHANGE');
});

it('books a trial for a lead with no phone number', function () {
    $anonymous = $this->postJson('/api/crm/leads', [
        'full_name' => 'Walk-in Dad',
        'source' => 'WALK_IN',
    ])->assertCreated()->json('leadId');

    $this->postJson("/api/crm/leads/{$anonymous}/trial", [
        'teacher_id' => $this->teacher,
        'local_datetime' => '2026-06-16 18:00',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertCreated();

    $this->asAcademy($this->academy);
    expect(DB::table('trials')->where('lead_id', $anonymous)->value('lead_whatsapp'))->toBeNull();
});

it('refuses the TRIAL stage when no trial has been booked', function () {
    $this->patchJson("/api/crm/leads/{$this->lead}", ['status' => 'TRIAL'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('status');

    $this->asAcademy($this->academy);
    expect(DB::table('crm_leads')->where('id', $this->lead)->value('status'))->toBe('NEW');
});

it('refuses the SUBSCRIBED stage until the student details are in', function () {
    $this->patchJson("/api/crm/leads/{$this->lead}", ['status' => 'SUBSCRIBED'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('status');

    $this->asAcademy($this->academy);
    expect(DB::table('crm_leads')->where('id', $this->lead)->value('status'))->toBe('NEW');
});

it('subscribes the lead once the student record exists, and the trial follows them', function () {
    $trialId = $this->postJson("/api/crm/leads/{$this->lead}/trial", [
        'teacher_id' => $this->teacher,
        'local_datetime' => '2026-06-16 17:00',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertCreated()->json('trialId');

    // The student details are collected by the one form that owns them (POST /students) …
    $studentId = $this->postJson('/api/students', [
        'full_name' => 'Sara Ahmed',
        'guardian_id' => $this->guardian,
        'whatsapp_phone' => '+201112223334',
        'status' => 'REGULAR',
    ])->assertCreated()->json('studentId');

    // … and only then can the lead reach SUBSCRIBED.
    $this->postJson("/api/crm/leads/{$this->lead}/convert", ['student_id' => $studentId])->assertOk();

    $this->asAcademy($this->academy);
    $lead = DB::table('crm_leads')->where('id', $this->lead)->first();
    expect($lead->status)->toBe('SUBSCRIBED');
    expect($lead->converted_student_id)->toBe($studentId);
    // The trial they sat is now that student's history, not a ghost prospect's.
    expect(DB::table('trials')->where('id', $trialId)->value('student_id'))->toBe($studentId);
});

it('puts a booked trial on the calendar, and takes a cancelled one off', function () {
    $trialId = $this->postJson("/api/crm/leads/{$this->lead}/trial", [
        'teacher_id' => $this->teacher,
        'local_datetime' => '2026-06-16 17:00',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertCreated()->json('trialId');

    $feed = $this->getJson('/api/calendar?from=2026-06-15&to=2026-06-20')->assertOk();
    $trial = collect($feed->json('trials'))->firstWhere('id', $trialId);
    expect($trial)->not->toBeNull();
    expect($trial['display_name'])->toBe('Sara Ahmed');
    expect($trial['teacher_name'])->toBe('Ms Noor');
    // A trial is never disguised as a session — the actions that apply to a lesson do not apply.
    expect(collect($feed->json('sessions'))->pluck('id'))->not->toContain($trialId);

    $this->deleteJson("/api/trials/{$trialId}")->assertOk();

    $after = $this->getJson('/api/calendar?from=2026-06-15&to=2026-06-20')->assertOk();
    expect(collect($after->json('trials'))->pluck('id'))->not->toContain($trialId);
});

it('reports a trial outcome back onto the lead timeline', function () {
    $trialId = $this->postJson("/api/crm/leads/{$this->lead}/trial", [
        'teacher_id' => $this->teacher,
        'local_datetime' => '2026-06-16 17:00',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertCreated()->json('trialId');

    $this->patchJson("/api/trials/{$trialId}", [
        'status' => 'NO_SHOW',
        'outcome_notes' => 'Never arrived.',
    ])->assertOk();

    $timeline = $this->getJson("/api/crm/leads/{$this->lead}")->assertOk()->json('activities');
    $outcome = collect($timeline)->firstWhere('type', 'TRIAL_OUTCOME');
    expect($outcome)->not->toBeNull();
    expect($outcome['meta']['status'])->toBe('NO_SHOW');
});

it('subscribes the lead when the conversion is done from the trials page', function () {
    $trialId = $this->postJson("/api/crm/leads/{$this->lead}/trial", [
        'teacher_id' => $this->teacher,
        'local_datetime' => '2026-06-16 17:00',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertCreated()->json('trialId');

    $studentId = $this->postJson('/api/students', [
        'full_name' => 'Sara Ahmed',
        'guardian_id' => $this->guardian,
        'status' => 'REGULAR',
    ])->assertCreated()->json('studentId');

    $this->patchJson("/api/trials/{$trialId}", ['status' => 'COMPLETED'])->assertOk();
    $this->postJson("/api/trials/{$trialId}/convert", ['student_id' => $studentId])->assertOk();

    $this->asAcademy($this->academy);
    $lead = DB::table('crm_leads')->where('id', $this->lead)->first();
    expect($lead->status)->toBe('SUBSCRIBED');
    expect($lead->converted_student_id)->toBe($studentId);
});

it('shows the lead its current trial on the board', function () {
    $this->postJson("/api/crm/leads/{$this->lead}/trial", [
        'teacher_id' => $this->teacher,
        'local_datetime' => '2026-06-16 17:00',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 45,
    ])->assertCreated();

    $board = $this->getJson('/api/crm/leads/board')->assertOk()->json();
    $card = collect($board['columns']['TRIAL'])->firstWhere('id', $this->lead);

    expect($card)->not->toBeNull();
    expect($card['trial_teacher_name'])->toBe('Ms Noor');
    expect($card['trial_status'])->toBe('SCHEDULED');
    expect($card['trial_duration_minutes'])->toBe(45);
    expect($board['counts']['TRIAL'])->toBe(1);

    // The list view carries the same trial, so both views read the same lead.
    $list = $this->getJson('/api/crm/leads')->assertOk()->json('rows');
    $row = collect($list)->firstWhere('id', $this->lead);
    expect($row['trial_teacher_name'])->toBe('Ms Noor');
    expect($row['trial_scheduled_at_utc'])->not->toBeNull();

    $summary = $this->getJson('/api/crm/leads/summary')->assertOk()->json();
    expect($summary['trial'])->toBe(1);
    // A lead sitting in a trial is still very much being worked.
    expect($summary['open'])->toBe(1);
});

it('offers the trial form a teacher roster without the teacher surface', function () {
    $res = $this->getJson('/api/crm/teachers')->assertOk();

    expect(collect($res->json('teachers'))->pluck('id'))->toContain($this->teacher);
    expect($res->json('timezone'))->toBe('Africa/Cairo');
    expect($res->json('durations'))->toContain(30);
});

it('forbids a teacher from reaching the CRM', function () {
    $teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-crm@test.local']);
    Sanctum::actingAs($teacherUser);

    $this->getJson('/api/crm/leads/board')->assertForbidden();
    $this->postJson("/api/crm/leads/{$this->lead}/trial", [
        'teacher_id' => $this->teacher,
        'local_datetime' => '2026-06-16 17:00',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertForbidden();
});
