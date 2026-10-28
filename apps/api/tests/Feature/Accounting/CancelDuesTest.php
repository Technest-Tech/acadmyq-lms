<?php

declare(strict_types=1);

use App\Jobs\BillGroupMonthsJob;
use App\Services\ClassGroups;
use App\Services\GroupBilling;
use App\Services\ModuleBilling;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * A family suspended, and the dues raised ahead (docs/groups/01-ACCOUNTING.md): suspending takes
 * the children off their groups' sheets and can let go of what was billed ahead; any one charge can
 * be let go from the family card — what was paid stays paid, the line stays so nothing raises it
 * again, a private subscription's bill takes the subscription with it. Plus a subscription sold in
 * lessons remembers the lesson's length.
 */
beforeEach(function () {
    Storage::fake('local');
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'invoice_grouping' => 'PER_GUARDIAN']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-dues@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona', 'session_rate_minor' => 6000, 'currency' => 'EGP']);
    $this->parent = $this->createGuardian($this->academy, ['full_name' => 'Parent of two']);
    $this->adam = $this->createStudent($this->academy, $this->parent, ['full_name' => 'Adam', 'status' => 'REGULAR']);
    $this->other = $this->createGuardian($this->academy, ['full_name' => 'Other parent']);
    $this->dina = $this->createStudent($this->academy, $this->other, ['full_name' => 'Dina', 'status' => 'REGULAR']);
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    // May and June are billed on the spot: 450 each, for Adam and for Dina.
    $this->groupId = $this->postJson('/api/groups', [
        'name' => 'English A1', 'teacher_id' => $this->teacher, 'start_date' => '2026-05-01',
        'slots' => [['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60]],
        'billing_mode' => 'MONTHLY', 'price_minor' => 45000, 'currency' => 'EGP',
        'student_ids' => [$this->adam, $this->dina],
    ])->assertCreated()->json('group.id');
});

afterEach(fn () => Carbon::setTestNow());

/** A curriculum centre on the accounts by default; `$switches` picks the opt-in capabilities. */
function cdOn(string $academyId, array $switches = ['accounting', 'centre']): void
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    try {
        app(ModuleBilling::class)->setDisabledFeatures($academyId, 'MANAGEMENT', [], $switches);
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

function cdTenant(string $academyId, callable $fn): mixed
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'ACADEMY_OWNER', true)");
    try {
        return $fn();
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

function cdLine($test, string $student, string $period): object
{
    return cdTenant($test->academy, fn () => DB::table('invoice_line_items')->where('class_group_id', $test->groupId)->where('student_id', $student)->where('group_period', $period)->first());
}

it('lists the dues raised ahead, and suspending lets go of the ones ticked — off the bill, never raised again', function () {
    cdOn($this->academy);
    Sanctum::actingAs($this->owner);

    // Only June is ahead (May's lessons were had); only this family's.
    $dues = $this->getJson("/api/guardians/{$this->parent}/advance-dues")->assertOk();
    expect($dues->json('can_cancel'))->toBeTrue();
    expect($dues->json('dues'))->toHaveCount(1);
    expect($dues->json('dues.0'))->toMatchArray(['student_name' => 'Adam', 'kind' => 'GROUP', 'remaining_minor' => 45000, 'currency' => 'EGP']);
    $june = $dues->json('dues.0.id');

    // Another family's line slipped in is ignored.
    $dinaJune = (string) cdLine($this, $this->dina, '2026-06-01')->id;
    $res = $this->postJson("/api/guardians/{$this->parent}/suspend", ['cancel_line_ids' => [$june, $dinaJune]])->assertOk();
    expect($res->json('cancelled'))->toBe([['currency' => 'EGP', 'amount_minor' => 45000]]);

    $line = cdLine($this, $this->adam, '2026-06-01');
    expect((int) $line->amount_minor)->toBe(0)->and((int) $line->cancelled_minor)->toBe(45000)->and($line->cancel_reason)->toContain('suspended');
    // June's bill held Adam's June alone: its total follows the line down.
    expect((int) cdTenant($this->academy, fn () => DB::table('invoices')->where('id', $line->invoice_id)->value('total_minor')))->toBe(0);
    expect((int) cdLine($this, $this->adam, '2026-05-01')->amount_minor)->toBe(45000);
    expect((int) cdLine($this, $this->dina, '2026-06-01')->amount_minor)->toBe(45000);
    // The family owes May only.
    expect($this->getJson("/api/accounting/family/{$this->parent}")->assertOk()->json('balance.0.due_minor'))->toBe(45000);

    // The nightly billing finds June's line and raises nothing; a discount given later leaves it alone.
    (new BillGroupMonthsJob(onlyAcademyId: $this->academy))->handle(app(GroupBilling::class));
    expect(cdTenant($this->academy, fn () => DB::table('invoice_line_items')->where('class_group_id', $this->groupId)->where('student_id', $this->adam)->count()))->toBe(2);
    $this->postJson("/api/accounting/family/{$this->parent}/discounts", ['kind' => 'PERCENT', 'value' => 10, 'label' => 'Sibling', 'apply_to_existing' => true])->assertCreated();
    expect((int) cdLine($this, $this->adam, '2026-06-01')->amount_minor)->toBe(0);
    expect((int) cdLine($this, $this->adam, '2026-05-01')->amount_minor)->toBe(40500);
});

it('takes a suspended family’s children off their groups’ sheets from the day it was suspended', function () {
    cdOn($this->academy, ['centre']);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/guardians/{$this->parent}/suspend")->assertOk();
    $suspendedOn = Carbon::now('Africa/Cairo')->toDateString();

    // Who a lesson of the group on that day expects (an unmarked lesson: the members alone).
    $roster = fn (string $date) => cdTenant($this->academy, fn () => app(ClassGroups::class)->roster((object) [
        'id' => (string) \Illuminate\Support\Str::uuid(), 'group_id' => $this->groupId, 'academy_id' => $this->academy, 'occurrence_local_date' => $date,
    ])->pluck('full_name')->all());
    expect($roster('2026-06-15'))->toBe(['Adam', 'Dina']);
    expect($roster($suspendedOn))->toBe(['Dina']);
    expect($roster('2026-06-22'))->toBe(['Dina']);

    // Back from the suspension, back on the sheet.
    $this->postJson("/api/guardians/{$this->parent}/resume")->assertOk();
    expect($roster('2026-06-22'))->toBe(['Adam', 'Dina']);
});

it('lets one charge go from the family card — what was paid stays paid', function () {
    cdOn($this->academy);
    Sanctum::actingAs($this->owner);
    // 600 paid: May in full (450), 150 toward June.
    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 60000, 'method' => 'CASH'])->assertCreated();
    $june = cdLine($this, $this->adam, '2026-06-01');

    $this->postJson("/api/accounting/family/{$this->parent}/charges/{$june->id}/cancel", ['reason' => 'Stopped mid-month'])->assertOk()
        ->assertJsonPath('cancelled', ['lines' => 1, 'cancelled_minor' => 30000, 'currency' => 'EGP']);
    $june = cdLine($this, $this->adam, '2026-06-01');
    expect((int) $june->amount_minor)->toBe(15000)->and((int) $june->cancelled_minor)->toBe(30000)->and($june->cancel_reason)->toBe('Stopped mid-month');
    // Square: nothing owed, no credit (an empty balance list).
    expect($this->getJson("/api/accounting/family/{$this->parent}")->json('balance'))->toBe([]);

    // Nothing left to let go; a closed bill's charge, or another family's, is refused.
    $this->postJson("/api/accounting/family/{$this->parent}/charges/{$june->id}/cancel")->assertStatus(422);
    $dinaJune = cdLine($this, $this->dina, '2026-06-01');
    $this->postJson("/api/accounting/family/{$this->parent}/charges/{$dinaJune->id}/cancel")->assertNotFound();
    $may = cdLine($this, $this->dina, '2026-05-01');
    cdTenant($this->academy, fn () => app(\App\Services\Invoicing::class)->closeInvoice((string) $may->invoice_id, $this->academy, (string) $this->owner->id, 'ACADEMY_OWNER'));
    $this->postJson("/api/accounting/family/{$this->other}/charges/{$may->id}/cancel")->assertStatus(422);

    // A role that cannot take money cannot let it go.
    Sanctum::actingAs($this->makeUser($this->academy, 'CUSTOMER_SERVICE', ['email' => 'desk-dues@test.local']));
    $this->postJson("/api/accounting/family/{$this->other}/charges/{$dinaJune->id}/cancel")->assertForbidden();
});

it('lets a private subscription’s bill go with the subscription — cancelled when unused, closed when used', function () {
    cdOn($this->academy);
    Sanctum::actingAs($this->owner);
    $open = fn (string $label) => $this->postJson('/api/packages', [
        'student_id' => $this->adam, 'label' => $label, 'hours' => 8 * 40 / 60, 'lesson_minutes' => 40, 'price_minor' => 72000, 'currency' => 'EGP',
    ])->assertCreated()->json();

    // Unused and unpaid: the subscription is cancelled and its bill voided.
    $first = $open('Maths');
    expect(collect($this->getJson("/api/guardians/{$this->parent}/advance-dues")->json('dues'))->firstWhere('kind', 'PACKAGE'))
        ->toMatchArray(['remaining_minor' => 72000]);
    $lineId = cdTenant($this->academy, fn () => DB::table('invoice_line_items')->where('invoice_id', $first['invoice_id'])->value('id'));
    $this->postJson("/api/accounting/family/{$this->parent}/charges/{$lineId}/cancel")->assertOk()->assertJsonPath('cancelled.cancelled_minor', 72000);
    expect(cdTenant($this->academy, fn () => DB::table('lesson_packages')->where('id', $first['id'])->value('status')))->toBe('CANCELLED');
    expect(cdTenant($this->academy, fn () => DB::table('invoices')->where('id', $first['invoice_id'])->value('status')))->toBe('VOID');

    // Used (two 40-minute lessons) and part-paid: closed where it stands, the rest let go, no renewal.
    $second = $open('Maths again');
    cdTenant($this->academy, fn () => DB::table('lesson_packages')->where('id', $second['id'])->update(['minutes_consumed' => 80]));
    $this->postJson('/api/receipts', ['student_id' => $this->adam, 'amount_minor' => 10000, 'method' => 'CASH'])->assertCreated();
    $lineId = cdTenant($this->academy, fn () => DB::table('invoice_line_items')->where('invoice_id', $second['invoice_id'])->value('id'));
    $paid = (int) cdTenant($this->academy, fn () => DB::table('receipt_allocations')->where('invoice_line_id', $lineId)->sum('amount_minor'));
    $this->postJson("/api/accounting/family/{$this->parent}/charges/{$lineId}/cancel")->assertOk()->assertJsonPath('cancelled.cancelled_minor', 72000 - $paid);
    $package = cdTenant($this->academy, fn () => DB::table('lesson_packages')->where('id', $second['id'])->first());
    expect($package->status)->toBe('COMPLETED')->and((bool) $package->auto_renew)->toBeFalse()->and($package->closed_reason)->toBe('CHARGE_CANCELLED');
    expect(cdTenant($this->academy, fn () => DB::table('lesson_packages')->where('student_id', $this->adam)->where('status', 'ACTIVE')->count()))->toBe(0);
    expect((int) cdTenant($this->academy, fn () => DB::table('invoice_line_items')->where('id', $lineId)->value('amount_minor')))->toBe($paid);
});

it('stays out of reach for an academy without accounting', function () {
    Sanctum::actingAs($this->owner);
    $this->getJson("/api/guardians/{$this->parent}/advance-dues")->assertOk()->assertJsonPath('dues', []);
    $june = cdLine($this, $this->adam, '2026-06-01');
    $this->postJson("/api/accounting/family/{$this->parent}/charges/{$june->id}/cancel")->assertStatus(402);
    // Suspending works as it always has, and a ticked line is not touched.
    $this->postJson("/api/guardians/{$this->parent}/suspend", ['cancel_line_ids' => [(string) $june->id]])->assertOk()->assertJsonPath('cancelled', []);
    expect((int) cdLine($this, $this->adam, '2026-06-01')->amount_minor)->toBe(45000);
});

it('remembers the length of the lessons a subscription was sold in, through edits and the next block', function () {
    Sanctum::actingAs($this->owner);
    $pkg = $this->postJson('/api/packages', [
        'student_id' => $this->adam, 'label' => '8 lessons', 'hours' => 8 * 40 / 60, 'lesson_minutes' => 40, 'price_minor' => 72000, 'currency' => 'EGP',
    ])->assertCreated()->json();
    $row = $this->getJson("/api/packages/{$pkg['id']}")->assertOk()->json('package');
    expect($row)->toMatchArray(['lesson_minutes' => 40, 'minutes_total' => 320, 'price_minor' => 72000]);

    $this->patchJson("/api/packages/{$pkg['id']}", ['lesson_minutes' => 45, 'hours' => 6])->assertOk();
    expect($this->getJson("/api/packages/{$pkg['id']}")->json('package'))->toMatchArray(['lesson_minutes' => 45, 'minutes_total' => 360]);
    $this->patchJson("/api/packages/{$pkg['id']}", ['lesson_minutes' => 3])->assertStatus(422);

    // Parked for the next block, and carried into it.
    $this->patchJson("/api/packages/{$pkg['id']}", ['lesson_minutes' => 60, 'applies_to' => 'NEXT'])->assertOk();
    expect($this->getJson("/api/packages/{$pkg['id']}")->json('package.lesson_minutes'))->toBe(45);
    $next = cdTenant($this->academy, function () use ($pkg) {
        DB::table('lesson_packages')->where('id', $pkg['id'])->update(['status' => 'COMPLETED', 'closed_at' => now()]);
        $finished = DB::table('lesson_packages')->where('id', $pkg['id'])->first();
        $method = new ReflectionMethod(\App\Services\LessonPackages::class, 'renew');

        return $method->invoke(app(\App\Services\LessonPackages::class), $finished, null, null);
    });
    expect(cdTenant($this->academy, fn () => DB::table('lesson_packages')->where('id', $next)->value('lesson_minutes')))->toBe(60);
});

it('changes nothing for an academy that is not a centre — on the accounts or not', function () {
    // A Quran academy on the accounts: no `centre`.
    cdOn($this->academy, ['accounting']);
    Sanctum::actingAs($this->owner);
    $june = cdLine($this, $this->adam, '2026-06-01');

    // No dues offered, none let go — from the suspend dialog or from a charge.
    $this->getJson("/api/guardians/{$this->parent}/advance-dues")->assertOk()->assertJsonPath('dues', []);
    $this->postJson("/api/accounting/family/{$this->parent}/charges/{$june->id}/cancel")->assertStatus(422);
    $this->postJson("/api/guardians/{$this->parent}/suspend", ['cancel_line_ids' => [(string) $june->id]])->assertOk()->assertJsonPath('cancelled', []);
    expect((int) cdLine($this, $this->adam, '2026-06-01')->amount_minor)->toBe(45000);

    // The suspended family's child stays on the group's sheet, as before.
    $roster = cdTenant($this->academy, fn () => app(ClassGroups::class)->roster((object) [
        'id' => (string) \Illuminate\Support\Str::uuid(), 'group_id' => $this->groupId, 'academy_id' => $this->academy, 'occurrence_local_date' => '2026-06-22',
    ])->pluck('full_name')->all());
    expect($roster)->toBe(['Adam', 'Dina']);

    // A prepaid block closed early is never put up for settlement; the family card offers none of it.
    $pkg = $this->postJson('/api/packages', ['student_id' => $this->dina, 'label' => '10 hours', 'hours' => 10, 'price_minor' => 100000, 'currency' => 'EGP'])->assertCreated()->json();
    $this->postJson('/api/receipts', ['guardian_id' => $this->other, 'amount_minor' => 100000, 'method' => 'CASH'])->assertCreated();
    cdTenant($this->academy, fn () => DB::table('lesson_packages')->where('id', $pkg['id'])->update(['minutes_consumed' => 120]));
    $this->postJson("/api/packages/{$pkg['id']}/close")->assertOk();
    expect(cdTenant($this->academy, fn () => DB::table('lesson_packages')->where('id', $pkg['id'])->value('settlement')))->toBeNull();
    $this->getJson("/api/packages/{$pkg['id']}/settlement")->assertOk()->assertJsonPath('preview', null);
    $card = $this->getJson("/api/accounting/family/{$this->other}")->assertOk();
    expect($card->json('unsettled'))->toBe([])->and($card->json('can_refund'))->toBeFalse()->and($card->json('can_settle'))->toBeFalse();
});

it('never lets a closed bill’s total change outside a settlement — on any connection', function () {
    $may = cdLine($this, $this->adam, '2026-05-01');
    cdTenant($this->academy, fn () => app(\App\Services\Invoicing::class)->closeInvoice((string) $may->invoice_id, $this->academy, (string) $this->owner->id, 'ACADEMY_OWNER'));
    // In its own savepoint, so the refusal is what surfaces (and the test's connection survives it).
    expect(fn () => cdTenant($this->academy, fn () => DB::transaction(fn () => DB::table('invoices')->where('id', $may->invoice_id)->update(['total_minor' => 1, 'subtotal_minor' => 1]))))
        ->toThrow(\Illuminate\Database\QueryException::class, 'cannot modify totals of a non-open invoice');
});
