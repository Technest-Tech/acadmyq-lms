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

// 2026-06-16 is a Tuesday; 17:00 Cairo sits inside the teacher's 16:00–19:00 window.

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

it('warns — but does not block — when the slot overlaps another trial', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/trials', [
        'teacher_id' => $this->teacher,
        'lead_name' => 'First Lead',
        'lead_whatsapp' => '+201234567890',
        'local_datetime' => '2026-06-16 17:00',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertCreated();

    $res = $this->postJson('/api/trials', [
        'teacher_id' => $this->teacher,
        'lead_name' => 'Second Lead',
        'lead_whatsapp' => '+201234567891',
        'local_datetime' => '2026-06-16 17:15',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertCreated();

    expect(collect($res->json('warnings'))->pluck('type'))->toContain('conflict');
});

it('counts the trials the overview page reports on', function () {
    Sanctum::actingAs($this->owner);

    $upcoming = $this->postJson('/api/trials', [
        'teacher_id' => $this->teacher,
        'lead_name' => 'Upcoming Lead',
        'lead_whatsapp' => '+201234567892',
        'local_datetime' => '2026-06-16 17:00',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertCreated()->json('trialId');

    $past = $this->postJson('/api/trials', [
        'teacher_id' => $this->teacher,
        'student_id' => $this->student,
        'local_datetime' => '2026-05-12 17:00',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertCreated()->json('trialId');

    $this->patchJson("/api/trials/{$past}", ['status' => 'COMPLETED'])->assertOk();

    $summary = $this->getJson('/api/trials/summary')->assertOk()->json();
    expect($summary['total'])->toBe(2);
    expect($summary['upcoming'])->toBe(1);
    expect($summary['completed'])->toBe(1);
    // Nothing came from the CRM here, and nothing has slipped past its slot unresolved.
    expect($summary['from_crm'])->toBe(0);
    expect($summary['awaiting_outcome'])->toBe(0);
    expect($upcoming)->not->toBe($past);
});

it('no longer exposes the availability matcher', function () {
    // Finding a teacher for a slot was the old trials page's whole job; booking now happens in
    // the CRM, so the matcher is gone rather than left running unused. (Asserted on the route
    // table, not a status code: `availability` would otherwise be read as a trial id.)
    $uris = collect(app('router')->getRoutes()->getRoutes())->map(fn ($r) => $r->uri());

    expect($uris)->not->toContain('api/trials/availability');
    expect($uris)->not->toContain('api/trials/availability-grid');
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
    $this->getJson('/api/trials/summary')->assertForbidden();
});
