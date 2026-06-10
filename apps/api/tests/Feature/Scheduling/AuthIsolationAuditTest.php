<?php

declare(strict_types=1);

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

beforeEach(function () {
    Carbon::setTestNow('2026-05-15 06:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-auth@test.local']);

    // Two teachers, each with a login; the first owns the calendar we probe.
    $this->teacher1User = $this->makeUser($this->academy, 'TEACHER', ['email' => 't1-auth@test.local']);
    $this->teacher2User = $this->makeUser($this->academy, 'TEACHER', ['email' => 't2-auth@test.local']);
    $this->teacher1 = $this->createTeacher($this->academy, ['full_name' => 'Teacher One', 'user_id' => $this->teacher1User->getKey()]);
    $this->teacher2 = $this->createTeacher($this->academy, ['full_name' => 'Teacher Two', 'user_id' => $this->teacher2User->getKey()]);

    $this->student1 = $this->createStudent($this->academy);
    $this->student2 = $this->createStudent($this->academy);
    $this->assignTeacher($this->academy, $this->student1, $this->teacher1);
    $this->assignTeacher($this->academy, $this->student2, $this->teacher2);

    // A session for each teacher in June.
    $this->session1 = $this->createSession($this->academy, $this->student1, $this->teacher1, ['scheduled_at_utc' => '2026-06-09 14:00:00+00', 'status' => 'SCHEDULED']);
    $this->session2 = $this->createSession($this->academy, $this->student2, $this->teacher2, ['scheduled_at_utc' => '2026-06-10 14:00:00+00', 'status' => 'SCHEDULED']);
});

afterEach(fn () => Carbon::setTestNow());

// ── TC-5.26 / AC-5.9: a teacher sees only their own calendar ──────────────────
it('returns only the calling teacher own sessions and forbids probing another teacher', function () {
    Sanctum::actingAs($this->teacher1User);

    $sessions = $this->getJson('/api/calendar?from=2026-06-01&to=2026-06-30')->assertOk()->json('sessions');
    expect(collect($sessions)->pluck('id'))->toContain($this->session1);
    expect(collect($sessions)->pluck('id'))->not->toContain($this->session2);

    // Asking for teacher2's calendar explicitly is rejected.
    $this->getJson("/api/calendar?from=2026-06-01&to=2026-06-30&teacherId={$this->teacher2}")->assertForbidden();
});

// ── TC-5.27 / AC-5.9 / AC-5.11: owner can view any teacher; RLS blocks other academies ─
it('lets the owner view any teacher calendar but never another academy', function () {
    Sanctum::actingAs($this->owner);

    $t1 = $this->getJson("/api/calendar?from=2026-06-01&to=2026-06-30&teacherId={$this->teacher1}")->assertOk()->json('sessions');
    expect(collect($t1)->pluck('id')->all())->toBe([$this->session1]);

    $t2 = $this->getJson("/api/calendar?from=2026-06-01&to=2026-06-30&teacherId={$this->teacher2}")->assertOk()->json('sessions');
    expect(collect($t2)->pluck('id')->all())->toBe([$this->session2]);

    // A foreign academy's session is invisible (RLS), even unfiltered.
    $otherAcademy = $this->createAcademy(overrides: ['timezone' => 'Africa/Cairo']);
    $ot = $this->createTeacher($otherAcademy);
    $os = $this->createStudent($otherAcademy);
    $foreign = $this->createSession($otherAcademy, $os, $ot, ['scheduled_at_utc' => '2026-06-11 14:00:00+00']);

    Sanctum::actingAs($this->owner);
    $all = $this->getJson('/api/calendar?from=2026-06-01&to=2026-06-30')->assertOk()->json('sessions');
    expect(collect($all)->pluck('id'))->not->toContain($foreign);
});

// ── TC-5.28 / AC-5.11: every scheduling op writes an audit entry ──────────────
it('audits schedule CRUD, reschedule, cancel, and generator runs', function () {
    Sanctum::actingAs($this->owner);

    // Create schedule (→ schedule.created + generator.run).
    $this->putJson("/api/students/{$this->student1}/schedule", [
        'timezone' => 'Africa/Cairo',
        'slots' => [['weekday' => 2, 'start_time_local' => '17:00', 'duration_minutes' => 30]],
    ])->assertCreated();

    // Edit schedule (→ schedule.updated + generator.run).
    $this->putJson("/api/students/{$this->student1}/schedule", [
        'timezone' => 'Africa/Cairo',
        'slots' => [['weekday' => 4, 'start_time_local' => '17:00', 'duration_minutes' => 30]],
    ])->assertOk();

    // Reschedule + cancel an existing session.
    $this->postJson("/api/sessions/{$this->session1}/reschedule", ['scheduled_at_utc' => '2026-06-12 14:00:00+00'])->assertCreated();
    $this->postJson("/api/sessions/{$this->session2}/cancel", ['cancelled_by' => 'teacher'])->assertOk();

    // Delete schedule (→ schedule.deleted + generator.run).
    $this->putJson("/api/students/{$this->student2}/schedule", ['timezone' => 'Africa/Cairo', 'slots' => [['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 30]]])->assertCreated();
    $this->deleteJson("/api/students/{$this->student2}/schedule")->assertOk();

    $this->asAcademy($this->academy);
    $actions = DB::table('audit_log')->where('academy_id', $this->academy)->pluck('action');
    foreach (['schedule.created', 'schedule.updated', 'schedule.deleted', 'session.rescheduled', 'session.cancelled', 'generator.run'] as $action) {
        expect($actions)->toContain($action);
    }

    // generator.run records counts.
    $run = DB::table('audit_log')->where('academy_id', $this->academy)->where('action', 'generator.run')->orderByDesc('created_at')->first();
    $after = json_decode($run->after, true);
    expect($after)->toHaveKeys(['created', 'removed']);
});

// ── TC-5.28b / AC-5.11: the admin generate endpoint is idempotent + audited ───
it('runs the admin generate-sessions endpoint idempotently with an audit', function () {
    Sanctum::actingAs($this->owner);
    $this->putJson("/api/students/{$this->student1}/schedule", [
        'timezone' => 'Africa/Cairo',
        'slots' => [['weekday' => 2, 'start_time_local' => '17:00', 'duration_minutes' => 30]],
    ])->assertCreated();

    $first = $this->postJson('/api/admin/generate-sessions', ['from' => '2026-06-01', 'to' => '2026-07-31'])->assertOk()->json('generated');
    $second = $this->postJson('/api/admin/generate-sessions', ['from' => '2026-06-01', 'to' => '2026-07-31'])->assertOk()->json('generated');

    expect($second['created'])->toBe(0);
    expect($second['removed'])->toBe(0);

    $this->asAcademy($this->academy);
    expect(DB::table('audit_log')->where('action', 'generator.run')->where('entity_type', 'academy')->exists())->toBeTrue();
});

// ── TC-5.29 / AC-5.12: nothing here sets a billable status or billing guard ───
it('never sets a billable status or billing guard in this sprint', function () {
    Sanctum::actingAs($this->owner);
    $this->putJson("/api/students/{$this->student1}/schedule", [
        'timezone' => 'Africa/Cairo',
        'slots' => [['weekday' => 2, 'start_time_local' => '17:00', 'duration_minutes' => 30]],
    ])->assertCreated();

    $this->postJson("/api/sessions/{$this->session1}/reschedule", ['scheduled_at_utc' => '2026-06-12 14:00:00+00'])->assertCreated();
    $this->postJson("/api/sessions/{$this->session2}/cancel", ['cancelled_by' => 'student'])->assertOk();

    $this->asAcademy($this->academy);
    // No ATTENDED / ABSENT_* anywhere, and the guard columns are all false.
    $billable = DB::table('sessions')->where('academy_id', $this->academy)
        ->whereIn('status', ['ATTENDED', 'ABSENT_UNEXCUSED', 'ABSENT_EXCUSED'])->count();
    expect($billable)->toBe(0);
    expect(DB::table('sessions')->where('academy_id', $this->academy)->where(fn ($q) => $q->where('billed', true)->orWhere('paid_to_teacher', true))->count())->toBe(0);
});

// ── AC-5.11: a teacher cannot reschedule another teacher's session ────────────
it('forbids a teacher from rescheduling a session they do not teach', function () {
    Sanctum::actingAs($this->teacher1User);
    $this->postJson("/api/sessions/{$this->session2}/reschedule", ['scheduled_at_utc' => '2026-06-12 14:00:00+00'])->assertForbidden();
});
