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
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'plan_id' => $proPlan,
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'duration-owner@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'duration-teacher@test.local']);
    $this->teacher = $this->createTeacher($this->academy, [
        'user_id' => $this->teacherUser->id,
        'session_rate_minor' => 12000,
        'currency' => 'EGP',
    ]);
    $this->student = $this->createStudent($this->academy);
    $this->asAcademy($this->academy);

    $this->attendedSession = function (int $minutes = 30): string {
        $id = $this->createSession($this->academy, $this->student, $this->teacher, [
            'scheduled_at_utc' => '2026-06-02 10:00:00+00',
            'duration_minutes' => $minutes,
            'status' => 'SCHEDULED',
        ]);
        Sanctum::actingAs($this->owner);
        $this->postJson("/api/sessions/{$id}/attendance", ['status' => 'ATTENDED'])->assertOk();

        return $id;
    };
});

afterEach(fn () => Carbon::setTestNow());

function durationSubscription(object $test, string $basis = 'PER_HOUR'): void
{
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $test->academy,
        'student_id' => $test->student,
        'plan_label' => 'Duration plan',
        'price_minor' => 6000,
        'currency' => 'EGP',
        'price_basis' => $basis,
        'sessions_per_month' => null,
        'status' => 'ACTIVE',
        'start_date' => '2026-01-01',
    ]);
}

it('previews and atomically updates an open invoice and teacher salary', function () {
    durationSubscription($this);
    $session = ($this->attendedSession)();

    // Correcting duration must preserve the rate captured when attendance was recorded.
    $this->asAcademy($this->academy);
    DB::table('teachers')->where('id', $this->teacher)->update(['session_rate_minor' => 18000]);
    DB::table('subscriptions')->where('student_id', $this->student)->update(['price_minor' => 9000]);
    Sanctum::actingAs($this->owner);

    $preview = $this->getJson("/api/sessions/{$session}/duration-preview?duration_minutes=60")
        ->assertOk()
        ->assertJsonPath('can_change', true)
        ->assertJsonPath('invoice.amount_before', 3000)
        ->assertJsonPath('invoice.amount_after', 6000)
        ->assertJsonPath('payout.amount_before', 6000)
        ->assertJsonPath('payout.amount_after', 12000);

    expect($preview->json('package'))->toBeNull();

    $this->patchJson("/api/sessions/{$session}/duration", ['duration_minutes' => 60])
        ->assertOk();

    $this->asAcademy($this->academy);
    $invoiceLine = DB::table('invoice_line_items')->where('session_id', $session)->first();
    $payoutLine = DB::table('payout_line_items')->where('session_id', $session)->first();
    expect((int) DB::table('sessions')->where('id', $session)->value('duration_minutes'))->toBe(60)
        ->and((int) $invoiceLine->amount_minor)->toBe(6000)
        ->and((int) DB::table('invoices')->where('id', $invoiceLine->invoice_id)->value('total_minor'))->toBe(6000)
        ->and((int) $payoutLine->amount_minor)->toBe(12000)
        ->and((int) DB::table('payouts')->where('id', $payoutLine->payout_id)->value('total_minor'))->toBe(12000);
});

it('updates package consumption and teacher salary without changing the package price', function () {
    durationSubscription($this, 'PER_PACKAGE');
    $package = app(LessonPackages::class)->open([
        'student_id' => $this->student,
        'label' => 'Four hours',
        'minutes_total' => 240,
        'price_minor' => 24000,
        'currency' => 'EGP',
        'bill_timing' => 'ON_START',
        'starts_on' => '2026-06-01',
    ], (string) $this->owner->id, 'ACADEMY_OWNER');
    $session = ($this->attendedSession)();

    $this->getJson("/api/sessions/{$session}/duration-preview?duration_minutes=60")
        ->assertOk()
        ->assertJsonPath('package.consumed_before', 30)
        ->assertJsonPath('package.consumed_after', 60)
        ->assertJsonPath('package.remaining_after', 180)
        ->assertJsonPath('invoice', null);

    $this->patchJson("/api/sessions/{$session}/duration", ['duration_minutes' => 60])->assertOk();

    $this->asAcademy($this->academy);
    expect((int) DB::table('lesson_packages')->where('id', $package['package_id'])->value('minutes_consumed'))->toBe(60)
        ->and((int) DB::table('lesson_package_credits')->where('session_id', $session)->value('minutes'))->toBe(60)
        ->and((int) DB::table('invoices')->where('id', $package['invoice_id'])->value('total_minor'))->toBe(24000)
        ->and((int) DB::table('payout_line_items')->where('session_id', $session)->value('amount_minor'))->toBe(12000);
});

it('blocks the correction when the student invoice is closed', function () {
    durationSubscription($this);
    $session = ($this->attendedSession)();

    $this->asAcademy($this->academy);
    $invoiceId = DB::table('invoice_line_items')->where('session_id', $session)->value('invoice_id');
    DB::table('invoices')->where('id', $invoiceId)->update(['status' => 'CLOSED', 'closed_at' => now()]);
    Sanctum::actingAs($this->owner);

    $this->getJson("/api/sessions/{$session}/duration-preview?duration_minutes=60")
        ->assertOk()
        ->assertJsonPath('can_change', false)
        ->assertJsonFragment(['INVOICE_LOCKED']);
    $this->patchJson("/api/sessions/{$session}/duration", ['duration_minutes' => 60])
        ->assertStatus(422)
        ->assertJsonValidationErrors('duration_minutes');

    $this->asAcademy($this->academy);
    expect((int) DB::table('sessions')->where('id', $session)->value('duration_minutes'))->toBe(30);
});

it('blocks the correction when the teacher payout is finalized', function () {
    durationSubscription($this);
    $session = ($this->attendedSession)();

    $this->asAcademy($this->academy);
    $payoutId = DB::table('payout_line_items')->where('session_id', $session)->value('payout_id');
    DB::table('payouts')->where('id', $payoutId)->update(['finalized_at' => now()]);
    Sanctum::actingAs($this->owner);

    $this->getJson("/api/sessions/{$session}/duration-preview?duration_minutes=60")
        ->assertOk()
        ->assertJsonPath('can_change', false)
        ->assertJsonFragment(['PAYOUT_FINALIZED']);
    $this->patchJson("/api/sessions/{$session}/duration", ['duration_minutes' => 60])
        ->assertStatus(422)
        ->assertJsonValidationErrors('duration_minutes');

    $this->asAcademy($this->academy);
    expect((int) DB::table('sessions')->where('id', $session)->value('duration_minutes'))->toBe(30);
});

it('does not let a teacher change an attended lesson duration', function () {
    durationSubscription($this);
    $session = ($this->attendedSession)();
    Sanctum::actingAs($this->teacherUser);

    $this->patchJson("/api/sessions/{$session}/duration", ['duration_minutes' => 60])
        ->assertForbidden();
});
