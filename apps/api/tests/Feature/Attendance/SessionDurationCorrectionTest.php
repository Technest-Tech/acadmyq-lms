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

    // One attended lesson on the given day of the month, leaving the tenant context set.
    $this->blockLesson = function (int $day, int $minutes = 60): string {
        $this->asAcademy($this->academy);
        $id = $this->createSession($this->academy, $this->student, $this->teacher, [
            'scheduled_at_utc' => sprintf('2026-06-%02d 10:00:00+00', $day),
            'duration_minutes' => $minutes,
            'status' => 'SCHEDULED',
        ]);
        Sanctum::actingAs($this->owner);
        $this->postJson("/api/sessions/{$id}/attendance", ['status' => 'ATTENDED'])->assertOk();
        $this->asAcademy($this->academy);

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

/**
 * A six-hour block made to run out by a 60-minute lesson that was really 30: five 60s + the wrong one.
 * Returns [block id, its bill, the wrong lesson].
 *
 * @return array{0:string,1:?string,2:string}
 */
function ranOutBlock(object $test, array $terms = []): array
{
    durationSubscription($test, 'PER_PACKAGE');
    $opened = app(LessonPackages::class)->open($terms + [
        'student_id' => $test->student,
        'label' => '6 hours',
        'minutes_total' => 360,
        'price_minor' => 36000,
        'currency' => 'EGP',
        'bill_timing' => 'ON_START',
        'starts_on' => '2026-06-01',
    ], (string) $test->owner->id, 'ACADEMY_OWNER');

    $wrong = '';
    foreach (range(1, 6) as $day) {
        $wrong = blockLesson($test, $day);
    }

    return [$opened['package_id'], $opened['invoice_id'], $wrong];
}

function blockLesson(object $test, int $day, int $minutes = 60): string
{
    return ($test->blockLesson)($day, $minutes);
}

function blockRow(string $id): object
{
    return DB::table('lesson_packages')->where('id', $id)->first();
}

function renewalOf(object $test, string $blockId): object
{
    return DB::table('lesson_packages')
        ->where('student_id', $test->student)
        ->where('sequence_no', '>', blockRow($blockId)->sequence_no)
        ->orderBy('sequence_no')
        ->first();
}

it('re-opens a block that ran out only because a lesson was too long, and undoes its renewal and bill', function () {
    [$block, $bill, $lesson] = ranOutBlock($this);
    $renewal = renewalOf($this, $block);
    expect(blockRow($block)->status)->toBe('COMPLETED')
        ->and($renewal->status)->toBe('ACTIVE');
    Sanctum::actingAs($this->owner);

    // The renewal's bill is what the family was wrongly shown as owing.
    expect(collect($this->getJson('/api/packages?scope=due')->assertOk()->json('packages'))->pluck('id'))->toContain($renewal->id);

    $this->getJson("/api/sessions/{$lesson}/duration-preview?duration_minutes=30")
        ->assertOk()
        ->assertJsonPath('can_change', true)
        ->assertJsonPath('package.consumed_after', 330)
        ->assertJsonPath('package.remaining_after', 30)
        ->assertJsonPath('package.reopens', true)
        ->assertJsonPath('package.renewal_undone.sequence_no', (int) $renewal->sequence_no)
        ->assertJsonPath('package.renewal_undone.amount_minor', 36000)
        ->assertJsonPath('payout.amount_before', 12000)
        ->assertJsonPath('payout.amount_after', 6000);

    $this->patchJson("/api/sessions/{$lesson}/duration", ['duration_minutes' => 30])->assertOk();

    $this->asAcademy($this->academy);
    $row = blockRow($block);
    expect($row->status)->toBe('ACTIVE')
        ->and($row->closed_at)->toBeNull()
        ->and($row->closed_reason)->toBeNull()
        ->and((int) $row->minutes_consumed)->toBe(330)
        ->and((int) DB::table('lesson_package_credits')->where('session_id', $lesson)->value('minutes'))->toBe(30)
        ->and(blockRow($renewal->id)->status)->toBe('CANCELLED')
        ->and(DB::table('invoices')->where('id', $renewal->invoice_id)->value('status'))->toBe('VOID')
        // Its own bill is the block it really bought: untouched.
        ->and(DB::table('invoices')->where('id', $bill)->value('status'))->not->toBe('VOID')
        ->and((int) DB::table('sessions')->where('id', $lesson)->value('duration_minutes'))->toBe(30);

    Sanctum::actingAs($this->owner);
    expect(collect($this->getJson('/api/packages?scope=due')->assertOk()->json('packages'))->pluck('id'))->not->toContain($renewal->id);

    // The freed half hour is really there: the next lesson draws on it and the block ends again,
    // this time telling the owner, and renews.
    $this->asAcademy($this->academy);
    $endedAlerts = fn () => DB::table('notifications')->where('subject_id', $block)->where('type', 'PACKAGE_COMPLETED')->count();
    expect($endedAlerts())->toBe(0);
    blockLesson($this, 8, 30);
    expect($endedAlerts())->toBe(1)
        ->and(blockRow($block)->status)->toBe('COMPLETED')
        ->and((int) blockRow($block)->minutes_consumed)->toBe(360)
        ->and(DB::table('lesson_packages')->where('student_id', $this->student)->where('status', 'ACTIVE')->count())->toBe(1);
});

it('voids the undone renewal\'s bill even after its month closed', function () {
    [$block, , $lesson] = ranOutBlock($this);
    $renewal = renewalOf($this, $block);
    DB::table('invoices')->where('id', $renewal->invoice_id)->update(['status' => 'CLOSED', 'closed_at' => now()]);
    Sanctum::actingAs($this->owner);

    $this->patchJson("/api/sessions/{$lesson}/duration", ['duration_minutes' => 30])->assertOk();

    $this->asAcademy($this->academy);
    expect(blockRow($block)->status)->toBe('ACTIVE')
        ->and(DB::table('invoices')->where('id', $renewal->invoice_id)->value('status'))->toBe('VOID');
});

it('brings lessons back from the renewal in date order until the old block is full', function () {
    [$block, , $lesson] = ranOutBlock($this);
    $renewal = renewalOf($this, $block);
    // Marked out of order: the earlier date is still the one that belongs on the old block.
    $later = blockLesson($this, 9);
    $earlier = blockLesson($this, 8, 30);
    $payLine = (int) DB::table('payout_line_items')->where('session_id', $earlier)->value('amount_minor');
    Sanctum::actingAs($this->owner);

    $this->getJson("/api/sessions/{$lesson}/duration-preview?duration_minutes=30")
        ->assertOk()
        ->assertJsonPath('can_change', true)
        ->assertJsonPath('package.consumed_after', 360)
        ->assertJsonPath('package.remaining_after', 0)
        ->assertJsonPath('package.reopens', false)
        ->assertJsonPath('package.stays_closed', null)
        ->assertJsonPath('package.block_moves', true)
        ->assertJsonPath('package.lessons_moved_back.sequence_no', (int) $renewal->sequence_no)
        ->assertJsonPath('package.lessons_moved_back.lessons', 1)
        ->assertJsonPath('package.lessons_moved_back.remaining_after', 300);

    $this->patchJson("/api/sessions/{$lesson}/duration", ['duration_minutes' => 30])->assertOk();

    $this->asAcademy($this->academy);
    $old = blockRow($block);
    $next = blockRow($renewal->id);
    expect($old->status)->toBe('COMPLETED')
        ->and((int) $old->minutes_consumed)->toBe(360)
        ->and((int) $old->minutes_overdrawn)->toBe(0)
        ->and((string) DB::table('lesson_package_credits')->where('session_id', $earlier)->value('package_id'))->toBe($block)
        ->and((string) DB::table('lesson_package_credits')->where('session_id', $later)->value('package_id'))->toBe((string) $renewal->id)
        ->and($next->status)->toBe('ACTIVE')
        ->and((int) $next->minutes_consumed)->toBe(60)
        ->and(DB::table('invoices')->where('id', $renewal->invoice_id)->value('status'))->toBe('OPEN')
        // The teacher is paid for the lesson wherever it sits.
        ->and((int) DB::table('payout_line_items')->where('session_id', $earlier)->value('amount_minor'))->toBe($payLine);
});

it('re-opens the old block and undoes the renewal when every lesson on it comes back', function () {
    [$block, , $lesson] = ranOutBlock($this);
    $renewal = renewalOf($this, $block);
    $moved = blockLesson($this, 8, 15);
    Sanctum::actingAs($this->owner);

    $this->getJson("/api/sessions/{$lesson}/duration-preview?duration_minutes=30")
        ->assertOk()
        ->assertJsonPath('package.consumed_after', 345)
        ->assertJsonPath('package.remaining_after', 15)
        ->assertJsonPath('package.reopens', true)
        ->assertJsonPath('package.renewal_undone.amount_minor', 36000)
        ->assertJsonPath('package.lessons_moved_back.lessons', 1);

    $this->patchJson("/api/sessions/{$lesson}/duration", ['duration_minutes' => 30])->assertOk();

    $this->asAcademy($this->academy);
    expect(blockRow($block)->status)->toBe('ACTIVE')
        ->and((int) blockRow($block)->minutes_consumed)->toBe(345)
        ->and((string) DB::table('lesson_package_credits')->where('session_id', $moved)->value('package_id'))->toBe($block)
        ->and(blockRow($renewal->id)->status)->toBe('CANCELLED')
        ->and(DB::table('invoices')->where('id', $renewal->invoice_id)->value('status'))->toBe('VOID');

    // It carries on where it left off.
    $next = blockLesson($this, 9, 15);
    expect((string) DB::table('lesson_package_credits')->where('session_id', $next)->value('package_id'))->toBe($block)
        ->and(blockRow($block)->status)->toBe('COMPLETED');
});

it('never splits a lesson coming back: it runs over, and the renewal holds what ran over', function () {
    [$block, , $lesson] = ranOutBlock($this);
    $renewal = renewalOf($this, $block);
    $moved = blockLesson($this, 8);
    Sanctum::actingAs($this->owner);

    $this->patchJson("/api/sessions/{$lesson}/duration", ['duration_minutes' => 30])->assertOk();

    $this->asAcademy($this->academy);
    $old = blockRow($block);
    $next = blockRow($renewal->id);
    $credit = DB::table('lesson_package_credits')->where('session_id', $moved)->first();
    expect($old->status)->toBe('COMPLETED')
        ->and((int) $old->minutes_consumed)->toBe(390)
        ->and((int) $old->minutes_overdrawn)->toBe(30)
        ->and((string) $old->overdraft_absorbed_by)->toBe((string) $renewal->id)
        ->and((string) $credit->package_id)->toBe($block)
        ->and((int) $credit->minutes)->toBe(60)
        ->and((int) $credit->minutes_overdrawn)->toBe(30)
        ->and((int) $next->minutes_consumed)->toBe(30)
        ->and((int) $next->absorbed_overdraft_minutes)->toBe(30)
        ->and($next->status)->toBe('ACTIVE');
});

it('brings lessons back to a block corrected before this existed, on the same number', function () {
    [$block, , $lesson] = ranOutBlock($this);
    $renewal = renewalOf($this, $block);
    $moved = blockLesson($this, 8, 30);

    // What pressing confirm used to leave: right length, room on the old block, lessons on the new one.
    DB::table('sessions')->where('id', $lesson)->update(['duration_minutes' => 30]);
    DB::table('lesson_package_credits')->where('session_id', $lesson)->update(['minutes' => 30]);
    DB::table('lesson_packages')->where('id', $block)->update(['minutes_consumed' => 330]);
    Sanctum::actingAs($this->owner);

    $this->getJson("/api/sessions/{$lesson}/duration-preview?duration_minutes=30")
        ->assertOk()
        ->assertJsonPath('can_change', true)
        ->assertJsonPath('package.block_moves', true)
        ->assertJsonPath('package.lessons_moved_back.lessons', 1);
    $this->patchJson("/api/sessions/{$lesson}/duration", ['duration_minutes' => 30])->assertOk();

    $this->asAcademy($this->academy);
    expect((int) blockRow($block)->minutes_consumed)->toBe(360)
        ->and((string) DB::table('lesson_package_credits')->where('session_id', $moved)->value('package_id'))->toBe($block)
        ->and((int) blockRow($renewal->id)->minutes_consumed)->toBe(0);
});

it('brings lessons back from a next block opened by hand, but does not cancel it', function () {
    [$block, , $lesson] = ranOutBlock($this);
    $renewal = renewalOf($this, $block);
    DB::table('lesson_packages')->where('id', $renewal->id)->update(['opened_automatically' => false]);
    $moved = blockLesson($this, 8, 15);
    Sanctum::actingAs($this->owner);

    $this->getJson("/api/sessions/{$lesson}/duration-preview?duration_minutes=30")
        ->assertOk()
        ->assertJsonPath('package.reopens', false)
        ->assertJsonPath('package.stays_closed', 'NEXT_BLOCK_BY_HAND');
    $this->patchJson("/api/sessions/{$lesson}/duration", ['duration_minutes' => 30])->assertOk();

    $this->asAcademy($this->academy);
    expect(blockRow($block)->status)->toBe('COMPLETED')
        ->and((int) blockRow($block)->minutes_consumed)->toBe(345)
        ->and((string) DB::table('lesson_package_credits')->where('session_id', $moved)->value('package_id'))->toBe($block)
        ->and(blockRow($renewal->id)->status)->toBe('ACTIVE')
        ->and((int) blockRow($renewal->id)->minutes_consumed)->toBe(0);
});

it('keeps a renewal the family has paid towards', function () {
    [$block, , $lesson] = ranOutBlock($this);
    $renewal = renewalOf($this, $block);
    $moved = blockLesson($this, 8, 15);
    DB::table('invoices')->where('id', $renewal->invoice_id)->update(['amount_paid_minor' => 1000]);
    Sanctum::actingAs($this->owner);

    $this->getJson("/api/sessions/{$lesson}/duration-preview?duration_minutes=30")
        ->assertOk()
        ->assertJsonPath('can_change', true)
        ->assertJsonPath('package.stays_closed', 'NEXT_BLOCK_PAID');
    $this->patchJson("/api/sessions/{$lesson}/duration", ['duration_minutes' => 30])->assertOk();

    // The lesson still comes back, so the paid block keeps its whole balance for later.
    $this->asAcademy($this->academy);
    expect(blockRow($block)->status)->toBe('COMPLETED')
        ->and((string) DB::table('lesson_package_credits')->where('session_id', $moved)->value('package_id'))->toBe($block)
        ->and(blockRow($renewal->id)->status)->toBe('ACTIVE')
        ->and((int) blockRow($renewal->id)->minutes_consumed)->toBe(0);
});

it('never re-opens an older block past a finished one', function () {
    [$block, , $lesson] = ranOutBlock($this, ['minutes_total' => 360]);
    $second = renewalOf($this, $block);
    DB::table('lesson_packages')->where('id', $second->id)->update(['minutes_total' => 60]);
    blockLesson($this, 8);
    Sanctum::actingAs($this->owner);

    $this->getJson("/api/sessions/{$lesson}/duration-preview?duration_minutes=30")
        ->assertOk()
        ->assertJsonPath('package.reopens', false)
        ->assertJsonPath('package.stays_closed', 'NEXT_BLOCK_RUNNING');
});

it('takes back a bill raised at the end, and raises one again when the block really ends', function () {
    [$block, , $lesson] = ranOutBlock($this, ['bill_timing' => 'ON_COMPLETION', 'auto_renew' => false]);
    $bill = blockRow($block)->invoice_id;
    expect($bill)->not->toBeNull();
    Sanctum::actingAs($this->owner);

    $this->getJson("/api/sessions/{$lesson}/duration-preview?duration_minutes=30")
        ->assertOk()
        ->assertJsonPath('package.reopens', true)
        ->assertJsonPath('package.own_bill_voided.amount_minor', 36000);
    $this->patchJson("/api/sessions/{$lesson}/duration", ['duration_minutes' => 30])->assertOk();

    $this->asAcademy($this->academy);
    expect(blockRow($block)->status)->toBe('ACTIVE')
        ->and(blockRow($block)->invoice_id)->toBeNull()
        ->and(DB::table('invoices')->where('id', $bill)->value('status'))->toBe('VOID');

    blockLesson($this, 8, 30);
    $newBill = blockRow($block)->invoice_id;
    expect(blockRow($block)->status)->toBe('COMPLETED')
        ->and($newBill)->not->toBeNull()->not->toBe($bill)
        ->and((int) DB::table('invoices')->where('id', $newBill)->value('total_minor'))->toBe(36000);
});

it('leaves a block whose end-of-block bill was paid finished, rather than bill it twice', function () {
    [$block, , $lesson] = ranOutBlock($this, ['bill_timing' => 'ON_COMPLETION', 'auto_renew' => false]);
    $bill = blockRow($block)->invoice_id;
    DB::table('invoices')->where('id', $bill)->update(['amount_paid_minor' => 36000]);
    Sanctum::actingAs($this->owner);

    $this->getJson("/api/sessions/{$lesson}/duration-preview?duration_minutes=30")
        ->assertOk()
        ->assertJsonPath('can_change', true)
        ->assertJsonPath('package.stays_closed', 'OWN_BILL_PAID');
    $this->patchJson("/api/sessions/{$lesson}/duration", ['duration_minutes' => 30])->assertOk();

    $this->asAcademy($this->academy);
    expect(blockRow($block)->status)->toBe('COMPLETED')
        ->and((int) blockRow($block)->minutes_consumed)->toBe(330)
        ->and((string) blockRow($block)->invoice_id)->toBe((string) $bill)
        ->and(DB::table('invoices')->where('id', $bill)->value('status'))->not->toBe('VOID');
});

it('moves the overdraft the renewal absorbed when a lesson that ran over is corrected', function () {
    [$block, , $lesson] = ranOutBlock($this, ['minutes_total' => 330]);
    $renewal = renewalOf($this, $block);
    expect((int) blockRow($block)->minutes_overdrawn)->toBe(30)
        ->and((int) $renewal->absorbed_overdraft_minutes)->toBe(30)
        ->and((int) $renewal->minutes_consumed)->toBe(30);
    Sanctum::actingAs($this->owner);

    // Exactly full now: still finished, nothing over, and the renewal gets its half hour back.
    $this->patchJson("/api/sessions/{$lesson}/duration", ['duration_minutes' => 30])->assertOk();

    $this->asAcademy($this->academy);
    $row = blockRow($block);
    $after = blockRow($renewal->id);
    expect($row->status)->toBe('COMPLETED')
        ->and((int) $row->minutes_overdrawn)->toBe(0)
        ->and($row->overdraft_absorbed_by)->toBeNull()
        ->and((int) DB::table('lesson_package_credits')->where('session_id', $lesson)->value('minutes_overdrawn'))->toBe(0)
        ->and($after->status)->toBe('ACTIVE')
        ->and((int) $after->minutes_consumed)->toBe(0)
        ->and((int) $after->absorbed_overdraft_minutes)->toBe(0);
});

it('undoes a renewal that held only the absorbed overdraft once the block has room', function () {
    [$block, , $lesson] = ranOutBlock($this, ['minutes_total' => 330]);
    $renewal = renewalOf($this, $block);
    Sanctum::actingAs($this->owner);

    $this->patchJson("/api/sessions/{$lesson}/duration", ['duration_minutes' => 15])->assertOk();

    $this->asAcademy($this->academy);
    $row = blockRow($block);
    expect($row->status)->toBe('ACTIVE')
        ->and((int) $row->minutes_consumed)->toBe(315)
        ->and((int) $row->minutes_overdrawn)->toBe(0)
        ->and($row->overdraft_absorbed_by)->toBeNull()
        ->and(blockRow($renewal->id)->status)->toBe('CANCELLED');
});

it('takes extra minutes on a finished block out of the renewal', function () {
    [$block, , $lesson] = ranOutBlock($this);
    $renewal = renewalOf($this, $block);
    Sanctum::actingAs($this->owner);

    $this->getJson("/api/sessions/{$lesson}/duration-preview?duration_minutes=90")
        ->assertOk()
        ->assertJsonPath('can_change', true)
        ->assertJsonPath('package.will_complete', false)
        ->assertJsonPath('package.overdrawn_after', 30);
    $this->patchJson("/api/sessions/{$lesson}/duration", ['duration_minutes' => 90])->assertOk();

    $this->asAcademy($this->academy);
    $after = blockRow($renewal->id);
    expect((int) blockRow($block)->minutes_overdrawn)->toBe(30)
        ->and((string) blockRow($block)->overdraft_absorbed_by)->toBe((string) $renewal->id)
        ->and((int) $after->minutes_consumed)->toBe(30)
        ->and((int) $after->absorbed_overdraft_minutes)->toBe(30);
});

it('still refuses a block closed by hand, and extra minutes already on a bill', function () {
    durationSubscription($this, 'PER_PACKAGE');
    $opened = app(LessonPackages::class)->open([
        'student_id' => $this->student, 'label' => 'Six', 'minutes_total' => 360, 'price_minor' => 36000,
        'currency' => 'EGP', 'bill_timing' => 'ON_START', 'starts_on' => '2026-06-01',
    ], (string) $this->owner->id, 'ACADEMY_OWNER');
    $lesson = blockLesson($this, 1);
    app(LessonPackages::class)->complete($opened['package_id'], 'CLOSED_EARLY', (string) $this->owner->id, 'ACADEMY_OWNER');
    Sanctum::actingAs($this->owner);

    $this->getJson("/api/sessions/{$lesson}/duration-preview?duration_minutes=30")
        ->assertOk()
        ->assertJsonPath('can_change', false)
        ->assertJsonFragment(['PACKAGE_CLOSED']);
    $this->patchJson("/api/sessions/{$lesson}/duration", ['duration_minutes' => 30])->assertStatus(422);

    // Over the end, with those minutes billed: a bill this can't follow.
    $this->asAcademy($this->academy);
    DB::table('lesson_packages')->where('id', $opened['package_id'])->update([
        'closed_reason' => 'EXHAUSTED', 'minutes_total' => 30, 'minutes_overdrawn' => 30, 'minutes_consumed' => 60,
        'overdraft_invoice_id' => $opened['invoice_id'],
    ]);
    DB::table('lesson_package_credits')->where('session_id', $lesson)->update(['minutes_overdrawn' => 30]);
    Sanctum::actingAs($this->owner);

    $this->getJson("/api/sessions/{$lesson}/duration-preview?duration_minutes=30")
        ->assertOk()
        ->assertJsonPath('can_change', false)
        ->assertJsonFragment(['PACKAGE_OVERDRAFT_SETTLED']);
});

it('heals a finished block when the payroll page already corrected the lesson', function () {
    [$block, , $lesson] = ranOutBlock($this);
    $renewal = renewalOf($this, $block);
    $payout = DB::table('payout_line_items')->where('session_id', $lesson)->value('payout_id');
    Sanctum::actingAs($this->owner);

    // The salary door: the lesson and pay move, the finished block is left alone.
    $this->patchJson("/api/payouts/lessons/{$lesson}/duration", ['duration_minutes' => 30])->assertOk();
    $this->asAcademy($this->academy);
    expect((int) DB::table('sessions')->where('id', $lesson)->value('duration_minutes'))->toBe(30)
        ->and(blockRow($block)->status)->toBe('COMPLETED')
        ->and((int) blockRow($block)->minutes_consumed)->toBe(360);
    $paid = (int) DB::table('payout_line_items')->where('session_id', $lesson)->value('amount_minor');

    // A sealed statement must not get in the way: the pay is already right.
    DB::table('payouts')->where('id', $payout)->update(['finalized_at' => now()]);
    Sanctum::actingAs($this->owner);

    $this->getJson("/api/sessions/{$lesson}/duration-preview?duration_minutes=30")
        ->assertOk()
        ->assertJsonPath('can_change', true)
        ->assertJsonPath('package.consumed_after', 330)
        ->assertJsonPath('package.reopens', true);
    $this->patchJson("/api/sessions/{$lesson}/duration", ['duration_minutes' => 30])->assertOk();

    $this->asAcademy($this->academy);
    expect(blockRow($block)->status)->toBe('ACTIVE')
        ->and((int) blockRow($block)->minutes_consumed)->toBe(330)
        ->and(blockRow($renewal->id)->status)->toBe('CANCELLED')
        ->and((int) DB::table('payout_line_items')->where('session_id', $lesson)->value('amount_minor'))->toBe($paid);

    // Nothing left to do: a second press changes nothing.
    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/sessions/{$lesson}/duration", ['duration_minutes' => 30])->assertOk();
    $this->asAcademy($this->academy);
    expect((int) blockRow($block)->minutes_consumed)->toBe(330);
});

it('does not let a teacher change an attended lesson duration', function () {
    durationSubscription($this);
    $session = ($this->attendedSession)();
    Sanctum::actingAs($this->teacherUser);

    $this->patchJson("/api/sessions/{$session}/duration", ['duration_minutes' => 60])
        ->assertForbidden();
});
