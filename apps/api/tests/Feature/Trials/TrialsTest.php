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
    // The Trials module is plan-gated (entitled:trials — a FREE/PRO feature); put the academy on
    // PRO so the capability layer admits these requests and the RBAC layer is what's exercised.
    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'plan_id' => $proPlan]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-trial@test.local']);
    // Available Tuesdays 16:00–19:00 only (weekday 2).
    $this->teacher = $this->createTeacher($this->academy, [
        'full_name' => 'Trial Teacher',
        'availability' => json_encode([['weekday' => 2, 'start_local' => '16:00', 'end_local' => '19:00']]),
    ]);
    $this->student = $this->createStudent($this->academy);
});

afterEach(fn () => Carbon::setTestNow());

// 2026-06-16 is a Tuesday; 17:00 Cairo sits inside the 16:00–19:00 window.

it('lists an available teacher for a slot inside their window, conflict-free', function () {
    Sanctum::actingAs($this->owner);

    $res = $this->getJson('/api/trials/availability?date=2026-06-16&time=17:00&duration_minutes=30')
        ->assertOk();

    $teacher = collect($res->json('teachers'))->firstWhere('id', $this->teacher);
    expect($teacher)->not->toBeNull();
    expect($teacher['available'])->toBeTrue();
    expect($teacher['has_conflict'])->toBeFalse();
});

it('excludes a teacher when the slot is outside their declared availability', function () {
    Sanctum::actingAs($this->owner);

    // 2026-06-18 is a Thursday — the teacher only declares Tuesday availability.
    $res = $this->getJson('/api/trials/availability?date=2026-06-18&time=17:00&duration_minutes=30')
        ->assertOk();

    expect(collect($res->json('teachers'))->pluck('id'))->not->toContain($this->teacher);
});

it('flags a conflict when the teacher already has a trial at that time', function () {
    Sanctum::actingAs($this->owner);

    // Book a trial in the window first.
    $this->postJson('/api/trials', [
        'teacher_id' => $this->teacher,
        'lead_name' => 'First Lead',
        'lead_whatsapp' => '+201234567890',
        'local_datetime' => '2026-06-16 17:00',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertCreated();

    $res = $this->getJson('/api/trials/availability?date=2026-06-16&time=17:00&duration_minutes=30')
        ->assertOk();

    $teacher = collect($res->json('teachers'))->firstWhere('id', $this->teacher);
    expect($teacher['has_conflict'])->toBeTrue();
});

it('returns a weekly availability grid with the teacher in their window', function () {
    Sanctum::actingAs($this->owner);

    // Week of Sun 2026-06-14 → Sat 2026-06-20; the teacher is free Tue 16:00–19:00.
    $res = $this->getJson('/api/trials/availability-grid?week_start=2026-06-14&duration_minutes=30')
        ->assertOk();

    expect($res->json('times'))->toContain('16:00');
    $cell = collect($res->json('cells.2026-06-16T16:00'));
    expect($cell->pluck('id'))->toContain($this->teacher);
    expect($cell->firstWhere('id', $this->teacher)['has_conflict'])->toBeFalse();

    // No cell outside the window (e.g. a Thursday) carries this teacher.
    expect($res->json('cells.2026-06-18T16:00'))->toBeNull();
});

it('flags a grid cell as conflicted when the teacher is already booked', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/trials', [
        'teacher_id' => $this->teacher,
        'lead_name' => 'Grid Lead',
        'lead_whatsapp' => '+201234567890',
        'local_datetime' => '2026-06-16 16:00',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertCreated();

    $res = $this->getJson('/api/trials/availability-grid?week_start=2026-06-14&duration_minutes=30')
        ->assertOk();

    $cell = collect($res->json('cells.2026-06-16T16:00'));
    expect($cell->firstWhere('id', $this->teacher)['has_conflict'])->toBeTrue();
});

it('books a trial for a brand-new lead (no student row created)', function () {
    Sanctum::actingAs($this->owner);

    $res = $this->postJson('/api/trials', [
        'teacher_id' => $this->teacher,
        'lead_name' => 'Sara Ahmed',
        'lead_whatsapp' => '+201112223334',
        'lead_email' => 'sara@example.com',
        'local_datetime' => '2026-06-16 17:00',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 45,
    ])->assertCreated();

    $this->asAcademy($this->academy);
    $row = DB::table('trials')->where('id', $res->json('trialId'))->first();
    expect($row->status)->toBe('SCHEDULED');
    expect($row->student_id)->toBeNull();
    expect($row->lead_name)->toBe('Sara Ahmed');
    // No phantom student was created for the lead.
    expect(DB::table('students')->where('full_name', 'Sara Ahmed')->exists())->toBeFalse();
});

it('rejects a lead trial with neither a student nor lead contact', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/trials', [
        'teacher_id' => $this->teacher,
        'lead_name' => 'Nameless',
        'local_datetime' => '2026-06-16 17:00',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertStatus(422); // missing WhatsApp
});

it('converts a completed lead trial into a real student', function () {
    Sanctum::actingAs($this->owner);

    $trialId = $this->postJson('/api/trials', [
        'teacher_id' => $this->teacher,
        'lead_name' => 'Convert Me',
        'lead_whatsapp' => '+201998887776',
        'local_datetime' => '2026-06-16 17:00',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertCreated()->json('trialId');

    $this->patchJson("/api/trials/{$trialId}", ['status' => 'COMPLETED'])->assertOk();
    $this->postJson("/api/trials/{$trialId}/convert", ['student_id' => $this->student])->assertOk();

    $this->asAcademy($this->academy);
    $row = DB::table('trials')->where('id', $trialId)->first();
    expect($row->status)->toBe('CONVERTED');
    expect($row->converted_student_id)->toBe($this->student);

    // A second convert is rejected (idempotency).
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/trials/{$trialId}/convert", ['student_id' => $this->student])->assertStatus(422);
});

it('forbids a teacher from reaching the trials surface', function () {
    $teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-trial@test.local']);
    Sanctum::actingAs($teacherUser);

    $this->getJson('/api/trials')->assertForbidden();
    $this->getJson('/api/trials/availability?date=2026-06-16&time=17:00&duration_minutes=30')->assertForbidden();
});
