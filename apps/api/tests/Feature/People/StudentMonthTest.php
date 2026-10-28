<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-month@test.local']);
    $this->teacher = $this->createTeacher($this->academy);
    $this->parent = $this->createGuardian($this->academy);
    $this->student = $this->createStudent($this->academy, $this->parent, ['full_name' => 'Month']);
    $this->sibling = $this->createStudent($this->academy, $this->parent, ['full_name' => 'Sibling']);

    $lesson = fn (string $at, string $status, array $extra = []) => $this->createSession($this->academy, $this->student, $this->teacher, ['scheduled_at_utc' => $at, 'status' => $status, 'duration_minutes' => 40] + $extra);
    // June: two taught, a late-cancel the academy charged, a free cancel, one unmarked, one to come.
    $lesson('2026-06-02 10:00:00+00', 'ATTENDED');
    $lesson('2026-06-04 10:00:00+00', 'ATTENDED');
    $lesson('2026-06-06 10:00:00+00', 'CANCELLED_BY_STUDENT', ['bill_override' => true]);
    $lesson('2026-06-08 10:00:00+00', 'CANCELLED_BY_TEACHER');
    $lesson('2026-06-10 10:00:00+00', 'SCHEDULED');
    $lesson('2026-06-15 10:00:00+00', 'SCHEDULED');
    // Outside the month, and a hidden tombstone inside it — neither counts.
    $lesson('2026-05-28 10:00:00+00', 'ATTENDED');
    $lesson('2026-06-03 10:00:00+00', 'ATTENDED', ['hidden_at' => '2026-06-03 12:00:00+00']);

    // June's family bill: this student's two lines and the sibling's one, part paid.
    [$this->june] = $this->createInvoice($this->academy, $this->parent, ['kind' => 'AUTO', 'period_month' => 6, 'total_minor' => 50000, 'subtotal_minor' => 50000, 'amount_paid_minor' => 10000]);
    $line = fn (string $student, int $amount) => DB::table('invoice_line_items')->insert(['id' => (string) Str::uuid(), 'academy_id' => $this->academy,
        'invoice_id' => $this->june, 'student_id' => $student, 'description' => 'Lesson', 'amount_minor' => $amount, 'currency' => 'EGP']);
    $this->asAcademy($this->academy);
    $line($this->student, 20000);
    $line($this->student, 20000);
    $line($this->sibling, 10000);
    // May, unpaid on the family; an old void bill that is not owed.
    $this->createInvoice($this->academy, $this->parent, ['period_month' => 5, 'status' => 'CLOSED', 'total_minor' => 30000, 'subtotal_minor' => 30000]);
    $this->createInvoice($this->academy, $this->parent, ['period_month' => 4, 'status' => 'VOID', 'total_minor' => 99900, 'subtotal_minor' => 99900]);
});

it('summarises the running month: lessons against the bill and what the family owes', function () {
    Sanctum::actingAs($this->owner);
    $res = $this->getJson("/api/students/{$this->student}/subscription/month")->assertOk();

    expect($res->json('month'))->toBe('2026-06');
    expect($res->json('lessons'))->toBe(['taught' => 3, 'taught_minutes' => 120, 'cancelled' => 1, 'upcoming' => 1, 'unmarked' => 1]);
    expect($res->json('next_lesson_at'))->toBe('2026-06-15T10:00:00+00:00');

    expect($res->json('bill'))->toMatchArray([
        'id' => $this->june, 'state' => 'PARTIAL', 'total_minor' => 50000, 'own_minor' => 40000,
        'paid_minor' => 10000, 'due_minor' => 40000, 'shared' => true,
    ]);
    // June's 40000 left + May's 30000; the void bill is not owed.
    expect($res->json('family_due'))->toBe([['currency' => 'EGP', 'due_minor' => 70000]]);
});

it('has no bill before anything was billed this month', function () {
    Carbon::setTestNow('2026-07-02 12:00:00');
    Sanctum::actingAs($this->owner);
    $res = $this->getJson("/api/students/{$this->student}/subscription/month")->assertOk();

    expect($res->json('month'))->toBe('2026-07');
    expect($res->json('lessons.taught'))->toBe(0);
    expect($res->json('bill'))->toBeNull();
    expect($res->json('next_lesson_at'))->toBeNull();
});

it('404s for a student that does not exist', function () {
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/students/'.Str::uuid().'/subscription/month')->assertNotFound();
});
