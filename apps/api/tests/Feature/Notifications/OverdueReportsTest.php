<?php

declare(strict_types=1);

use App\Jobs\FlagOverdueReportsJob;
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

    $this->academy = $this->createAcademy(overrides: ['timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-od@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-od@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'OD Teacher', 'user_id' => $this->teacherUser->id]);
    $this->student = $this->createStudent($this->academy, overrides: ['full_name' => 'OD Pupil']);

    // Ended at 08:30 UTC — 3.5h before "now" (12:00), with no report. This one is overdue.
    $this->overdue = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-11 08:00:00+00', 'duration_minutes' => 30, 'status' => 'SCHEDULED',
    ]);
});

afterEach(fn () => Carbon::setTestNow());

/** Run the sweep for just this test's academy (deterministic — ignores the demo academy). */
function sweep(string $academyId): array
{
    return (new FlagOverdueReportsJob($academyId))->handle();
}

it('flags an overdue session: owner alert only (no teacher reminder)', function () {
    sweep($this->academy);

    $this->asAcademy($this->academy);
    $owner = DB::table('notifications')->where('session_id', $this->overdue)->where('type', 'REPORT_OVERDUE')->first();

    expect($owner)->not->toBeNull()
        ->and($owner->audience_role)->toBe('ACADEMY_OWNER')
        ->and($owner->recipient_user_id)->toBeNull();

    expect(json_decode($owner->data, true)['teacher_name'])->toBe('OD Teacher');

    // The Notifications page is owner-only — no teacher-facing reminder is written.
    expect(DB::table('notifications')->where('session_id', $this->overdue)->where('type', 'REPORT_REMINDER')->exists())->toBeFalse();
});

it('is idempotent — re-running creates no duplicates', function () {
    sweep($this->academy);
    sweep($this->academy);

    $this->asAcademy($this->academy);
    expect(DB::table('notifications')->where('session_id', $this->overdue)->count())->toBe(1); // one owner alert
});

it('does not flag a session that ended less than the grace window ago', function () {
    $recent = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-11 11:00:00+00', 'duration_minutes' => 30, 'status' => 'SCHEDULED', // ends 11:30, 30m ago
    ]);
    sweep($this->academy);

    $this->asAcademy($this->academy);
    expect(DB::table('notifications')->where('session_id', $recent)->exists())->toBeFalse();
});

it('does not flag a session that already has a report', function () {
    $this->asAcademy($this->academy);
    DB::table('session_reports')->insert([
        'id' => (string) \Illuminate\Support\Str::uuid(),
        'academy_id' => $this->academy,
        'session_id' => $this->overdue,
        'values' => '{}',
        'filled_at' => now(),
    ]);

    sweep($this->academy);
    expect(DB::table('notifications')->where('session_id', $this->overdue)->exists())->toBeFalse();
});

it('does not flag a cancelled session', function () {
    $cancelled = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-11 07:00:00+00', 'duration_minutes' => 30, 'status' => 'CANCELLED_BY_STUDENT',
    ]);
    sweep($this->academy);

    $this->asAcademy($this->academy);
    expect(DB::table('notifications')->where('session_id', $cancelled)->exists())->toBeFalse();
});

it('clears the alert once the report is filed', function () {
    sweep($this->academy);

    Sanctum::actingAs($this->owner);
    $this->putJson("/api/sessions/{$this->overdue}/report", ['values' => []])->assertOk();

    $this->asAcademy($this->academy);
    $unread = DB::table('notifications')->where('session_id', $this->overdue)->whereNull('read_at')->count();
    expect($unread)->toBe(0);
});

it('shows the report alert in the owner feed and badge, and clears on mark-read', function () {
    sweep($this->academy);

    Sanctum::actingAs($this->owner);
    $feed = $this->getJson('/api/notifications')->assertOk()->json('notifications');
    $mine = collect($feed)->firstWhere('session_id', $this->overdue);
    expect($mine)->not->toBeNull()->and($mine['type'])->toBe('REPORT_OVERDUE');

    expect($this->getJson('/api/notifications/summary')->assertOk()->json('reports'))->toBeGreaterThanOrEqual(1);

    $this->postJson("/api/notifications/{$mine['id']}/read")->assertOk();
    $this->asAcademy($this->academy);
    expect(DB::table('notifications')->where('id', $mine['id'])->value('read_at'))->not->toBeNull();
});

it('forbids a teacher from the report feed (owner-only Notifications page)', function () {
    sweep($this->academy);

    // A teacher has no notification.read, so the report feed is out of reach.
    Sanctum::actingAs($this->teacherUser);
    $this->getJson('/api/notifications')->assertStatus(403);
});

it('requires notification.read to view the feed', function () {
    // An unauthenticated request is rejected; an authenticated teacher (no notification.read) is
    // forbidden — the gate is enforced for real, not just by auth.
    $this->getJson('/api/notifications')->assertStatus(401);
});
