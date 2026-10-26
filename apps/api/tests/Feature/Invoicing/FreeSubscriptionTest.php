<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Database\QueryException;
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
 * A Quran academy's two asks on the monthly subscription (2026-10-26): count it as lessons of a
 * length ("8 lessons of 40 minutes" — 5.33 hours used to be refused as a non-integer), and a
 * student taught for nothing whose lessons are still recorded and paid to the teacher.
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
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-free@test.local']);
    $this->teacher = $this->createTeacher($this->academy);
    $this->guardian = $this->createGuardian($this->academy, ['whatsapp_phone' => '+201001234567', 'currency' => 'EGP']);
    $this->student = $this->createStudent($this->academy, $this->guardian);

    $this->subscription = function (): ?object {
        $this->asAcademy($this->academy);

        return DB::table('subscriptions')->where('student_id', $this->student)->where('status', 'ACTIVE')->first();
    };
});

afterEach(fn () => Carbon::setTestNow());

it('stores a monthly subscription as lessons of a length', function () {
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/students/{$this->student}/subscription", [
        'plan_label' => '8 × 40',
        'sessions_per_month' => 8,
        'lesson_minutes' => 40,
        'price_minor' => 7500,
        'currency' => 'EGP',
        'price_basis' => 'PER_HOUR',
        'start_date' => '2026-06-01',
    ])->assertOk();

    $sub = ($this->subscription)();
    expect((int) $sub->sessions_per_month)->toBe(8)
        ->and((int) $sub->lesson_minutes)->toBe(40)
        ->and((int) $sub->price_minor)->toBe(7500);

    $row = collect($this->getJson('/api/students')->assertOk()->json('rows'))->firstWhere('id', $this->student);
    expect($row['lesson_minutes'])->toBe(40);
});

it('writes a free subscription at 0 whatever price came with it', function () {
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/students/{$this->student}/subscription", [
        'plan_label' => 'Free',
        'sessions_per_month' => 8,
        'lesson_minutes' => 30,
        'price_minor' => 9900,
        'price_basis' => 'FREE',
        'start_date' => '2026-06-01',
    ])->assertOk();

    $sub = ($this->subscription)();
    expect($sub->price_basis)->toBe('FREE')
        ->and((int) $sub->price_minor)->toBe(0);
});

it('takes a free subscription on the create form too', function () {
    Sanctum::actingAs($this->owner);

    $id = $this->postJson('/api/students', [
        'full_name' => 'Free learner',
        'guardian_id' => $this->guardian,
        'status' => 'REGULAR',
        'subscription' => [
            'plan_label' => 'Free',
            'sessions_per_month' => 8,
            'lesson_minutes' => 45,
            'price_minor' => 0,
            'price_basis' => 'FREE',
            'start_date' => '2026-06-01',
        ],
    ])->assertCreated()->json('studentId');

    $this->asAcademy($this->academy);
    $sub = DB::table('subscriptions')->where('student_id', $id)->first();
    expect($sub->price_basis)->toBe('FREE')->and((int) $sub->lesson_minutes)->toBe(45);
});

it("records a free student's lesson and pays the teacher, but opens no invoice", function () {
    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'student_id' => $this->student,
        'plan_label' => 'Free',
        'price_minor' => 0,
        'currency' => 'EGP',
        'price_basis' => 'FREE',
        'sessions_per_month' => 8,
        'lesson_minutes' => 40,
        'status' => 'ACTIVE',
        'start_date' => '2026-01-01',
    ]);
    $session = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-01 10:00:00+00',
        'duration_minutes' => 40,
        'status' => 'SCHEDULED',
    ]);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $row = DB::table('sessions')->where('id', $session)->first();
    expect($row->status)->toBe('ATTENDED')
        ->and((bool) $row->paid_to_teacher)->toBeTrue()
        ->and(DB::table('payout_line_items')->where('session_id', $session)->count())->toBe(1)
        ->and(DB::table('invoice_line_items')->where('session_id', $session)->count())->toBe(0)
        ->and(DB::table('invoices')->where('academy_id', $this->academy)->count())->toBe(0);

    // Un-marking it again finds no line to take back, and does not fail looking for one.
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'CANCELLED_BY_STUDENT'])->assertOk();
});

it('quotes nothing to bill ahead for a free student', function () {
    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'student_id' => $this->student,
        'plan_label' => 'Free',
        'price_minor' => 0,
        'currency' => 'EGP',
        'price_basis' => 'FREE',
        'status' => 'ACTIVE',
        'start_date' => '2026-01-01',
    ]);
    $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-20 10:00:00+00',
        'status' => 'SCHEDULED',
    ]);

    Sanctum::actingAs($this->owner);
    $this->getJson("/api/invoices/advance-quote?student_id={$this->student}&start_date=2026-06-12")
        ->assertOk()
        ->assertJsonPath('count', 0);
});

it('refuses a non-zero price on a free row at the database', function () {
    $this->asAcademy($this->academy);
    expect(fn () => DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'student_id' => $this->student,
        'plan_label' => 'Free',
        'price_minor' => 500,
        'currency' => 'EGP',
        'price_basis' => 'FREE',
        'status' => 'ACTIVE',
        'start_date' => '2026-01-01',
    ]))->toThrow(QueryException::class);
});
