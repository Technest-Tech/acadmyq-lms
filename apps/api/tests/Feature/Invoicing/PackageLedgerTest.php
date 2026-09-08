<?php

declare(strict_types=1);

use App\Services\LessonPackages;
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

/*
|--------------------------------------------------------------------------
| The package ledger, by hand (docs/lesson-packages)
|--------------------------------------------------------------------------
|
| The automatic engine is right until an academy does something real: teaches before the block is
| sold, records the wrong length, or splits a record two siblings were sharing. These pin the three
| manual controls that put that right, and the one rule they all obey — the session, its invoice
| line and the teacher's payout move TOGETHER, or not at all.
*/

beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'invoice_grouping' => 'PER_GUARDIAN',
        'plan_id' => $proPlan,
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-ledger@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-ledger@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['user_id' => $this->teacherUser->id]);
    $this->guardian = $this->createGuardian($this->academy, ['whatsapp_phone' => '+201009991234', 'currency' => 'EGP']);
    $this->student = $this->createStudent($this->academy, $this->guardian);

    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'student_id' => $this->student,
        'plan_label' => 'Hours package',
        'price_minor' => 20000, // 200 EGP per hour
        'currency' => 'EGP',
        'price_basis' => 'PER_PACKAGE',
        'sessions_per_month' => null,
        'status' => 'ACTIVE',
        'start_date' => '2026-01-01',
    ]);

    // Opens AFTER the early lesson below on purpose: a block sold once the teaching had already
    // started is exactly the case the manual controls exist for.
    $this->openPackage = function (string $startsOn = '2026-06-05'): array {
        $this->asAcademy($this->academy);

        return app(LessonPackages::class)->open([
            'student_id' => $this->student,
            'label' => '4 hours',
            'minutes_total' => 240,
            'price_minor' => 80000,
            'currency' => 'EGP',
            'bill_timing' => 'ON_COMPLETION',
            'starts_on' => $startsOn,
        ], (string) $this->owner->id, 'ACADEMY_OWNER');
    };

    /** A lesson taught before the package was sold: attended, so it billed the ordinary way. */
    $this->earlyLesson = function (int $minutes = 60): string {
        $id = $this->createSession($this->academy, $this->student, $this->teacher, [
            'scheduled_at_utc' => '2026-06-02 10:00:00+00',
            'duration_minutes' => $minutes,
            'status' => 'SCHEDULED',
        ]);
        Sanctum::actingAs($this->owner);
        $this->postJson("/api/sessions/{$id}/attendance", ['status' => 'ATTENDED'])->assertOk();

        return $id;
    };

    $this->packageRow = function (string $id): object {
        $this->asAcademy($this->academy);

        return DB::table('lesson_packages')->where('id', $id)->first();
    };
});

afterEach(fn () => Carbon::setTestNow());

// ─── Seeing what is attachable ───────────────────────────────────────────────

it('offers the attended lessons that are not on any package yet', function () {
    $session = ($this->earlyLesson)();
    $package = ($this->openPackage)();

    Sanctum::actingAs($this->owner);
    $body = $this->getJson("/api/packages/{$package['package_id']}/available-lessons")
        ->assertOk()
        ->json();

    expect($body['lessons'])->toHaveCount(1)
        ->and($body['lessons'][0]['id'])->toBe($session)
        ->and($body['lessons'][0]['duration_minutes'])->toBe(60)
        // Its invoice is still OPEN, so it can still move.
        ->and($body['lessons'][0]['locked'])->toBeFalse();
});

it('stops offering a lesson once it is on the package', function () {
    $session = ($this->earlyLesson)();
    $package = ($this->openPackage)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/packages/{$package['package_id']}/lessons", ['session_id' => $session])->assertOk();

    expect($this->getJson("/api/packages/{$package['package_id']}/available-lessons")->json('lessons'))
        ->toHaveCount(0);
});

// ─── Attaching a lesson that already exists ──────────────────────────────────

it('moves an existing lesson onto the package and off the invoice', function () {
    $session = ($this->earlyLesson)();
    $package = ($this->openPackage)();

    $this->asAcademy($this->academy);
    $line = DB::table('invoice_line_items')->where('session_id', $session)->first();
    expect($line)->not->toBeNull();
    $invoiceId = (string) $line->invoice_id;

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/packages/{$package['package_id']}/lessons", ['session_id' => $session])
        ->assertOk()
        ->assertJson(['ok' => true, 'created' => false, 'minutes' => 60]);

    $this->asAcademy($this->academy);

    // The minutes are on the package…
    expect((int) ($this->packageRow)($package['package_id'])->minutes_consumed)->toBe(60);

    // …and the lesson is billed by the package OR the invoice, never both.
    expect(DB::table('invoice_line_items')->where('session_id', $session)->count())->toBe(0)
        ->and((int) DB::table('invoices')->where('id', $invoiceId)->value('total_minor'))->toBe(0);
});

it('refuses to put one lesson on two packages', function () {
    $session = ($this->earlyLesson)();
    $package = ($this->openPackage)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/packages/{$package['package_id']}/lessons", ['session_id' => $session])->assertOk();
    $this->postJson("/api/packages/{$package['package_id']}/lessons", ['session_id' => $session])
        ->assertStatus(422);
});

it('refuses a lesson that belongs to another student', function () {
    $package = ($this->openPackage)();
    $other = $this->createStudent($this->academy, $this->guardian);
    $session = $this->createSession($this->academy, $other, $this->teacher, [
        'scheduled_at_utc' => '2026-06-02 10:00:00+00',
        'duration_minutes' => 60,
        'status' => 'ATTENDED',
    ]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/packages/{$package['package_id']}/lessons", ['session_id' => $session])
        ->assertStatus(422);
});

it('refuses a lesson nobody has marked attended', function () {
    $package = ($this->openPackage)();
    $session = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-09 10:00:00+00',
        'duration_minutes' => 60,
        'status' => 'SCHEDULED',
    ]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/packages/{$package['package_id']}/lessons", ['session_id' => $session])
        ->assertStatus(422);
});

// ─── Recording a lesson that was never entered ───────────────────────────────

it('records a missing lesson as real attendance and consumes it', function () {
    $package = ($this->openPackage)();
    Sanctum::actingAs($this->owner);

    $body = $this->postJson("/api/packages/{$package['package_id']}/lessons", [
        'local_datetime' => '2026-06-09 16:00',
        'duration_minutes' => 90,
        'teacher_id' => $this->teacher,
    ])->assertStatus(201)->json();

    expect($body['created'])->toBeTrue();

    $this->asAcademy($this->academy);
    $session = DB::table('sessions')->where('id', $body['session_id'])->first();

    // A real attended lesson — not a decorative ledger row.
    expect($session->status)->toBe('ATTENDED')
        ->and((bool) $session->billed)->toBeTrue()
        ->and((int) $session->duration_minutes)->toBe(90)
        // Ad-hoc, so the timetable generator never adopts or retimes it.
        ->and($session->schedule_id)->toBeNull()
        ->and((int) ($this->packageRow)($package['package_id'])->minutes_consumed)->toBe(90)
        // The teacher is paid for it.
        ->and(DB::table('payout_line_items')->where('session_id', $session->id)->count())->toBe(1);
});

it('needs a length to record a lesson', function () {
    $package = ($this->openPackage)();
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/packages/{$package['package_id']}/lessons", [
        'local_datetime' => '2026-06-09 16:00',
    ])->assertStatus(422);
});

// ─── Correcting how long a lesson ran ────────────────────────────────────────

it('corrects a lesson length and moves the package and the payout with it', function () {
    $package = ($this->openPackage)();
    $session = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-09 10:00:00+00',
        'duration_minutes' => 80,
        'status' => 'SCHEDULED',
    ]);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    expect((int) ($this->packageRow)($package['package_id'])->minutes_consumed)->toBe(80);
    $credit = DB::table('lesson_package_credits')->where('session_id', $session)->first();
    $payoutBefore = (int) DB::table('payout_line_items')->where('session_id', $session)->value('amount_minor');

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/packages/{$package['package_id']}/lessons/{$credit->id}", [
        'duration_minutes' => 40,
    ])->assertOk();

    $this->asAcademy($this->academy);

    expect((int) ($this->packageRow)($package['package_id'])->minutes_consumed)->toBe(40)
        ->and((int) DB::table('sessions')->where('id', $session)->value('duration_minutes'))->toBe(40)
        ->and((int) DB::table('lesson_package_credits')->where('session_id', $session)->value('minutes'))->toBe(40)
        // Half the lesson, half the teacher's pay — the ledgers never drift apart.
        ->and((int) DB::table('payout_line_items')->where('session_id', $session)->value('amount_minor'))
        ->toBe((int) round($payoutBefore / 2));
});

it('refuses to correct a lesson that is not on this package', function () {
    $package = ($this->openPackage)();
    Sanctum::actingAs($this->owner);

    $this->patchJson("/api/packages/{$package['package_id']}/lessons/".Str::uuid(), [
        'duration_minutes' => 40,
    ])->assertStatus(404);
});

// ─── Taking a lesson back off ────────────────────────────────────────────────

it('returns the hours and bills the lesson the ordinary way', function () {
    $package = ($this->openPackage)();
    $session = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-09 10:00:00+00',
        'duration_minutes' => 60,
        'status' => 'SCHEDULED',
    ]);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $credit = DB::table('lesson_package_credits')->where('session_id', $session)->first();

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/packages/{$package['package_id']}/lessons/{$credit->id}", ['rebill' => true])
        ->assertOk()
        ->assertJson(['ok' => true, 'minutes_returned' => 60, 'rebilled' => true]);

    $this->asAcademy($this->academy);

    expect((int) ($this->packageRow)($package['package_id'])->minutes_consumed)->toBe(0)
        ->and(DB::table('lesson_package_credits')->where('session_id', $session)->count())->toBe(0)
        // The lesson happened, so somebody pays for it: one hour at the student's hourly rate.
        ->and((int) DB::table('invoice_line_items')->where('session_id', $session)->value('amount_minor'))
        ->toBe(20000);
});

it('returns the hours and charges nobody when the lesson was never this student\'s', function () {
    $package = ($this->openPackage)();
    $session = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-09 10:00:00+00',
        'duration_minutes' => 60,
        'status' => 'SCHEDULED',
    ]);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $credit = DB::table('lesson_package_credits')->where('session_id', $session)->first();

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/packages/{$package['package_id']}/lessons/{$credit->id}", ['rebill' => false])
        ->assertOk()
        ->assertJson(['minutes_returned' => 60, 'rebilled' => false]);

    $this->asAcademy($this->academy);

    expect((int) ($this->packageRow)($package['package_id'])->minutes_consumed)->toBe(0)
        // No credit AND no invoice line: it leaves the record entirely, which is also what keeps
        // the backdated sync from sweeping it straight back in.
        ->and(DB::table('invoice_line_items')->where('session_id', $session)->count())->toBe(0);
});

it('re-opens a package that had closed only because it ran out', function () {
    $package = ($this->openPackage)();
    $session = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-09 10:00:00+00',
        'duration_minutes' => 240,
        'status' => 'SCHEDULED',
    ]);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    expect(($this->packageRow)($package['package_id'])->status)->toBe('COMPLETED');
    $credit = DB::table('lesson_package_credits')->where('session_id', $session)->first();

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/packages/{$package['package_id']}/lessons/{$credit->id}", ['rebill' => false])
        ->assertOk();

    $this->asAcademy($this->academy);
    expect(($this->packageRow)($package['package_id'])->status)->toBe('ACTIVE');
});

// ─── The gate ────────────────────────────────────────────────────────────────

it('forbids a teacher from moving lessons on a package', function () {
    $package = ($this->openPackage)();
    $session = ($this->earlyLesson)();

    Sanctum::actingAs($this->teacherUser);
    $this->postJson("/api/packages/{$package['package_id']}/lessons", ['session_id' => $session])
        ->assertForbidden();
});

it('refuses to add a lesson to a package that is no longer open', function () {
    $package = ($this->openPackage)();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/packages/{$package['package_id']}/close", ['reason' => 'CLOSED_EARLY'])->assertOk();

    // Refused BEFORE anything is recorded — a failed add must not leave a stray attended lesson.
    $this->postJson("/api/packages/{$package['package_id']}/lessons", [
        'local_datetime' => '2026-06-09 16:00',
        'duration_minutes' => 60,
        'teacher_id' => $this->teacher,
    ])->assertStatus(422);

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('student_id', $this->student)->count())->toBe(0);
});
