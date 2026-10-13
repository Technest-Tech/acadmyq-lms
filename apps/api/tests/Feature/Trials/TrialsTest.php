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

it('deletes a trial off the record — converted ones too — while cancel keeps the row', function () {
    Sanctum::actingAs($this->owner);

    $book = fn (string $name, string $phone) => $this->postJson('/api/trials', [
        'teacher_id' => $this->teacher,
        'lead_name' => $name,
        'lead_whatsapp' => $phone,
        'local_datetime' => '2026-06-16 17:00',
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertCreated()->json('trialId');

    $cancelled = $book('Cancel Me', '+201000000001');
    $converted = $book('Delete Me', '+201000000002');

    $this->deleteJson("/api/trials/{$cancelled}")->assertOk();
    $this->patchJson("/api/trials/{$converted}", ['status' => 'COMPLETED'])->assertOk();
    $this->postJson("/api/trials/{$converted}/convert", ['student_id' => $this->student])->assertOk();

    $this->deleteJson("/api/trials/{$converted}/permanent")->assertOk();

    $ids = collect($this->getJson('/api/trials')->assertOk()->json('rows'))->pluck('id');
    expect($ids)->toContain($cancelled);
    expect($ids)->not->toContain($converted);
    expect($this->getJson('/api/trials/summary')->json('total'))->toBe(1);

    // Gone is gone: a second delete, or any other verb on it, finds nothing.
    $this->deleteJson("/api/trials/{$converted}/permanent")->assertNotFound();

    $this->asAcademy($this->academy);
    expect(DB::table('trials')->where('id', $converted)->value('deleted_at'))->not->toBeNull();
    // The student the conversion made is not collateral.
    expect(DB::table('students')->where('id', $this->student)->whereNull('deleted_at')->exists())->toBeTrue();
});

it('forbids a teacher from reaching the trials surface', function () {
    $teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-trial@test.local']);
    Sanctum::actingAs($teacherUser);

    $this->getJson('/api/trials')->assertForbidden();
    $this->getJson('/api/trials/summary')->assertForbidden();
    $this->getJson('/api/trials/agenda')->assertForbidden();
    $this->getJson('/api/trials/teachers')->assertForbidden();
    $this->deleteJson('/api/trials/'.Str::uuid().'/permanent')->assertForbidden();
});

it('draws the agenda: the academy day, the week strip, and every trial still waiting on a decision', function () {
    Sanctum::actingAs($this->owner);

    // "Now" is 2026-05-15 06:00 UTC = 09:00 in Cairo (UTC+3 in May).
    $book = fn (string $name, string $phone, string $local, int $minutes = 30) => $this->postJson('/api/trials', [
        'teacher_id' => $this->teacher,
        'lead_name' => $name,
        'lead_whatsapp' => $phone,
        'local_datetime' => $local,
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => $minutes,
    ])->assertCreated()->json('trialId');

    $lastWeek = $book('Forgotten', '+201000000011', '2026-05-12 17:00');
    $endedToday = $book('Ended Today', '+201000000012', '2026-05-15 08:00');      // ended 08:30
    $inProgress = $book('In Progress', '+201000000013', '2026-05-15 08:45');      // ends 09:15
    $tomorrow = $book('Tomorrow', '+201000000014', '2026-05-16 17:00');

    $agenda = $this->getJson('/api/trials/agenda?from=2026-05-12&to=2026-05-18')->assertOk()->json();

    expect($agenda['timezone'])->toBe('Africa/Cairo');
    expect($agenda['today'])->toBe('2026-05-15');
    // The picked day defaults to the academy's today, earliest first.
    expect(collect($agenda['trials'])->pluck('id')->all())->toBe([$endedToday, $inProgress]);
    expect($agenda['trials'][0]['needs_decision'])->toBeTrue();
    // A trial still in its slot is not late.
    expect($agenda['trials'][1]['needs_decision'])->toBeFalse();
    expect($agenda['trials'][0]['contact_whatsapp'])->toBe('+201000000012');

    // Any day, oldest first — the forgotten one from Tuesday included.
    expect(collect($agenda['needs_decision'])->pluck('id')->all())->toBe([$lastWeek, $endedToday]);
    expect($agenda['needs_decision_count'])->toBe(2);

    $days = collect($agenda['days'])->keyBy('date');
    expect($days)->toHaveCount(7);
    expect($days['2026-05-12'])->toMatchArray(['total' => 1, 'needs_decision' => 1]);
    expect($days['2026-05-15'])->toMatchArray(['total' => 2, 'needs_decision' => 1]);
    expect($days['2026-05-16'])->toMatchArray(['total' => 1, 'needs_decision' => 0]);
    expect($days['2026-05-17'])->toMatchArray(['total' => 0, 'needs_decision' => 0]);

    expect($this->getJson('/api/trials/summary')->json('needs_decision'))->toBe(2);

    // A decision takes it off the red list; another day can be picked.
    $this->patchJson("/api/trials/{$lastWeek}", ['status' => 'NO_SHOW'])->assertOk();
    $after = $this->getJson('/api/trials/agenda?date=2026-05-16')->assertOk()->json();
    expect(collect($after['trials'])->pluck('id')->all())->toBe([$tomorrow]);
    expect($after['needs_decision_count'])->toBe(1);
    expect($this->getJson('/api/trials?filter[decision]=needed')->json('rows'))->toHaveCount(1);
});

it('gives the add-a-trial form its roster without the CRM', function () {
    Sanctum::actingAs($this->owner);

    $res = $this->getJson('/api/trials/teachers')->assertOk()->json();

    expect(collect($res['teachers'])->pluck('id'))->toContain($this->teacher);
    expect($res['timezone'])->toBe('Africa/Cairo');
    expect($res['durations'])->toContain(30);
});

it('warns about a clash when a trial is rescheduled onto another one', function () {
    Sanctum::actingAs($this->owner);

    $book = fn (string $name, string $phone, string $local) => $this->postJson('/api/trials', [
        'teacher_id' => $this->teacher,
        'lead_name' => $name,
        'lead_whatsapp' => $phone,
        'local_datetime' => $local,
        'timezone' => 'Africa/Cairo',
        'duration_minutes' => 30,
    ])->assertCreated()->json('trialId');

    $book('Holder', '+201000000021', '2026-06-16 17:00');
    $mover = $book('Mover', '+201000000022', '2026-06-16 18:00');

    $res = $this->patchJson("/api/trials/{$mover}", [
        'local_datetime' => '2026-06-16 17:15',
        'timezone' => 'Africa/Cairo',
    ])->assertOk()->json();

    expect($res['changed'])->toContain('scheduled_at_utc');
    expect(collect($res['warnings'])->pluck('type'))->toContain('conflict');
});
