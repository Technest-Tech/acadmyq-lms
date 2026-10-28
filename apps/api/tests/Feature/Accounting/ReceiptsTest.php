<?php

declare(strict_types=1);

use App\Services\GroupBilling;
use App\Services\Invoicing;
use App\Services\Ledger;
use App\Services\ModuleBilling;
use App\Support\FeatureCatalog;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * Receipts (docs/groups/01-ACCOUNTING.md, F1). The rules pinned here:
 *   - accounting is OPT-IN: an academy nobody switched on keeps the classic "mark paid", byte for byte;
 *   - switching it on turns every existing payment into a receipt without moving a single total;
 *   - a receipt is allocated to lines (chosen ones first, then oldest first) and the rest is credit,
 *     which pays the payer's next charge by itself;
 *   - a running month stays OPEN however much is paid on it; closing it lands on PAID / PARTIALLY_PAID;
 *   - a void puts the money back to unpaid, keeps its number, and lets other credit flow back in;
 *   - the group's collection sheet is exact per member, partial payments and arrears included.
 */
beforeEach(function () {
    Storage::fake('local');
    // Wednesday 17 June 2026, 12:00 Cairo.
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'invoice_grouping' => 'PER_GUARDIAN']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-acct@test.local']);
    $this->supervisor = $this->makeUser($this->academy, 'SUPERVISOR', ['email' => 'sup-acct@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 't-acct@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona', 'user_id' => $this->teacherUser->getKey(), 'session_rate_minor' => 6000, 'currency' => 'EGP']);

    $this->parent = $this->createGuardian($this->academy, ['full_name' => 'Parent of two', 'whatsapp_phone' => '+201001112223']);
    $this->adam = $this->createStudent($this->academy, $this->parent, ['full_name' => 'Adam', 'status' => 'REGULAR']);
    $this->bassel = $this->createStudent($this->academy, $this->parent, ['full_name' => 'Bassel', 'status' => 'REGULAR']);
    // Another family, one child.
    $this->celineParent = $this->createGuardian($this->academy, ['full_name' => 'Celine’s mother']);
    $this->celine = $this->createStudent($this->academy, $this->celineParent, ['full_name' => 'Celine', 'status' => 'REGULAR']);
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

function acctTenant(string $academyId, callable $fn): mixed
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

/** Switch accounting on (or off) for the academy, the way the Super Admin's client page does. */
function acctSwitch($test, bool $on): void
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$test->academy]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    try {
        app(ModuleBilling::class)->setDisabledFeatures($test->academy, 'MANAGEMENT', [], $on ? ['accounting'] : []);
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

/** A monthly group (450 EGP) the three kids are in, started on `$start`. */
function acctGroup($test, string $start = '2026-06-01', int $price = 45000): string
{
    Sanctum::actingAs($test->owner);

    return $test->postJson('/api/groups', [
        'name' => 'English A1',
        'teacher_id' => $test->teacher,
        'start_date' => $start,
        'slots' => [
            ['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60],
            ['weekday' => 3, 'start_time_local' => '17:00', 'duration_minutes' => 60],
        ],
        'billing_mode' => 'MONTHLY',
        'price_minor' => $price,
        'currency' => 'EGP',
        'student_ids' => [$test->adam, $test->bassel, $test->celine],
    ])->assertCreated()->json('group.id');
}

function acctInvoice($test, ?string $guardianId, ?string $studentId, int $month): ?object
{
    return acctTenant($test->academy, fn () => DB::table('invoices')
        ->where('kind', 'AUTO')->where('period_month', $month)
        ->when($guardianId !== null, fn ($q) => $q->where('guardian_id', $guardianId))
        ->when($studentId !== null, fn ($q) => $q->where('student_id', $studentId))
        ->first());
}

function acctLinePaid($test, string $lineId): int
{
    return (int) acctTenant($test->academy, fn () => DB::table('receipt_allocations')->where('invoice_line_id', $lineId)->sum('amount_minor'));
}

function acctCollect($test, array $body): array
{
    Sanctum::actingAs($test->owner);

    $body += ['method' => 'CASH'];
    // Anything but cash leaves a picture (a transfer screenshot) — the API insists on it.
    if ($body['method'] !== 'CASH' && ! isset($body['proof'])) {
        $body['proof'] = UploadedFile::fake()->image('proof.jpg');
    }

    return $test->post('/api/receipts', $body)->assertCreated()->json('receipt');
}

// ── The switch ───────────────────────────────────────────────────────────────

it('is opt-in: no client gets accounting until it is switched on', function () {
    expect(FeatureCatalog::OPT_IN_CAPABILITIES)->toContain('accounting');
    expect(acctTenant($this->academy, fn () => Ledger::enabledFor($this->academy)))->toBeFalse();

    acctGroup($this);
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/receipts')->assertStatus(402);
    $this->getJson('/api/payer-account?guardian_id='.$this->parent)->assertStatus(402);

    acctSwitch($this, true);
    expect(acctTenant($this->academy, fn () => Ledger::enabledFor($this->academy)))->toBeTrue();
    $this->getJson('/api/receipts')->assertOk();

    // The client page shows it as an opt-in switch, and turning it off again takes it away.
    $this->asAcademy($this->academy, 'SUPER_ADMIN');
    $overrides = json_decode((string) DB::table('module_subscriptions')->where('academy_id', $this->academy)->value('overrides'), true);
    expect($overrides['enabled'] ?? [])->toBe(['accounting'])->and($overrides['disabled'] ?? [])->toBe([]);
    $this->clearTenantContext();

    acctSwitch($this, false);
    expect(acctTenant($this->academy, fn () => Ledger::enabledFor($this->academy)))->toBeFalse();
    expect(acctTenant($this->academy, fn () => Ledger::keeps($this->academy)))->toBeFalse();

    // Switching some OTHER feature off never switches accounting on by accident.
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$this->academy]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    app(ModuleBilling::class)->setDisabledFeatures($this->academy, 'MANAGEMENT', ['certificates']);
    expect(Ledger::enabledFor($this->academy))->toBeFalse();
    // …and the client page's switch turns it on (`enabled`), then off (`disabled`).
    $admin = $this->makeUser(null, 'SUPER_ADMIN', ['email' => 'root-acct@test.local']);
    $this->clearTenantContext();
    Sanctum::actingAs($admin);
    $this->putJson("/api/admin/clients/{$this->academy}/modules/management/features", ['disabled' => ['certificates'], 'enabled' => ['accounting']])->assertOk();
    expect(acctTenant($this->academy, fn () => Ledger::keeps($this->academy)))->toBeTrue();
    $this->putJson("/api/admin/clients/{$this->academy}/modules/management/features", ['disabled' => ['certificates', 'accounting']])->assertOk();
    expect(acctTenant($this->academy, fn () => Ledger::keeps($this->academy)))->toBeFalse();
});

it('leaves the classic mark-paid untouched for an academy without accounting', function () {
    acctGroup($this);
    $invoice = acctInvoice($this, $this->parent, null, 6);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/invoices/{$invoice->id}/mark-paid", ['payment_method' => 'CASH', 'amount_paid_minor' => 30000])
        ->assertOk()->assertJsonPath('status', 'PARTIALLY_PAID')->assertJsonMissingPath('receipt');

    $after = acctInvoice($this, $this->parent, null, 6);
    expect((int) $after->amount_paid_minor)->toBe(30000)->and($after->status)->toBe('PARTIALLY_PAID');
    expect(acctTenant($this->academy, fn () => DB::table('receipts')->count()))->toBe(0);
});

it('lets a second instalment complete a part-paid invoice (it used to 500 for every academy)', function () {
    acctGroup($this);
    $invoice = acctInvoice($this, $this->parent, null, 6);
    acctTenant($this->academy, fn () => app(Invoicing::class)->closeInvoice((string) $invoice->id, $this->academy, $this->owner->id, 'ACADEMY_OWNER'));

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/invoices/{$invoice->id}/mark-paid", ['payment_method' => 'CASH', 'amount_paid_minor' => 40000])->assertOk()->assertJsonPath('status', 'PARTIALLY_PAID');
    $this->postJson("/api/invoices/{$invoice->id}/mark-paid", ['payment_method' => 'BANK_TRANSFER'])->assertOk()->assertJsonPath('status', 'PAID');

    expect((int) acctInvoice($this, $this->parent, null, 6)->amount_paid_minor)->toBe(90000);
});

it('turns the payments recorded before into receipts when switched on, without moving a total', function () {
    acctGroup($this);
    $invoice = acctInvoice($this, $this->parent, null, 6);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/invoices/{$invoice->id}/mark-paid", [
        'payment_method' => 'BANK_TRANSFER', 'amount_paid_minor' => 60000, 'payment_reference' => 'TX-77',
    ])->assertOk();

    acctSwitch($this, true);

    $receipts = acctTenant($this->academy, fn () => DB::table('receipts')->get());
    expect($receipts)->toHaveCount(1);
    expect($receipts[0]->number)->toBe('R-000001')
        ->and($receipts[0]->source)->toBe('MIGRATED')
        ->and((int) $receipts[0]->amount_minor)->toBe(60000)
        ->and($receipts[0]->method)->toBe('BANK_TRANSFER')
        ->and($receipts[0]->reference)->toBe('TX-77')
        ->and($receipts[0]->guardian_id)->toBe($this->parent);

    // Adam's line (the older one first) is fully paid, Bassel's carries the rest.
    $after = acctInvoice($this, $this->parent, null, 6);
    expect((int) $after->amount_paid_minor)->toBe(60000)->and($after->status)->toBe('PARTIALLY_PAID');
    $lines = acctTenant($this->academy, fn () => DB::table('invoice_line_items')->where('invoice_id', $invoice->id)->orderBy('created_at')->orderBy('id')->get());
    expect(array_map(fn ($l) => acctLinePaid($this, (string) $l->id), $lines->all()))->toEqualCanonicalizing([45000, 15000]);

    // Idempotent: switching on again records nothing new.
    acctSwitch($this, false);
    acctSwitch($this, true);
    expect(acctTenant($this->academy, fn () => DB::table('receipts')->count()))->toBe(1);
});

// ── Recording ────────────────────────────────────────────────────────────────

it('pays the oldest charges first and keeps a running month open', function () {
    acctSwitch($this, true);
    acctGroup($this, '2026-05-01'); // May and June, 450 each, for each kid

    $receipt = acctCollect($this, ['guardian_id' => $this->parent, 'amount_minor' => 135000, 'method' => 'INSTAPAY']);

    expect($receipt['number'])->toBe('R-000001')
        ->and($receipt['method'])->toBe('INSTAPAY')
        ->and($receipt['allocated_minor'])->toBe(135000)
        ->and($receipt['unallocated_minor'])->toBe(0)
        ->and($receipt['allocations'])->toHaveCount(3);

    // May (both kids) is paid; June has half of it paid and is still running, so still OPEN.
    $may = acctInvoice($this, $this->parent, null, 5);
    $june = acctInvoice($this, $this->parent, null, 6);
    expect((int) $may->amount_paid_minor)->toBe(90000)->and($may->status)->toBe('OPEN');
    expect((int) $june->amount_paid_minor)->toBe(45000)->and($june->status)->toBe('OPEN');

    // Closing May lands it straight on PAID.
    acctTenant($this->academy, fn () => app(Invoicing::class)->closeInvoice((string) $may->id, $this->academy, $this->owner->id, 'ACADEMY_OWNER'));
    expect(acctInvoice($this, $this->parent, null, 5)->status)->toBe('PAID');

    expect($receipt['balance_after'])->toBe([['currency' => 'EGP', 'due_minor' => 45000, 'credit_minor' => 0, 'balance_minor' => 45000]]);
});

it('pays the charges the operator ticked first', function () {
    acctSwitch($this, true);
    acctGroup($this, '2026-05-01');
    $juneBassel = acctTenant($this->academy, fn () => DB::table('invoice_line_items')
        ->where('student_id', $this->bassel)->where('group_period', '2026-06-01')->value('id'));

    $receipt = acctCollect($this, ['guardian_id' => $this->parent, 'amount_minor' => 45000, 'line_ids' => [$juneBassel]]);

    expect($receipt['allocations'])->toHaveCount(1)
        ->and($receipt['allocations'][0]['line_id'])->toBe($juneBassel);
    expect(acctLinePaid($this, $juneBassel))->toBe(45000);
});

it('refuses a ticked charge that is already paid, and records nothing', function () {
    acctSwitch($this, true);
    acctGroup($this);
    $line = acctTenant($this->academy, fn () => DB::table('invoice_line_items')->where('student_id', $this->adam)->value('id'));
    acctCollect($this, ['guardian_id' => $this->parent, 'amount_minor' => 45000, 'line_ids' => [$line]]);

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 45000, 'method' => 'CASH', 'line_ids' => [$line]])
        ->assertStatus(422)->assertJsonValidationErrors('line_ids');
    expect(acctTenant($this->academy, fn () => DB::table('receipts')->count()))->toBe(1);
});

it('keeps an overpayment as credit and spends it on the next charge by itself', function () {
    acctSwitch($this, true);
    acctGroup($this);

    // Celine's family pays 2 months ahead.
    $receipt = acctCollect($this, ['student_id' => $this->celine, 'amount_minor' => 90000]);
    expect($receipt['unallocated_minor'])->toBe(45000)
        ->and($receipt['balance_after'])->toBe([['currency' => 'EGP', 'due_minor' => 0, 'credit_minor' => 45000, 'balance_minor' => -45000]]);

    // July is billed (the nightly job) — the credit pays it with no one touching anything.
    Carbon::setTestNow('2026-07-02 09:00:00');
    acctTenant($this->academy, function () {
        $group = DB::table('class_groups')->first();
        app(GroupBilling::class)->billMonth($group, 2026, 7);
    });
    $july = acctTenant($this->academy, fn () => DB::table('invoice_line_items')->where('student_id', $this->celine)->where('group_period', '2026-07-01')->first());
    expect(acctLinePaid($this, (string) $july->id))->toBe(45000);
    // Nothing owed, nothing held: a settled account.
    expect(acctTenant($this->academy, fn () => app(Ledger::class)->balance($this->academy, ['guardian_id' => $this->celineParent])))->toBe([]);
});

it('gives a removed charge’s money back as credit for the payer’s other charges', function () {
    acctSwitch($this, true);
    $groupId = acctGroup($this, '2026-05-01');
    // Pays June for both kids only.
    $juneLines = acctTenant($this->academy, fn () => DB::table('invoice_line_items')->where('group_period', '2026-06-01')->whereIn('student_id', [$this->adam, $this->bassel])->pluck('id')->all());
    acctCollect($this, ['guardian_id' => $this->parent, 'amount_minor' => 90000, 'line_ids' => $juneLines, 'apply_rest' => false]);

    // Bassel's June charge is taken off (an open invoice) — its 450 now pays May, the oldest left.
    acctTenant($this->academy, function () use ($juneLines) {
        $line = DB::table('invoice_line_items')->where('id', $juneLines[1])->first();
        app(Invoicing::class)->removeGroupLine($line);
    });

    expect((int) acctTenant($this->academy, fn () => DB::table('receipt_allocations')->sum('amount_minor')))->toBe(90000);
    expect((int) acctInvoice($this, $this->parent, null, 5)->amount_paid_minor)->toBe(45000);
    expect((int) acctInvoice($this, $this->parent, null, 6)->amount_paid_minor)->toBe(45000);
});

it('records a receipt from the classic mark-paid once accounting is on', function () {
    acctSwitch($this, true);
    acctGroup($this);
    $invoice = acctInvoice($this, $this->parent, null, 6);

    Sanctum::actingAs($this->owner);
    $res = $this->postJson("/api/invoices/{$invoice->id}/mark-paid", ['payment_method' => 'CASH', 'amount_paid_minor' => 50000])->assertOk();
    expect($res->json('receipt.number'))->toBe('R-000001')->and($res->json('amount_paid_minor'))->toBe(50000);

    // The rest of it: the classic "paid in full".
    $this->postJson("/api/invoices/{$invoice->id}/mark-paid", ['payment_method' => 'CASH'])->assertOk()->assertJsonPath('receipt.number', 'R-000002');
    expect((int) acctInvoice($this, $this->parent, null, 6)->amount_paid_minor)->toBe(90000);

    // Nothing left to pay → a 422, not a zero receipt.
    $this->postJson("/api/invoices/{$invoice->id}/mark-paid", ['payment_method' => 'CASH'])->assertStatus(422);
});

// ── Voiding ──────────────────────────────────────────────────────────────────

it('voids a receipt: the money is unpaid again, the number stays taken, other credit flows back in', function () {
    acctSwitch($this, true);
    acctGroup($this);
    $first = acctCollect($this, ['guardian_id' => $this->parent, 'amount_minor' => 90000]);
    $second = acctCollect($this, ['guardian_id' => $this->parent, 'amount_minor' => 30000]); // all credit

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/receipts/{$first['id']}/void", ['reason' => 'Typed the wrong family'])->assertOk()
        ->assertJsonPath('receipt.voided', true)
        ->assertJsonPath('receipt.void_reason', 'Typed the wrong family');

    // The 300 of credit now pays what the void opened up; the invoice shows exactly that.
    expect((int) acctInvoice($this, $this->parent, null, 6)->amount_paid_minor)->toBe(30000);
    $this->getJson("/api/receipts/{$second['id']}")->assertOk()->assertJsonPath('receipt.unallocated_minor', 0);

    // A third receipt does not reuse R-000001.
    $third = acctCollect($this, ['guardian_id' => $this->parent, 'amount_minor' => 1000]);
    expect($third['number'])->toBe('R-000003');

    $this->postJson("/api/receipts/{$first['id']}/void", ['reason' => 'again'])->assertStatus(422);
});

it('keeps voiding and the register away from roles without money', function () {
    acctSwitch($this, true);
    acctGroup($this);
    $receipt = acctCollect($this, ['guardian_id' => $this->parent, 'amount_minor' => 1000]);

    // The supervisor collects (sees the register) but cannot take money back off the books.
    Sanctum::actingAs($this->supervisor);
    $this->getJson('/api/receipts')->assertOk();
    $this->postJson("/api/receipts/{$receipt['id']}/void", ['reason' => 'nope'])->assertForbidden();

    Sanctum::actingAs($this->makeUser($this->academy, 'CUSTOMER_SERVICE', ['email' => 'desk-receipts@test.local']));
    $this->getJson('/api/receipts')->assertForbidden();
    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 1000, 'method' => 'CASH'])->assertForbidden();
    $this->postJson("/api/receipts/{$receipt['id']}/void", ['reason' => 'nope'])->assertForbidden();

    Sanctum::actingAs($this->teacherUser);
    $this->getJson('/api/receipts')->assertForbidden();
});

it('never lets an allocation cover more than its line or spend more than its receipt', function () {
    acctSwitch($this, true);
    acctGroup($this);
    $receipt = acctCollect($this, ['student_id' => $this->celine, 'amount_minor' => 45000]);
    $line = acctTenant($this->academy, fn () => DB::table('invoice_line_items')->where('student_id', $this->adam)->first());

    expect(fn () => acctTenant($this->academy, fn () => DB::table('receipt_allocations')->insert([
        'academy_id' => $this->academy, 'receipt_id' => $receipt['id'], 'invoice_line_id' => $line->id,
        'invoice_id' => $line->invoice_id, 'amount_minor' => 1,
    ])))->toThrow(QueryException::class);
});

// ── The register, the public receipt, the group's sheet ──────────────────────

it('lists the register with totals by method and filters by group and payer', function () {
    acctSwitch($this, true);
    $groupId = acctGroup($this);
    acctCollect($this, ['guardian_id' => $this->parent, 'amount_minor' => 45000, 'method' => 'CASH']);
    acctCollect($this, ['student_id' => $this->celine, 'amount_minor' => 20000, 'method' => 'WALLET', 'reference' => 'VF-1']);

    Sanctum::actingAs($this->owner);
    $res = $this->getJson('/api/receipts')->assertOk();
    expect($res->json('receipts'))->toHaveCount(2);
    expect($res->json('totals'))->toBe([['currency' => 'EGP', 'count' => 2, 'amount_minor' => 65000, 'by_method' => ['CASH' => 45000, 'WALLET' => 20000]]]);
    expect($res->json('receipts.0.groups'))->toBe(['English A1']);
    expect($res->json('collectors.0.id'))->toBe($this->owner->id);

    expect($this->getJson('/api/receipts?q=VF-1')->json('receipts'))->toHaveCount(1);
    expect($this->getJson('/api/receipts?guardian_id='.$this->parent)->json('receipts'))->toHaveCount(1);
    expect($this->getJson("/api/receipts?group_id={$groupId}&method=WALLET")->json('meta.total'))->toBe(1);
});

it('serves the public receipt by its token, with what it paid', function () {
    acctSwitch($this, true);
    acctGroup($this);
    $receipt = acctCollect($this, ['guardian_id' => $this->parent, 'amount_minor' => 50000]);
    $token = acctTenant($this->academy, fn () => DB::table('receipts')->where('id', $receipt['id'])->value('public_token'));
    expect($receipt['public_url'])->toEndWith('/rc/'.$token);

    $this->clearTenantContext();
    $res = $this->getJson('/api/rc/'.$token)->assertOk();
    expect($res->json('number'))->toBe('R-000001')
        ->and($res->json('payer_name'))->toBe('Parent of two')
        ->and($res->json('amount_minor'))->toBe(50000)
        ->and($res->json('allocations'))->toHaveCount(2);
    $this->getJson('/api/rc/not-a-token')->assertNotFound();
});

it('gives the payer account the Collect screen works from', function () {
    acctSwitch($this, true);
    acctGroup($this);
    acctCollect($this, ['guardian_id' => $this->parent, 'amount_minor' => 10000]);

    Sanctum::actingAs($this->owner);
    $res = $this->getJson('/api/payer-account?guardian_id='.$this->parent)->assertOk();
    expect($res->json('payer'))->toBe(['kind' => 'GUARDIAN', 'id' => $this->parent, 'name' => 'Parent of two', 'phone' => '+201001112223']);
    expect($res->json('lines'))->toHaveCount(2);
    expect($res->json('lines.0.paid_minor'))->toBe(10000)->and($res->json('lines.0.remaining_minor'))->toBe(35000)
        ->and($res->json('lines.0.group_name'))->toBe('English A1');
    expect($res->json('balance'))->toBe([['currency' => 'EGP', 'due_minor' => 80000, 'credit_minor' => 0, 'balance_minor' => 80000]]);
    expect($res->json('recent_receipts'))->toHaveCount(1);

    // "Paid for Adam" is his parent's account — where his charges are billed.
    expect($this->getJson('/api/payer-account?student_id='.$this->adam)->json('payer.id'))->toBe($this->parent);
    $viaChild = acctCollect($this, ['student_id' => $this->bassel, 'amount_minor' => 5000]);
    expect($viaChild['payer']['kind'])->toBe('GUARDIAN')->and($viaChild['payer']['id'])->toBe($this->parent);
});

it('collects for the whole family, a bill addressed to a child included, and the family’s credit pays the next one', function () {
    acctSwitch($this, true);
    acctGroup($this); // June: 450 on the parent's invoice for each of Adam and Bassel.

    // A bill raised on Adam himself — how package bills and quick bills were addressed before.
    Sanctum::actingAs($this->owner);
    $quick = $this->postJson('/api/invoices/quick', ['student_id' => $this->adam, 'amount_minor' => 30000, 'currency' => 'EGP', 'description' => 'Books'])->assertCreated()->json('id');
    $childLine = (string) acctTenant($this->academy, fn () => DB::table('invoice_line_items')->where('invoice_id', $quick)->value('id'));

    // The parent's account is the family's: both group months and Adam's own bill.
    $account = $this->getJson('/api/payer-account?guardian_id='.$this->parent)->assertOk();
    expect(collect($account->json('lines'))->pluck('id')->all())->toContain($childLine)
        ->and($account->json('lines'))->toHaveCount(3)
        ->and($account->json('balance.0.due_minor'))->toBe(120000);

    // One receipt on the parent covers the child's bill.
    $receipt = acctCollect($this, ['guardian_id' => $this->parent, 'amount_minor' => 30000, 'line_ids' => [$childLine], 'apply_rest' => false]);
    expect($receipt['payer']['id'])->toBe($this->parent)
        ->and(acctLinePaid($this, $childLine))->toBe(30000)
        ->and((int) acctTenant($this->academy, fn () => DB::table('invoices')->where('id', $quick)->value('amount_paid_minor')))->toBe(30000);

    // Paid ahead: what is left over pays a bill raised on Bassel later, by itself.
    acctCollect($this, ['guardian_id' => $this->parent, 'amount_minor' => 100000]);
    $later = $this->postJson('/api/invoices/quick', ['student_id' => $this->bassel, 'amount_minor' => 10000, 'currency' => 'EGP', 'description' => 'Exam fee'])->assertCreated()->json('id');
    expect((int) acctTenant($this->academy, fn () => DB::table('invoices')->where('id', $later)->value('amount_paid_minor')))->toBe(10000);
    // Nothing owed, nothing held: the family is square.
    expect($this->getJson('/api/payer-account?guardian_id='.$this->parent)->json('balance'))->toBe([]);

    // Celine's family is another account: none of it moved.
    expect($this->getJson('/api/payer-account?guardian_id='.$this->celineParent)->json('balance.0.due_minor'))->toBe(45000);
});

it('builds the group’s collection sheet: exact per member, partial payments and arrears included', function () {
    acctSwitch($this, true);
    $groupId = acctGroup($this, '2026-05-01');

    // Adam: May + June paid. Bassel: half of June only (and May still owed). Celine: nothing.
    $lines = acctTenant($this->academy, fn () => DB::table('invoice_line_items')->get()->groupBy(fn ($l) => $l->student_id.'|'.substr((string) $l->group_period, 0, 7)));
    $id = fn ($s, $m) => (string) $lines[$s.'|'.$m]->first()->id;
    acctCollect($this, ['guardian_id' => $this->parent, 'amount_minor' => 90000, 'line_ids' => [$id($this->adam, '2026-05'), $id($this->adam, '2026-06')], 'apply_rest' => false]);
    acctCollect($this, ['guardian_id' => $this->parent, 'amount_minor' => 20000, 'line_ids' => [$id($this->bassel, '2026-06')], 'apply_rest' => false]);

    Sanctum::actingAs($this->owner);
    $res = $this->getJson("/api/groups/{$groupId}/accounts?month=2026-06")->assertOk();
    $rows = collect($res->json('rows'))->keyBy('student_name');

    expect($rows['Adam']['state'])->toBe('PAID')->and($rows['Adam']['remaining_minor'])->toBe(0)->and($rows['Adam']['arrears_minor'])->toBe(0);
    expect($rows['Adam']['last_receipt']['number'])->toBe('R-000001');
    expect($rows['Bassel']['state'])->toBe('PARTIAL')
        ->and($rows['Bassel']['paid_minor'])->toBe(20000)
        ->and($rows['Bassel']['remaining_minor'])->toBe(25000)
        ->and($rows['Bassel']['arrears_minor'])->toBe(45000)
        ->and($rows['Bassel']['payer'])->toMatchArray(['kind' => 'GUARDIAN', 'id' => $this->parent]);
    expect($rows['Celine']['state'])->toBe('UNPAID')->and($rows['Celine']['payer'])->toMatchArray(['kind' => 'GUARDIAN', 'id' => $this->celineParent, 'name' => 'Celine’s mother']);
    // Worked top-down: unpaid, part-paid, paid.
    expect(array_column($res->json('rows'), 'student_name'))->toBe(['Celine', 'Bassel', 'Adam']);

    expect($res->json('totals.0'))->toMatchArray([
        'currency' => 'EGP', 'expected_minor' => 135000, 'collected_minor' => 65000, 'remaining_minor' => 70000,
        'arrears_minor' => 90000, 'received_in_month_minor' => 110000, 'paid' => 1, 'partial' => 1, 'unpaid' => 1, 'rate' => 0.4815,
    ]);

    // The cross-group payments page now counts the partial payment too.
    $board = $this->getJson('/api/group-payments?month=2026-06')->assertOk();
    expect($board->json('totals.0.paid_minor'))->toBe(65000)->and($board->json('accounting'))->toBeTrue();

    Sanctum::actingAs($this->makeUser($this->academy, 'CUSTOMER_SERVICE', ['email' => 'desk-accounts@test.local']));
    $this->getJson("/api/groups/{$groupId}/accounts")->assertForbidden();
});

// ── Card payments (XPay) on an academy kept by receipts ──────────────────────

function acctProvisionXpay(string $academyId): void
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'ACADEMY_OWNER', true)");
    DB::table('academy_xpay_credentials')->insert([
        'academy_id' => $academyId, 'mode' => 'test', 'publishable_key' => 'pk_test_pub123',
        'secret_key_enc' => Crypt::encryptString('sk_test_abcdefghij1234'),
        'webhook_secret_enc' => Crypt::encryptString('whsec_acct'),
        'secret_last4' => '1234', 'webhook_last4' => 'acct',
    ]);
    DB::table('academy_payment_settings')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $academyId, 'method' => 'XPAY', 'is_active' => true,
        'config' => json_encode(['publishable_key' => 'pk_test_pub123', 'mode' => 'test']),
    ]);
    DB::statement("select set_config('app.current_academy_id', '', true)");
    DB::statement("select set_config('app.current_role', '', true)");
}

function acctXpaySession(string $id, string $invoiceId, string $academyId, int $amount, array $over = []): array
{
    return array_merge([
        'id' => $id, 'object' => 'checkout.session', 'status' => 'complete', 'paymentStatus' => 'paid',
        'currency' => 'EGP', 'amountTotal' => $amount, 'url' => 'https://checkout.xpay.app/c/'.$id,
        'metadata' => ['invoice_id' => $invoiceId, 'academy_id' => $academyId, 'public_token' => 'tok'],
    ], $over);
}

it('charges a card only what is left, and books the card payment as a receipt', function () {
    acctSwitch($this, true);
    acctGroup($this);
    acctProvisionXpay($this->academy);
    $invoice = acctInvoice($this, $this->parent, null, 6);   // 900, still running (OPEN)
    $cash = acctCollect($this, ['guardian_id' => $this->parent, 'amount_minor' => 20000, 'method' => 'CASH']);
    $this->clearTenantContext();

    Http::fake(['api.xpay.app/checkout/sessions' => Http::response(
        acctXpaySession('cs_acct_1', (string) $invoice->id, $this->academy, 70000, ['status' => 'open', 'paymentStatus' => 'unpaid']),
        201,
    )]);
    $this->postJson("/api/i/{$invoice->public_token}/xpay/session")->assertOk();
    Http::assertSent(fn ($r) => str_contains($r->body(), '"unitAmount":70000'));

    $body = json_encode(['id' => 'evt_acct_1', 'object' => 'event', 'type' => 'checkout.session.completed', 'livemode' => false,
        'data' => ['object' => acctXpaySession('cs_acct_1', (string) $invoice->id, $this->academy, 70000)]], JSON_UNESCAPED_SLASHES);
    $t = time();
    $this->call('POST', "/api/webhooks/xpay/{$this->academy}", [], [], [], [
        'CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json',
        'HTTP_XPAY_SIGNATURE' => 't='.$t.',v1='.hash_hmac('sha256', $t.'.'.$body, 'whsec_acct'),
    ], $body)->assertOk()->assertJsonPath('marked_paid', true);

    $card = acctTenant($this->academy, fn () => DB::table('receipts')->where('source', 'GATEWAY')->first());
    expect($card)->not->toBeNull();
    expect($card->method)->toBe('CARD')->and((int) $card->amount_minor)->toBe(70000)->and($card->reference)->toBe('XPay cs_acct_1');
    expect((int) acctTenant($this->academy, fn () => DB::table('receipt_allocations')->where('receipt_id', $card->id)->sum('amount_minor')))->toBe(70000);

    // A later change recomputes the invoice from its receipts — the card payment survives it.
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/receipts/{$cash['id']}/void", ['reason' => 'Counted twice'])->assertOk();
    $after = acctInvoice($this, $this->parent, null, 6);
    expect((int) $after->amount_paid_minor)->toBe(70000)->and($after->status)->toBe('PARTIALLY_PAID');
});

it('refuses a card checkout on a running invoice its receipts already cover', function () {
    acctSwitch($this, true);
    acctGroup($this);
    acctProvisionXpay($this->academy);
    $invoice = acctInvoice($this, $this->parent, null, 6);
    acctCollect($this, ['guardian_id' => $this->parent, 'amount_minor' => 90000]);
    $this->clearTenantContext();

    Http::fake();
    expect(acctInvoice($this, $this->parent, null, 6)->status)->toBe('OPEN');
    $this->clearTenantContext();
    $this->postJson("/api/i/{$invoice->public_token}/xpay/session")->assertStatus(422);
    Http::assertNothingSent();
});

it('insists on a picture of the proof for anything but cash', function () {
    acctSwitch($this, true);
    acctGroup($this);
    Sanctum::actingAs($this->owner);
    $this->post('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 10000, 'method' => 'INSTAPAY'])
        ->assertStatus(422)->assertJsonValidationErrors(['proof']);
    $this->post('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 10000, 'method' => 'CASH'])->assertCreated();
    $this->post('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 10000, 'method' => 'INSTAPAY', 'proof' => UploadedFile::fake()->image('p.png')])
        ->assertCreated()->assertJsonPath('receipt.has_proof', true);
});
