<?php

declare(strict_types=1);

use App\Services\Invoicing;
use App\Services\ModuleBilling;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * A prepaid subscription that ends before it is used up (App\Services\PackageSettlement): 8 hours
 * bought for 1600 and paid, 3 taken. The 1000 paid for the other 5 becomes the family's credit,
 * is paid back out of the treasury, or is kept — and until someone decides, the family's account
 * says it is waiting, whatever became of the child. Only money actually paid ever comes back.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'invoice_grouping' => 'PER_GUARDIAN']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-settle@test.local']);
    $this->parent = $this->createGuardian($this->academy, ['full_name' => 'Adam’s mother']);
    $this->adam = $this->createStudent($this->academy, $this->parent, ['full_name' => 'Adam', 'status' => 'REGULAR']);
    $this->clearTenantContext();

    psOn($this->academy);
    Sanctum::actingAs($this->owner);
});

afterEach(fn () => Carbon::setTestNow());

function psOn(string $academyId): void
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    try {
        // Settlement is a curriculum centre's (PackageSettlement::availableFor): on the accounts AND `centre`.
        app(ModuleBilling::class)->setDisabledFeatures($academyId, 'MANAGEMENT', [], ['accounting', 'centre']);
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

function psTenant(string $academyId, callable $fn): mixed
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

/** 8 hours for 1600, `$paid` of it paid in cash, 3 hours taken. */
function psBlock($test, int $paid = 160000, array $extra = []): array
{
    $pkg = $test->postJson('/api/packages', ['student_id' => $test->adam, 'label' => 'English', 'hours' => 8, 'price_minor' => 160000, 'currency' => 'EGP'] + $extra)
        ->assertCreated()->json();
    if ($paid > 0) {
        $test->postJson('/api/receipts', ['guardian_id' => $test->parent, 'amount_minor' => $paid, 'method' => 'CASH'])->assertCreated();
    }
    psTenant($test->academy, fn () => DB::table('lesson_packages')->where('id', $pkg['id'])->update(['minutes_consumed' => 180]));

    return $pkg;
}

function psBalance($test): array
{
    $b = $test->getJson("/api/accounting/family/{$test->parent}")->assertOk()->json('balance.0') ?? [];

    return ['due' => (int) ($b['due_minor'] ?? 0), 'credit' => (int) ($b['credit_minor'] ?? 0)];
}

function psRow($test, string $table, string $id): object
{
    return psTenant($test->academy, fn () => DB::table($table)->where('id', $id)->first());
}

it('gives back as credit what was paid for lessons never had, and the credit pays the next block', function () {
    $pkg = psBlock($this);

    $this->getJson("/api/packages/{$pkg['id']}/settlement")->assertOk()
        ->assertJsonPath('preview.unused_minutes', 300)
        ->assertJsonPath('preview.used_minor', 60000)
        ->assertJsonPath('preview.paid_minor', 160000)
        ->assertJsonPath('preview.owed_back_minor', 100000)
        ->assertJsonPath('can_settle', true);

    $this->postJson("/api/packages/{$pkg['id']}/close", ['settlement' => ['mode' => 'CREDIT']])->assertOk()
        ->assertJsonPath('settlement.amount_minor', 100000)->assertJsonPath('settlement.mode', 'CREDIT');

    // The bill asks for the 3 hours had; the 1000 is the family's.
    $line = psTenant($this->academy, fn () => DB::table('invoice_line_items')->where('invoice_id', $pkg['invoice_id'])->first());
    expect((int) $line->amount_minor)->toBe(60000)->and($line->description)->toContain('3h used')
        ->and((int) psRow($this, 'invoices', $pkg['invoice_id'])->total_minor)->toBe(60000)
        ->and(psBalance($this))->toBe(['due' => 0, 'credit' => 100000])
        ->and($this->getJson("/api/accounting/family/{$this->parent}")->json('unsettled'))->toBe([])
        ->and(psRow($this, 'lesson_packages', $pkg['id']))->toMatchArray(['settlement' => 'CREDIT', 'settled_minor' => 100000]);

    // Given back as money, the hours cannot also be carried; the credit pays the next block.
    $next = $this->postJson('/api/packages', ['student_id' => $this->adam, 'label' => 'English', 'hours' => 8, 'price_minor' => 160000, 'currency' => 'EGP', 'carry_over' => true])
        ->assertCreated();
    expect($next->json('carried_over_minutes'))->toBe(0)
        ->and(psBalance($this))->toBe(['due' => 60000, 'credit' => 0]);
});

it('waits on the family’s account when closed without a decision — the child gone, the bill closed — and settles then', function () {
    $pkg = psBlock($this);
    $this->postJson("/api/packages/{$pkg['id']}/close")->assertOk()->assertJsonPath('settlement', null);
    expect(psRow($this, 'lesson_packages', $pkg['id'])->settlement)->toBe('PENDING');

    // The child left and the month closed: it is still there to decide.
    psTenant($this->academy, function () use ($pkg) {
        DB::table('students')->where('id', $this->adam)->update(['deleted_at' => now()]);
        app(Invoicing::class)->closeInvoice($pkg['invoice_id'], $this->academy, (string) $this->owner->id, 'ACADEMY_OWNER');
    });
    $waiting = $this->getJson("/api/accounting/family/{$this->parent}")->assertOk()->json('unsettled');
    expect($waiting)->toHaveCount(1)
        ->and($waiting[0])->toMatchArray(['package_id' => $pkg['id'], 'student_name' => 'Adam', 'owed_back_minor' => 100000, 'currency' => 'EGP']);

    $this->postJson("/api/packages/{$pkg['id']}/settle", ['mode' => 'CREDIT'])->assertOk()->assertJsonPath('amount_minor', 100000);
    $invoice = psRow($this, 'invoices', $pkg['invoice_id']);
    expect((int) $invoice->total_minor)->toBe(60000)->and((int) $invoice->amount_paid_minor)->toBe(60000)->and($invoice->status)->toBe('PAID')
        ->and(psBalance($this))->toBe(['due' => 0, 'credit' => 100000]);
    $this->postJson("/api/packages/{$pkg['id']}/settle", ['mode' => 'CREDIT'])->assertStatus(422);
    // A closed bill otherwise stays frozen.
    expect(fn () => psTenant($this->academy, fn () => DB::table('invoices')->where('id', $pkg['invoice_id'])->update(['total_minor' => 1])))
        ->toThrow(QueryException::class);
});

it('pays it back out of the treasury, and a refund taken back is the family’s credit again', function () {
    $drawer = $this->postJson('/api/treasury/accounts', ['name' => 'Cash drawer', 'kind' => 'CASH', 'opening_balance_minor' => 50000, 'methods' => ['CASH']])->assertCreated()->json('id');
    $balanceOf = fn () => (int) collect($this->getJson('/api/treasury')->assertOk()->json('accounts'))->firstWhere('id', $drawer)['balance_minor'];
    $pkg = psBlock($this);
    expect($balanceOf())->toBe(210000);

    $this->postJson("/api/packages/{$pkg['id']}/close", ['settlement' => ['mode' => 'REFUND']])->assertStatus(422);
    expect(psRow($this, 'lesson_packages', $pkg['id'])->status)->toBe('ACTIVE');

    $res = $this->postJson("/api/packages/{$pkg['id']}/close", ['settlement' => ['mode' => 'REFUND', 'cash_account_id' => $drawer]])->assertOk();
    $expenseId = $res->json('settlement.expense_id');
    expect($res->json('settlement.expense_number'))->toStartWith('E-')
        ->and($balanceOf())->toBe(110000)
        ->and(psBalance($this))->toBe(['due' => 0, 'credit' => 0])
        ->and(psTenant($this->academy, fn () => DB::table('expenses as e')->join('expense_categories as c', 'c.id', '=', 'e.category_id')->where('e.id', $expenseId)->value('c.key')))->toBe('refunds');

    // The family's statement says the money went back.
    $statement = $this->getJson("/api/accounting/statement?guardian_id={$this->parent}")->assertOk()->json('currencies.0');
    expect(collect($statement['entries'])->firstWhere('kind', 'REFUND'))->toMatchArray(['debit_minor' => 100000])
        ->and($statement['refunds_minor'])->toBe(100000)
        ->and($statement['closing_minor'])->toBe(0);

    // Its receipt cannot be voided under it, nor its amount edited.
    $receiptId = psTenant($this->academy, fn () => (string) DB::table('receipts')->value('id'));
    $this->postJson("/api/receipts/{$receiptId}/void", ['reason' => 'mistake'])->assertStatus(422);
    $this->patchJson("/api/expenses/{$expenseId}", ['amount_minor' => 90000])->assertStatus(422);

    $this->postJson("/api/expenses/{$expenseId}/void", ['reason' => 'paid by mistake'])->assertOk();
    expect(psBalance($this))->toBe(['due' => 0, 'credit' => 100000])
        ->and($balanceOf())->toBe(210000)
        ->and(psRow($this, 'lesson_packages', $pkg['id'])->settlement)->toBe('CREDIT');
});

it('returns only money actually paid, records a block the academy keeps, and pays a credit back from the family card', function () {
    // 500 paid of 1600, 600 worth taken: nothing comes back, and the block stays open.
    $pkg = psBlock($this, 50000);
    $this->getJson("/api/packages/{$pkg['id']}/settlement")->assertOk()->assertJsonPath('preview.owed_back_minor', 0);
    $this->postJson("/api/packages/{$pkg['id']}/close", ['settlement' => ['mode' => 'CREDIT']])->assertStatus(422);
    expect(psRow($this, 'lesson_packages', $pkg['id'])->status)->toBe('ACTIVE');

    // Paid in full, then kept: the bill and the money stay as they are, the reason is written down.
    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 110000, 'method' => 'CASH'])->assertCreated();
    $this->postJson("/api/packages/{$pkg['id']}/close", ['settlement' => ['mode' => 'KEEP', 'note' => 'Stopped without notice']])->assertOk();
    expect(psRow($this, 'lesson_packages', $pkg['id']))->toMatchArray(['settlement' => 'KEEP', 'settled_minor' => 100000, 'settle_note' => 'Stopped without notice'])
        ->and((int) psRow($this, 'invoices', $pkg['invoice_id'])->total_minor)->toBe(160000)
        ->and(psBalance($this))->toBe(['due' => 0, 'credit' => 0]);

    // Credit from paying too much, paid back from the family card — never more than they hold.
    $drawer = $this->postJson('/api/treasury/accounts', ['name' => 'Cash drawer', 'kind' => 'CASH', 'methods' => ['CASH']])->assertCreated()->json('id');
    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 30000, 'method' => 'CASH'])->assertCreated();
    $card = $this->getJson("/api/accounting/family/{$this->parent}")->assertOk();
    expect($card->json('can_refund'))->toBeTrue()->and(collect($card->json('refund_accounts'))->pluck('id')->all())->toContain($drawer);
    $refund = fn (int $amount) => $this->postJson("/api/accounting/family/{$this->parent}/refund", ['amount_minor' => $amount, 'currency' => 'EGP', 'cash_account_id' => $drawer]);
    $refund(40000)->assertStatus(422);
    $refund(30000)->assertCreated();
    expect(psBalance($this))->toBe(['due' => 0, 'credit' => 0]);
    expect($this->getJson("/api/accounting/family/{$this->parent}")->json('timeline.0'))->toMatchArray(['kind' => 'REFUND', 'amount_minor' => 30000]);
});

it('shows the desk what is left but leaves the decision to whoever handles the money', function () {
    $pkg = psBlock($this);
    $this->postJson("/api/packages/{$pkg['id']}/close")->assertOk();
    Sanctum::actingAs($this->makeUser($this->academy, 'CUSTOMER_SERVICE', ['email' => 'desk-settle@test.local']));
    $this->postJson("/api/packages/{$pkg['id']}/settle", ['mode' => 'CREDIT'])->assertForbidden();
    $this->postJson("/api/accounting/family/{$this->parent}/refund", ['amount_minor' => 100, 'currency' => 'EGP', 'cash_account_id' => $pkg['id']])->assertForbidden();
    expect(psRow($this, 'lesson_packages', $pkg['id'])->settlement)->toBe('PENDING');
});
