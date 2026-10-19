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

beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-hide@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Hide Teacher']);

    $this->leaving = $this->createStudent($this->academy, overrides: ['full_name' => 'Leaving']);
    $this->staying = $this->createStudent($this->academy, overrides: ['full_name' => 'Staying']);

    // The leaver: one lesson already attended, one past nobody marked, one still to come.
    $this->attended = $this->createSession($this->academy, $this->leaving, $this->teacher, [
        'scheduled_at_utc' => '2026-06-08 10:00:00+00', 'status' => 'ATTENDED',
    ]);
    $this->unmarked = $this->createSession($this->academy, $this->leaving, $this->teacher, [
        'scheduled_at_utc' => '2026-06-09 10:00:00+00', 'status' => 'SCHEDULED',
    ]);
    $this->upcoming = $this->createSession($this->academy, $this->leaving, $this->teacher, [
        'scheduled_at_utc' => '2026-06-11 13:00:00+00', 'status' => 'SCHEDULED',
    ]);
    // Someone who stays, on the same days — must not be touched.
    $this->control = $this->createSession($this->academy, $this->staying, $this->teacher, [
        'scheduled_at_utc' => '2026-06-09 12:00:00+00', 'status' => 'SCHEDULED',
    ]);
});

/** Every session id the calendar and the attendance page would show for June 2026. */
function visibleLessonIds(): array
{
    $t = test();
    $window = ['from' => '2026-06-01T00:00:00Z', 'to' => '2026-07-01T00:00:00Z'];

    return [
        'calendar' => collect($t->getJson('/api/calendar?from=2026-06-01&to=2026-06-30')->assertOk()->json('sessions'))->pluck('id')->all(),
        'day' => collect($t->getJson('/api/sessions/day?'.http_build_query($window))->assertOk()->json('sessions'))->pluck('id')->all(),
        'overdue' => collect($t->getJson('/api/sessions/overdue')->assertOk()->json('sessions'))->pluck('id')->all(),
        'pending' => collect($t->getJson('/api/sessions/pending-attendance')->assertOk()->json('sessions'))->pluck('id')->all(),
    ];
}

it('hides every lesson of a deactivated student from the calendar and the attendance page', function () {
    Sanctum::actingAs($this->owner);
    $before = visibleLessonIds();
    expect($before['calendar'])->toContain($this->attended, $this->unmarked, $this->upcoming);
    expect($before['overdue'])->toContain($this->unmarked);

    $this->postJson("/api/students/{$this->leaving}/deactivate")->assertOk();

    $after = visibleLessonIds();
    foreach ($after as $ids) {
        expect($ids)->not->toContain($this->attended)
            ->not->toContain($this->unmarked)
            ->not->toContain($this->upcoming);
    }
    // The student who stays is untouched everywhere.
    expect($after['calendar'])->toContain($this->control);
    expect($after['day'])->toContain($this->control);
    expect($after['overdue'])->toContain($this->control);

    $count = $this->getJson('/api/sessions/day/count?from=2026-06-11T00:00:00Z&to=2026-06-12T00:00:00Z')->assertOk();
    expect($count->json('count'))->toBe(0);

    // Display only — the rows are kept, so billing and payroll still see the attended lesson.
    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $this->attended)->value('status'))->toBe('ATTENDED');
    expect(DB::table('sessions')->where('student_id', $this->leaving)->whereNull('hidden_at')->count())->toBe(0);
    expect(DB::table('sessions')->where('id', $this->control)->value('hidden_at'))->toBeNull();
});

it('hides them on the recoverable delete too', function () {
    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/students/{$this->leaving}")->assertOk();

    expect(visibleLessonIds()['calendar'])->not->toContain($this->attended)
        ->not->toContain($this->unmarked)
        ->not->toContain($this->upcoming);
});

it('starts a reactivated student over: the old lessons stay hidden, new ones show', function () {
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/students/{$this->leaving}/deactivate")->assertOk();
    $this->postJson("/api/students/{$this->leaving}/reactivate")->assertOk();

    $fresh = $this->createSession($this->academy, $this->leaving, $this->teacher, [
        'scheduled_at_utc' => '2026-06-15 10:00:00+00', 'status' => 'SCHEDULED',
    ]);

    Sanctum::actingAs($this->owner);
    $calendar = visibleLessonIds()['calendar'];
    expect($calendar)->not->toContain($this->attended)
        ->not->toContain($this->unmarked)
        ->not->toContain($this->upcoming);
    expect($calendar)->toContain($fresh);
});
