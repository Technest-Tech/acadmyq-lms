<?php

declare(strict_types=1);

use App\Http\Controllers\Scheduling\SessionController;
use App\Services\SessionGenerator;
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

/**
 * Deleting a lesson (DELETE /api/sessions/{id}) — the teacher profile's Lessons tab.
 *
 * "Delete" has to mean the lesson is gone from the money too: no invoice line for the parent, no
 * payout line for the teacher. And it has to STAY gone: a generated lesson must not come back on
 * the next nightly roll just because its timetable still implies it.
 */
uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-delete@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-delete@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['user_id' => $this->teacherUser->id, 'full_name' => 'Delete Teacher']);
    $this->student = $this->createStudent($this->academy);

    $this->lesson = fn (): string => $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-01 15:00:00+00', 'status' => 'SCHEDULED',
    ]);
    $this->row = function (string $sessionId): object {
        $this->asAcademy($this->academy);

        return DB::table('sessions')->where('id', $sessionId)->first();
    };
    $this->money = function (string $sessionId): array {
        $this->asAcademy($this->academy);

        return [
            DB::table('invoice_line_items')->where('session_id', $sessionId)->count(),
            DB::table('payout_line_items')->where('session_id', $sessionId)->count(),
        ];
    };
});

afterEach(fn () => Carbon::setTestNow());

it('takes an attended lesson off the invoice and the payroll, and out of the lesson list', function () {
    $session = ($this->lesson)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();
    expect(($this->money)($session))->toBe([1, 1]);

    $this->deleteJson("/api/sessions/{$session}")->assertOk();

    expect(($this->money)($session))->toBe([0, 0]);
    $row = ($this->row)($session);
    expect($row->hidden_at)->not->toBeNull()
        ->and((bool) $row->billed)->toBeFalse()
        ->and((bool) $row->paid_to_teacher)->toBeFalse();

    Sanctum::actingAs($this->owner);
    $ids = collect($this->getJson('/api/sessions/day?from=2026-06-01T00:00:00Z&to=2026-06-02T00:00:00Z')->assertOk()->json('sessions'))->pluck('id');
    expect($ids)->not->toContain($session);
});

it('keeps a deleted lesson deleted when its timetable is generated again', function () {
    Carbon::setTestNow('2026-06-01 06:00:00');
    $this->asAcademy($this->academy);
    $this->assignTeacher($this->academy, $this->student, $this->teacher);
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher);
    $this->addSlot($this->academy, $schedule, 3, '17:00:00', 60);   // Wednesdays
    $generator = app(SessionGenerator::class);
    $generator->generateForSchedule($schedule, Carbon::parse('2026-06-01'), Carbon::parse('2026-06-30'));
    $count = DB::table('sessions')->where('schedule_id', $schedule)->count();
    $first = (string) DB::table('sessions')->where('schedule_id', $schedule)->orderBy('scheduled_at_utc')->value('id');

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/sessions/{$first}")->assertOk();

    // The nightly roll sees the occurrence already taken and leaves it alone.
    $this->asAcademy($this->academy);
    $generator->generateForSchedule($schedule, Carbon::parse('2026-06-01'), Carbon::parse('2026-06-30'));
    expect(DB::table('sessions')->where('schedule_id', $schedule)->count())->toBe($count);
    expect(DB::table('sessions')->where('schedule_id', $schedule)->whereNull('hidden_at')->count())->toBe($count - 1);
});

it('refuses a lesson whose invoice is already closed, changing nothing', function () {
    $session = ($this->lesson)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $invoiceId = DB::table('invoice_line_items')->where('session_id', $session)->value('invoice_id');
    DB::table('invoices')->where('id', $invoiceId)->update(['status' => 'CLOSED', 'closed_at' => now()]);

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/sessions/{$session}")->assertStatus(422);

    $row = ($this->row)($session);
    expect($row->status)->toBe('ATTENDED')->and($row->hidden_at)->toBeNull();
    expect(($this->money)($session))->toBe([1, 1]);
});

it('takes a refused lesson off the schedule only when asked to keep the money', function () {
    $session = ($this->lesson)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $invoiceId = DB::table('invoice_line_items')->where('session_id', $session)->value('invoice_id');
    DB::table('invoices')->where('id', $invoiceId)->update(['status' => 'CLOSED', 'closed_at' => now()]);

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/sessions/{$session}")->assertStatus(422);
    $this->deleteJson("/api/sessions/{$session}?keep_money=1")->assertOk()->assertJson(['keep_money' => true]);

    // Gone from the schedule; the closed bill and the salary untouched.
    $row = ($this->row)($session);
    expect($row->hidden_at)->not->toBeNull()
        ->and($row->status)->toBe('ATTENDED')
        ->and((bool) $row->billed)->toBeTrue()
        ->and((bool) $row->paid_to_teacher)->toBeTrue();
    expect(($this->money)($session))->toBe([1, 1]);

    $this->asAcademy($this->academy);
    $audit = DB::table('audit_log')->where('action', 'session.deleted')->where('entity_id', $session)->first();
    expect($audit)->not->toBeNull()->and(json_decode((string) $audit->after, true))->toBe(['keep_money' => true]);

    Sanctum::actingAs($this->owner);
    $ids = collect($this->getJson('/api/sessions/day?from=2026-06-01T00:00:00Z&to=2026-06-02T00:00:00Z')->assertOk()->json('sessions'))->pluck('id');
    expect($ids)->not->toContain($session);
});

it('only hides a moved lesson, leaving its replacement alone', function () {
    $session = ($this->lesson)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/reschedule", ['scheduled_at_utc' => '2026-06-20 15:00:00+00'])->assertStatus(201);

    $this->deleteJson("/api/sessions/{$session}")->assertOk();

    $row = ($this->row)($session);
    expect($row->status)->toBe('RESCHEDULED')->and($row->hidden_at)->not->toBeNull();
    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('original_session_id', $session)->whereNull('hidden_at')->count())->toBe(1);
});

it('forbids a teacher from deleting their own lesson', function () {
    $session = ($this->lesson)();
    Sanctum::actingAs($this->teacherUser);

    $this->deleteJson("/api/sessions/{$session}")->assertStatus(403);
    expect(($this->row)($session)->hidden_at)->toBeNull();
});

// ── Bulk delete (الحصص المعلقة → حذف المحدد) ──────────────────────────────────

it('deletes a backlog of held-up lessons in one go, each the way one delete does', function () {
    $a = ($this->lesson)();
    $b = $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => '2026-06-02 15:00:00+00', 'status' => 'SCHEDULED']);
    $this->asAcademy($this->academy);
    DB::table('session_cancellation_requests')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'session_id' => $b,
        'teacher_id' => $this->teacher, 'cancel_type' => 'teacher', 'reason' => 'sick', 'status' => 'PENDING',
    ]);
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    expect($this->getJson('/api/sessions/overdue')->assertOk()->json('count'))->toBe(2);

    $this->postJson('/api/sessions/bulk-delete', ['session_ids' => [$a, $b]])
        ->assertOk()->assertJson(['deleted' => 2, 'skipped' => []]);

    expect($this->getJson('/api/sessions/overdue')->assertOk()->json('count'))->toBe(0);
    foreach ([$a, $b] as $id) {
        $row = ($this->row)($id);
        expect($row->status)->toBe('CANCELLED_BY_TEACHER')->and($row->hidden_at)->not->toBeNull()
            ->and((bool) $row->billed)->toBeFalse()->and((bool) $row->paid_to_teacher)->toBeFalse();
    }
    $this->asAcademy($this->academy);
    expect(DB::table('session_cancellation_requests')->where('session_id', $b)->value('status'))->toBe('REJECTED')
        ->and(DB::table('audit_log')->where('action', 'session.deleted')->whereIn('entity_id', [$a, $b])->count())->toBe(2);
});

it('leaves recorded lessons, trial lessons and unknown ids alone, and says why', function () {
    $held = ($this->lesson)();
    $recorded = $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => '2026-06-03 15:00:00+00', 'status' => 'SCHEDULED']);
    $trialStudent = $this->createStudent($this->academy, null, ['status' => 'TRIAL']);
    $trial = $this->createSession($this->academy, $trialStudent, $this->teacher, ['scheduled_at_utc' => '2026-06-04 15:00:00+00', 'status' => 'SCHEDULED']);
    $unknown = (string) Str::uuid();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$recorded}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $res = $this->postJson('/api/sessions/bulk-delete', ['session_ids' => [$held, $recorded, $trial, $unknown]])->assertOk();

    expect($res->json('deleted'))->toBe(1)
        ->and(collect($res->json('skipped'))->pluck('reason', 'id')->all())
        ->toBe([$recorded => 'recorded', $trial => 'trial', $unknown => 'not_found']);
    expect(($this->row)($recorded)->status)->toBe('ATTENDED')
        ->and(($this->money)($recorded))->toBe([1, 1])
        ->and(($this->row)($trial)->hidden_at)->toBeNull()
        ->and(($this->row)($held)->hidden_at)->not->toBeNull();
});

it('skips a lesson the books refuse and still deletes the rest', function () {
    $refused = ($this->lesson)();
    $fine = $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => '2026-06-02 15:00:00+00', 'status' => 'SCHEDULED']);
    // Stand-in for a money guard saying no on this one lesson (DDL is rolled back with the test).
    DB::unprepared("
        create function test_refuse_lesson() returns trigger language plpgsql as \$\$
        begin
          if new.id = '{$refused}'::uuid and new.status <> old.status then raise exception 'cannot touch this lesson'; end if;
          return new;
        end \$\$;
        create trigger test_refuse_lesson before update on sessions for each row execute function test_refuse_lesson();
    ");

    Sanctum::actingAs($this->owner);
    $res = $this->postJson('/api/sessions/bulk-delete', ['session_ids' => [$refused, $fine]])->assertOk();

    expect($res->json('deleted'))->toBe(1)
        ->and($res->json('skipped.0.id'))->toBe($refused)
        ->and($res->json('skipped.0.reason'))->toBe('blocked');
    expect(($this->row)($refused)->status)->toBe('SCHEDULED')
        ->and(($this->row)($refused)->hidden_at)->toBeNull()
        ->and(($this->row)($fine)->hidden_at)->not->toBeNull();
});

it('keeps bulk delete to people who may delete lessons, and to a bounded list', function () {
    $session = ($this->lesson)();
    Sanctum::actingAs($this->teacherUser);
    $this->postJson('/api/sessions/bulk-delete', ['session_ids' => [$session]])->assertForbidden();
    expect(($this->row)($session)->hidden_at)->toBeNull();

    Sanctum::actingAs($this->owner);
    $tooMany = collect(range(1, SessionController::BULK_DELETE_MAX + 1))
        ->map(fn () => (string) Str::uuid())->all();
    $this->postJson('/api/sessions/bulk-delete', ['session_ids' => $tooMany])->assertUnprocessable();
    $this->postJson('/api/sessions/bulk-delete', ['session_ids' => []])->assertUnprocessable();
});
