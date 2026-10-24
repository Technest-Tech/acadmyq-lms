<?php

declare(strict_types=1);

use App\Jobs\BillGroupMonthsJob;
use App\Services\GroupBilling;
use App\Services\ModuleBilling;
use App\Services\PayerDiscounts;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * The treasury and the family card (docs/groups/01-ACCOUNTING.md). Pinned here:
 *   - a receipt lands in the account its method maps to; balance = opening + in − out ± transfers
 *     + closing differences, counting only movements from the account's opening day;
 *   - a closed day is locked; a count's short / over is kept; only the last day reopens;
 *   - a salary paid out is tied to its finalized statement and never exceeds it;
 *   - the family card sums every account the family's money is on, in both billing styles;
 *   - an academy without accounting reaches none of it, and money stays with money roles.
 */
beforeEach(function () {
    Storage::fake('local');
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'invoice_grouping' => 'PER_GUARDIAN']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-treasury@test.local', 'full_name' => 'Owner Omar']);
    $this->supervisor = $this->makeUser($this->academy, 'SUPERVISOR', ['email' => 'sup-treasury@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona', 'session_rate_minor' => 6000, 'currency' => 'EGP']);
    $this->parent = $this->createGuardian($this->academy, ['full_name' => 'Parent of two', 'whatsapp_phone' => '+201001112223']);
    $this->adam = $this->createStudent($this->academy, $this->parent, ['full_name' => 'Adam', 'status' => 'REGULAR']);
    $this->bassel = $this->createStudent($this->academy, $this->parent, ['full_name' => 'Bassel', 'status' => 'REGULAR']);
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    $this->groupId = $this->postJson('/api/groups', [
        'name' => 'English A1', 'teacher_id' => $this->teacher, 'start_date' => '2026-05-01',
        'slots' => [['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60]],
        'billing_mode' => 'MONTHLY', 'price_minor' => 45000, 'currency' => 'EGP',
        'student_ids' => [$this->adam, $this->bassel],
    ])->assertCreated()->json('group.id');
});

afterEach(fn () => Carbon::setTestNow());

function trsOn(string $academyId): void
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    try {
        app(ModuleBilling::class)->setDisabledFeatures($academyId, 'MANAGEMENT', [], ['accounting']);
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

function trsTenant(string $academyId, callable $fn): mixed
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

/** A cash drawer (opened with 500, takes CASH) and a bank account (takes bank transfers). */
function trsAccounts($test): array
{
    Sanctum::actingAs($test->owner);
    $drawer = $test->postJson('/api/treasury/accounts', ['name' => 'Cash drawer', 'kind' => 'CASH', 'opening_balance_minor' => 50000, 'methods' => ['CASH']])->assertCreated()->json('id');
    $bank = $test->postJson('/api/treasury/accounts', ['name' => 'Bank', 'kind' => 'BANK', 'methods' => ['BANK_TRANSFER', 'INSTAPAY']])->assertCreated()->json('id');

    return [$drawer, $bank];
}

function trsAccount($test, string $id): array
{
    return collect($test->getJson('/api/treasury')->assertOk()->json('accounts'))->firstWhere('id', $id);
}

it('stays out of reach for an academy without accounting, whose family page and payroll are unchanged', function () {
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/treasury')->assertStatus(402);
    $this->getJson('/api/expenses')->assertStatus(402);
    $this->postJson('/api/treasury/accounts', ['name' => 'x', 'kind' => 'CASH'])->assertStatus(402);
    $this->getJson("/api/accounting/family/{$this->parent}")->assertStatus(402);
    $this->getJson('/api/accounting/income-expenses')->assertStatus(402);

    $this->getJson("/api/guardians/{$this->parent}")->assertOk();
    $this->getJson('/api/payouts')->assertOk();
    expect(trsTenant($this->academy, fn () => DB::table('cash_accounts')->count() + DB::table('expense_categories')->count()))->toBe(0);
});

it('lands receipts in the account their method maps to, and keeps the balance', function () {
    trsOn($this->academy);
    [$drawer, $bank] = trsAccounts($this);

    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 30000, 'method' => 'CASH'])->assertCreated();
    $this->post('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 20000, 'method' => 'INSTAPAY', 'proof' => UploadedFile::fake()->image('instapay.jpg')])->assertCreated();
    // Wallet money with no account mapped: kept, but in no account (the treasury says so).
    $this->post('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 5000, 'method' => 'WALLET', 'proof' => UploadedFile::fake()->image('wallet.jpg')])->assertCreated();

    expect(trsTenant($this->academy, fn () => DB::table('receipts')->where('method', 'CASH')->value('cash_account_id')))->toBe($drawer);
    expect(trsAccount($this, $drawer))->toMatchArray(['balance_minor' => 80000, 'today_in_minor' => 30000]);
    expect(trsAccount($this, $bank)['balance_minor'])->toBe(20000);
    $res = $this->getJson('/api/treasury')->assertOk();
    expect($res->json('unmapped_methods'))->toBe([['method' => 'WALLET', 'currency' => 'EGP']]);
    expect($res->json('month.currencies.0'))->toMatchArray(['in_minor' => 55000, 'out_minor' => 0, 'net_minor' => 55000]);

    // Banking the cash: neither money in nor out, it only moves.
    $this->postJson('/api/treasury/transfers', ['from_account_id' => $drawer, 'to_account_id' => $bank, 'amount_minor' => 60000])->assertCreated();
    expect(trsAccount($this, $drawer)['balance_minor'])->toBe(20000);
    expect(trsAccount($this, $bank)['balance_minor'])->toBe(80000);
    expect($this->getJson('/api/treasury')->json('month.currencies.0.in_minor'))->toBe(55000);

    $ledger = $this->getJson("/api/treasury/accounts/{$drawer}/ledger")->assertOk();
    expect($ledger->json('opening_minor'))->toBe(50000)
        ->and(array_column($ledger->json('entries'), 'kind'))->toBe(['RECEIPT', 'TRANSFER_OUT'])
        ->and($ledger->json('closing_minor'))->toBe(20000);
});

it('records an expense from an account, voids it, and never lets a supervisor near it', function () {
    trsOn($this->academy);
    [$drawer] = trsAccounts($this);
    $rent = collect($this->getJson('/api/expenses')->assertOk()->json('categories'))->firstWhere('key', 'rent')['id'];

    $e = $this->postJson('/api/expenses', ['category_id' => $rent, 'cash_account_id' => $drawer, 'amount_minor' => 20000, 'payee' => 'Landlord'])->assertCreated();
    expect($e->json('number'))->toBe('E-000001');
    expect(trsAccount($this, $drawer)['balance_minor'])->toBe(30000);

    $list = $this->getJson('/api/expenses')->assertOk();
    expect($list->json('totals.0.amount_minor'))->toBe(20000)
        ->and($list->json('by_category.0.name'))->toBe('الإيجار');

    $this->postJson("/api/expenses/{$e->json('id')}/void", ['reason' => 'Paid twice'])->assertOk();
    expect(trsAccount($this, $drawer)['balance_minor'])->toBe(50000);

    Sanctum::actingAs($this->supervisor);
    $this->getJson('/api/treasury')->assertForbidden();
    $this->postJson('/api/expenses', ['category_id' => $rent, 'cash_account_id' => $drawer, 'amount_minor' => 100])->assertForbidden();
});

it('closes a day against the count, keeps the shortage, and locks the day', function () {
    trsOn($this->academy);
    [$drawer] = trsAccounts($this);
    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 30000, 'method' => 'CASH'])->assertCreated();

    // Books say 800; the drawer holds 750.
    $closing = $this->postJson('/api/treasury/closings', ['cash_account_id' => $drawer, 'counted_minor' => 75000, 'note' => 'Short by 50'])->assertCreated();
    expect($closing->json())->toMatchArray(['expected_minor' => 80000, 'counted_minor' => 75000, 'difference_minor' => -5000]);
    expect(trsAccount($this, $drawer))->toMatchArray(['balance_minor' => 75000, 'closed_today' => true]);

    // Nothing new on a closed day.
    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 1000, 'method' => 'CASH'])->assertStatus(422);
    $this->postJson('/api/treasury/closings', ['cash_account_id' => $drawer, 'counted_minor' => 75000])->assertStatus(422);

    // Reopen the last day, and it takes money again.
    $this->deleteJson("/api/treasury/closings/{$closing->json('id')}")->assertOk();
    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 1000, 'method' => 'CASH'])->assertCreated();
    expect(trsAccount($this, $drawer)['balance_minor'])->toBe(81000);
});

it('pays a teacher’s finalized statement out of an account, never beyond it', function () {
    trsOn($this->academy);
    [$drawer] = trsAccounts($this);
    $payout = trsTenant($this->academy, function () {
        $id = (string) Str::uuid();
        DB::table('payouts')->insert(['id' => $id, 'academy_id' => $this->academy, 'teacher_id' => $this->teacher, 'period_year' => 2026, 'period_month' => 5,
            'total_minor' => 40000, 'currency' => 'EGP', 'finalized_at' => now()]);

        return $id;
    });

    $s = $this->getJson('/api/expenses/salaries')->assertOk();
    expect($s->json('salaries.0'))->toMatchArray(['teacher_name' => 'Miss Mona', 'period' => '2026-05', 'remaining_minor' => 40000]);

    $this->postJson('/api/expenses', ['payout_id' => $payout, 'cash_account_id' => $drawer, 'amount_minor' => 30000])->assertCreated();
    $this->postJson('/api/expenses', ['payout_id' => $payout, 'cash_account_id' => $drawer, 'amount_minor' => 20000])->assertStatus(422);
    expect($this->getJson('/api/expenses/salaries')->json('salaries.0.remaining_minor'))->toBe(10000);
    $row = $this->getJson('/api/expenses')->json('expenses.0');
    expect($row)->toMatchArray(['category_key' => 'teacher_salaries', 'payee' => 'Miss Mona', 'description' => '2026-05']);
    expect(trsAccount($this, $drawer)['balance_minor'])->toBe(20000);
});

it('shows the year month by month: money in, money out, net', function () {
    trsOn($this->academy);
    [$drawer] = trsAccounts($this);
    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 90000, 'method' => 'CASH'])->assertCreated();
    $other = collect($this->getJson('/api/expenses')->json('categories'))->firstWhere('key', 'printing')['id'];
    $this->postJson('/api/expenses', ['category_id' => $other, 'cash_account_id' => $drawer, 'amount_minor' => 15000])->assertCreated();

    $res = $this->getJson('/api/accounting/income-expenses?year=2026')->assertOk();
    $june = collect($res->json('months'))->firstWhere('month', '2026-06');
    expect($june['currencies'][0])->toMatchArray(['in_minor' => 90000, 'out_minor' => 15000, 'net_minor' => 75000]);
    expect($res->json('categories.0'))->toMatchArray(['name' => 'طباعة وأدوات مكتبية', 'amount_minor' => 15000]);
});

it('builds the family card: children, what they are in, what is owed and the timeline with notes', function () {
    trsOn($this->academy);
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 50000, 'method' => 'CASH'])->assertCreated();
    $this->postJson("/api/accounting/family/{$this->parent}/notes", ['body' => 'Will pay the rest on Thursday', 'follow_up_on' => '2026-06-18'])->assertCreated();

    $res = $this->getJson("/api/accounting/family/{$this->parent}")->assertOk();
    expect($res->json('family.name'))->toBe('Parent of two');
    // 4 × 450 billed (May + June, two children), 500 paid.
    expect($res->json('balance.0'))->toMatchArray(['due_minor' => 130000, 'overdue_minor' => 40000]);
    $children = collect($res->json('children'))->keyBy('name');
    expect($children['Adam']['groups'][0])->toMatchArray(['name' => 'English A1', 'price_minor' => 45000]);
    // The 500 paid oldest first: one child's May (450) in full, then 50 of the other's May. Both May
    // lines carry the same date, so which child the ledger reaches first is not promised.
    $dues = collect([$children['Adam']['due'][0]['due_minor'], $children['Bassel']['due'][0]['due_minor']])->sort()->values()->all();
    expect($dues)->toBe([45000, 85000]);
    expect(collect($res->json('charges'))->pluck('source')->unique()->all())->toBe(['GROUP']);
    expect(array_column($res->json('timeline'), 'kind'))->toContain('RECEIPT', 'NOTE');
    expect($res->json('next_follow_up'))->toBe(['date' => '2026-06-18', 'body' => 'Will pay the rest on Thursday']);
    expect($res->json('paid_this_year.0.amount_minor'))->toBe(50000);

    $note = collect($res->json('timeline'))->firstWhere('kind', 'NOTE');
    $this->deleteJson("/api/accounting/family/{$this->parent}/notes/{$note['id']}")->assertOk();

    Sanctum::actingAs($this->supervisor);
    $this->getJson("/api/accounting/family/{$this->parent}")->assertForbidden();
});

it('sums each child’s own account for an academy that bills per student', function () {
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    DB::table('academies')->where('id', $this->academy)->update(['invoice_grouping' => 'PER_STUDENT']);
    DB::statement("select set_config('app.current_role', '', true)");
    trsOn($this->academy);

    // A child joining now is billed on their OWN account; the older months stay on the parent's.
    $carl = $this->createStudent($this->academy, $this->parent, ['full_name' => 'Carl', 'status' => 'REGULAR']);
    $this->clearTenantContext();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/groups/{$this->groupId}/members", ['student_ids' => [$carl]])->assertCreated();

    $res = $this->getJson("/api/accounting/family/{$this->parent}")->assertOk();
    $charges = collect($res->json('charges'));
    $own = $charges->where('payer_kind', 'STUDENT');
    expect($own)->not->toBeEmpty()
        ->and($own->pluck('student_name')->unique()->values()->all())->toBe(['Carl'])
        ->and($charges->where('payer_kind', 'GUARDIAN')->count())->toBe(4);
    // The card's total is the whole family's: the parent's account and Carl's together.
    expect($res->json('balance.0.due_minor'))->toBe(180000 + (int) $own->sum('remaining_minor'));
});

it('takes a family discount off every charge raised from now on — percent and fixed stack, and nothing already billed moves', function () {
    trsOn($this->academy);
    Sanctum::actingAs($this->owner);
    // 10 % for the whole family on everything, plus 50 off Adam alone on group charges.
    $this->postJson("/api/accounting/family/{$this->parent}/discounts", ['kind' => 'PERCENT', 'value' => 10, 'label' => 'Sibling'])->assertCreated();
    $this->postJson("/api/accounting/family/{$this->parent}/discounts", ['kind' => 'FIXED', 'value' => 5000, 'label' => 'Scholarship', 'student_id' => $this->adam, 'scope' => 'GROUP'])->assertCreated();
    // Not one of the family's children, and a percentage over 100: refused.
    $this->postJson("/api/accounting/family/{$this->parent}/discounts", ['kind' => 'PERCENT', 'value' => 10, 'label' => 'x', 'student_id' => $this->teacher])->assertStatus(422);
    $this->postJson("/api/accounting/family/{$this->parent}/discounts", ['kind' => 'PERCENT', 'value' => 120, 'label' => 'x'])->assertStatus(422);

    $card = $this->getJson("/api/accounting/family/{$this->parent}")->assertOk();
    expect($card->json('discounts'))->toHaveCount(2);
    expect(collect($card->json('discounts'))->firstWhere('label', 'Scholarship'))->toMatchArray(['kind' => 'FIXED', 'value' => 5000, 'scope' => 'GROUP', 'student_name' => 'Adam', 'active' => true]);
    // May and June were billed before the discounts: untouched.
    expect(collect($card->json('charges'))->pluck('discount_minor')->unique()->all())->toBe([0]);

    // July is raised under them: Adam 450 − 45 − 50 = 355, Bassel 450 − 45 = 405.
    Carbon::setTestNow('2026-07-01 09:00:00');
    (new BillGroupMonthsJob(onlyAcademyId: $this->academy))->handle(app(GroupBilling::class));
    $july = trsTenant($this->academy, fn () => DB::table('invoice_line_items')->where('class_group_id', $this->groupId)->where('group_period', '2026-07-01')->get()->keyBy(fn ($l) => (string) $l->student_id));
    expect($july)->toHaveCount(2);
    expect((int) $july[$this->adam]->amount_minor)->toBe(35500)
        ->and((int) $july[$this->adam]->list_amount_minor)->toBe(45000)
        ->and((int) $july[$this->adam]->discount_minor)->toBe(9500)
        ->and($july[$this->adam]->discount_label)->toBe('Sibling + Scholarship');
    expect((int) $july[$this->bassel]->amount_minor)->toBe(40500)->and($july[$this->bassel]->discount_label)->toBe('Sibling');
    // The invoice total is the net.
    expect((int) trsTenant($this->academy, fn () => DB::table('invoices')->where('id', $july[$this->adam]->invoice_id)->value('total_minor')))->toBe(76000);

    // The statement and the family card both show list, discount and net.
    Sanctum::actingAs($this->owner);
    $stmt = $this->getJson("/api/accounting/statement?guardian_id={$this->parent}&from=2026-07-01&to=2026-07-31")->assertOk();
    $entries = collect($stmt->json('currencies.0.entries'))->where('kind', 'CHARGE');
    expect($entries->sum('debit_minor'))->toBe(76000)->and($entries->sum('discount_minor'))->toBe(14000)->and($entries->sum('list_amount_minor'))->toBe(90000);
    $charges = collect($this->getJson("/api/accounting/family/{$this->parent}")->assertOk()->json('charges'))->where('period', '2026-07');
    expect($charges->firstWhere('student_name', 'Adam'))->toMatchArray(['amount_minor' => 35500, 'list_amount_minor' => 45000, 'discount_minor' => 9500, 'discount_label' => 'Sibling + Scholarship']);

    // Ending the family discount stops it from today; August: Adam 450 − 50, Bassel full.
    $sibling = collect($card->json('discounts'))->firstWhere('label', 'Sibling')['id'];
    $this->deleteJson("/api/accounting/family/{$this->parent}/discounts/{$sibling}")->assertOk();
    expect(collect($this->getJson("/api/accounting/family/{$this->parent}")->json('discounts'))->firstWhere('label', 'Sibling')['active'])->toBeFalse();
    // From the day it ended, a charge is priced without it — the day itself included.
    $price = fn (string $student, string $on) => trsTenant($this->academy, fn () => app(PayerDiscounts::class)->apply($this->academy, $student, PayerDiscounts::SCOPE_GROUP, $this->groupId, 45000, $on));
    expect($price($this->adam, '2026-07-01'))->toMatchArray(['amount_minor' => 40000, 'discount_minor' => 5000, 'discount_label' => 'Scholarship']);
    expect($price($this->bassel, '2026-08-01'))->toMatchArray(['amount_minor' => 45000, 'discount_minor' => 0, 'discount_label' => null]);
    // And the day before it ended, it still counted.
    expect($price($this->bassel, '2026-06-30')['discount_minor'])->toBe(4500);
});

it('never discounts an academy that is not on receipts — its lines are written as they always were', function () {
    // The switch is off: the discount API is out of reach, and a raised charge carries no discount columns.
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/accounting/family/{$this->parent}/discounts", ['kind' => 'PERCENT', 'value' => 10, 'label' => 'x'])->assertStatus(402);
    Carbon::setTestNow('2026-07-01 09:00:00');
    (new BillGroupMonthsJob(onlyAcademyId: $this->academy))->handle(app(GroupBilling::class));
    $july = trsTenant($this->academy, fn () => DB::table('invoice_line_items')->where('class_group_id', $this->groupId)->where('group_period', '2026-07-01')->get());
    expect($july)->toHaveCount(2);
    expect($july->pluck('amount_minor')->map(fn ($v) => (int) $v)->unique()->all())->toBe([45000]);
    expect($july->pluck('list_amount_minor')->unique()->all())->toBe([null]);
});
