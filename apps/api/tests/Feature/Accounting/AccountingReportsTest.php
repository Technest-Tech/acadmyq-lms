<?php

declare(strict_types=1);

use App\Services\ModuleBilling;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * "How much did we make?" (docs/groups/01-ACCOUNTING.md). Pinned here:
 *   - profit takes the teachers' statements for the month, however and whenever they were paid;
 *   - an expense can name a group, and that group's profit takes it off;
 *   - private lessons have their own report, and a teacher reads whole: private and groups;
 *   - a revenue share is of what was billed unless a group says collected, and then it follows receipts;
 *   - rates for one figure across currencies reach any client on the accounts.
 */
beforeEach(function () {
    Storage::fake('local');
    Carbon::setTestNow('2026-06-17 09:00:00');
    Cache::flush();
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'invoice_grouping' => 'PER_GUARDIAN']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-reports@test.local']);
    $this->supervisor = $this->makeUser($this->academy, 'SUPERVISOR', ['email' => 'sup-reports@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona', 'session_rate_minor' => 6000, 'currency' => 'EGP']);
    $this->parent = $this->createGuardian($this->academy, ['full_name' => 'Group parent']);
    $this->adam = $this->createStudent($this->academy, $this->parent, ['full_name' => 'Adam', 'status' => 'REGULAR']);
    $this->other = $this->createGuardian($this->academy, ['full_name' => 'Private parent']);
    $this->dina = $this->createStudent($this->academy, $this->other, ['full_name' => 'Dina', 'status' => 'REGULAR']);
    $this->clearTenantContext();
    Sanctum::actingAs($this->owner);
});

afterEach(fn () => Carbon::setTestNow());

function arpOn(string $academyId): void
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

function arpTenant(string $academyId, callable $fn): mixed
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

function arpGroup($test, array $over = []): string
{
    return $test->postJson('/api/groups', array_merge([
        'name' => 'English A1', 'teacher_id' => $test->teacher, 'start_date' => '2026-06-01',
        'slots' => [['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60]],
        'billing_mode' => 'MONTHLY', 'price_minor' => 45000, 'currency' => 'EGP',
        'student_ids' => [$test->adam],
    ], $over))->assertCreated()->json('group.id');
}

function arpDrawer($test): string
{
    return $test->postJson('/api/treasury/accounts', ['name' => 'Drawer', 'kind' => 'CASH', 'methods' => ['CASH']])->assertCreated()->json('id');
}

function arpStatement($test, int $month, int $total, bool $finalized = true): string
{
    $id = (string) Str::uuid();
    arpTenant($test->academy, fn () => DB::table('payouts')->insert([
        'id' => $id, 'academy_id' => $test->academy, 'teacher_id' => $test->teacher, 'period_year' => 2026, 'period_month' => $month,
        'total_minor' => $total, 'currency' => 'EGP', 'finalized_at' => $finalized ? now()->toIso8601String() : null,
    ]));

    return $id;
}

function arpMonth($test, string $month): array
{
    $row = collect($test->getJson('/api/accounting/income-expenses?year=2026')->assertOk()->json('months'))->firstWhere('month', $month);

    return collect($row['currencies'])->firstWhere('currency', 'EGP') ?? [];
}

/** The monthly revenue-share line of a group. */
function arpShare($test, string $groupId, string $period = '2026-06-01'): ?int
{
    $amount = arpTenant($test->academy, fn () => DB::table('payout_line_items')->where('class_group_id', $groupId)->whereNull('class_group_lesson_id')->where('group_period', $period)->value('amount_minor'));

    return $amount === null ? null : (int) $amount;
}

it('reports profit from the month’s statements, however and whenever they were paid', function () {
    arpOn($this->academy);
    $drawer = arpDrawer($this);
    arpGroup($this);
    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 45000, 'method' => 'CASH'])->assertCreated();

    $may = arpStatement($this, 5, 12000);
    arpStatement($this, 6, 8000, finalized: false);
    $categories = fn () => collect($this->getJson('/api/expenses')->assertOk()->json('categories'));
    $rent = $categories()->firstWhere('key', 'rent')['id'] ?? $categories()->first()['id'];
    $this->postJson('/api/expenses', ['category_id' => $rent, 'cash_account_id' => $drawer, 'amount_minor' => 3000])->assertCreated();
    // May's salary paid out in June: cash left in June, the cost is May's.
    $salary = $this->postJson('/api/expenses', ['payout_id' => $may, 'cash_account_id' => $drawer, 'amount_minor' => 12000])->assertCreated()->json('id');

    $june = arpMonth($this, '2026-06');
    expect($june)->toMatchArray(['in_minor' => 45000, 'out_minor' => 15000, 'net_minor' => 30000, 'salaries_earned_minor' => 8000, 'salaries_paid_minor' => 12000])
        ->and($june['profit_minor'])->toBe(45000 - 3000 - 8000);
    // May had no cash at all, and still cost its statement.
    expect(arpMonth($this, '2026-05'))->toMatchArray(['in_minor' => 0, 'out_minor' => 0, 'net_minor' => 0, 'salaries_earned_minor' => 12000, 'profit_minor' => -12000]);

    // Taking the cash back moves the treasury, not the profit.
    $this->postJson("/api/expenses/{$salary}/void", ['reason' => 'Wrong account'])->assertOk();
    expect(arpMonth($this, '2026-06'))->toMatchArray(['net_minor' => 42000, 'salaries_paid_minor' => 0, 'profit_minor' => 34000]);

    // A salary typed in by hand has no statement behind it: it stays a cost, counted once.
    $byHand = $categories()->firstWhere('key', 'staff_salaries')['id'];
    $this->postJson('/api/expenses', ['category_id' => $byHand, 'cash_account_id' => $drawer, 'amount_minor' => 1000])->assertCreated();
    expect(arpMonth($this, '2026-06')['profit_minor'])->toBe(33000);

    // Whoever may not read pay sees no statements in it, and so no profit.
    Sanctum::actingAs($this->supervisor);
    expect(arpMonth($this, '2026-06'))->toMatchArray(['salaries_earned_minor' => null, 'salaries_paid_minor' => null, 'profit_minor' => null]);
});

it('takes an expense spent on a group off that group’s profit', function () {
    arpOn($this->academy);
    $drawer = arpDrawer($this);
    $groupId = arpGroup($this);
    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 45000, 'method' => 'CASH'])->assertCreated();
    $category = collect($this->getJson('/api/expenses')->assertOk()->json('categories'))->first()['id'];

    $expense = $this->postJson('/api/expenses', ['category_id' => $category, 'cash_account_id' => $drawer, 'amount_minor' => 5000, 'class_group_id' => $groupId])->assertCreated()->json('id');
    // One on the academy as a whole touches no group.
    $this->postJson('/api/expenses', ['category_id' => $category, 'cash_account_id' => $drawer, 'amount_minor' => 700])->assertCreated();

    $money = fn () => $this->getJson('/api/accounting/groups?month=2026-06')->assertOk()->json('groups.0.money.0');
    expect($money())->toMatchArray(['received_in_month_minor' => 45000, 'expenses_minor' => 5000, 'net_minor' => 40000]);
    $this->assertSame('English A1', collect($this->getJson('/api/expenses')->json('expenses'))->firstWhere('id', $expense)['group_name']);

    // A group that does not exist, and a salary named to a group, are refused.
    $this->postJson('/api/expenses', ['category_id' => $category, 'cash_account_id' => $drawer, 'amount_minor' => 1, 'class_group_id' => (string) Str::uuid()])->assertStatus(422);
    $statement = arpStatement($this, 5, 100);
    $this->postJson('/api/expenses', ['payout_id' => $statement, 'cash_account_id' => $drawer, 'amount_minor' => 100, 'class_group_id' => $groupId])->assertStatus(422);

    $this->postJson("/api/expenses/{$expense}/void", ['reason' => 'Wrong group'])->assertOk();
    expect($money())->toMatchArray(['expenses_minor' => 0, 'net_minor' => 45000]);
});

it('reports private lessons by student, and each teacher whole across private and groups', function () {
    $this->getJson('/api/accounting/private')->assertStatus(402);
    arpOn($this->academy);
    arpGroup($this);
    $this->assignTeacher($this->academy, $this->dina, $this->teacher);
    $this->clearTenantContext();
    Sanctum::actingAs($this->owner);

    // An untied block: the student's current teacher is whose it reads as.
    $this->postJson('/api/packages', ['student_id' => $this->dina, 'label' => '10 hours', 'hours' => 10, 'price_minor' => 100000, 'currency' => 'EGP'])->assertCreated();
    // A hand-typed bill has no teacher: not a private lesson.
    $this->postJson('/api/invoices/quick', ['student_id' => $this->dina, 'amount_minor' => 9900, 'currency' => 'EGP', 'description' => 'Books'])->assertCreated();
    $this->postJson('/api/receipts', ['guardian_id' => $this->other, 'amount_minor' => 60000, 'method' => 'CASH'])->assertCreated();
    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 45000, 'method' => 'CASH'])->assertCreated();

    // One private lesson on Mona's June statement.
    arpTenant($this->academy, function () {
        $sessionId = (string) Str::uuid();
        DB::table('sessions')->insert([
            'id' => $sessionId, 'academy_id' => $this->academy, 'student_id' => $this->dina, 'teacher_id' => $this->teacher,
            'occurrence_local_date' => '2026-06-10', 'scheduled_at_utc' => '2026-06-10 14:00:00+00', 'duration_minutes' => 60, 'status' => 'ATTENDED',
        ]);
        $payout = (string) Str::uuid();
        DB::table('payouts')->insert(['id' => $payout, 'academy_id' => $this->academy, 'teacher_id' => $this->teacher, 'period_year' => 2026, 'period_month' => 6, 'total_minor' => 15000, 'currency' => 'EGP']);
        DB::table('payout_line_items')->insert(['id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'payout_id' => $payout, 'session_id' => $sessionId, 'amount_minor' => 15000, 'currency' => 'EGP', 'session_date' => '2026-06-10']);
    });

    $report = $this->getJson('/api/accounting/private?month=2026-06')->assertOk();
    expect($report->json('rows'))->toHaveCount(1);
    // 600 of the 1,090 reached the block, oldest line first, whichever bill came first.
    $row = $report->json('rows.0');
    expect($row)->toMatchArray(['student_name' => 'Dina', 'teacher_name' => 'Miss Mona', 'currency' => 'EGP', 'expected_minor' => 100000, 'teacher_cost_minor' => 15000])
        ->and($row['collected_minor'])->toBe($row['received_in_month_minor'])
        ->and($row['net_minor'])->toBe($row['received_in_month_minor'] - 15000);

    $mona = $report->json('teachers.0');
    expect($mona)->toMatchArray(['teacher_name' => 'Miss Mona', 'students' => 1, 'private_received_minor' => $row['received_in_month_minor'], 'groups_received_minor' => 45000, 'teacher_cost_minor' => 15000])
        ->and($mona['received_in_month_minor'])->toBe($row['received_in_month_minor'] + 45000)
        ->and($mona['net_minor'])->toBe($row['received_in_month_minor'] + 45000 - 15000);

    // No pay to read: no cost, no net, no teachers.
    Sanctum::actingAs($this->supervisor);
    $limited = $this->getJson('/api/accounting/private?month=2026-06')->assertOk();
    expect($limited->json('rows.0.teacher_cost_minor'))->toBeNull()->and($limited->json('rows.0.net_minor'))->toBeNull()->and($limited->json('teachers'))->toBeNull();
});

it('keeps a revenue share on what was billed unless the group says collected, and then follows the receipts', function () {
    // Refused while nothing keeps receipts: only they say what was collected.
    $this->postJson('/api/groups', [
        'name' => 'No books', 'teacher_id' => $this->teacher, 'start_date' => '2026-06-01',
        'slots' => [['weekday' => 2, 'start_time_local' => '17:00', 'duration_minutes' => 60]],
        'billing_mode' => 'MONTHLY', 'price_minor' => 45000, 'currency' => 'EGP',
        'teacher_pay_mode' => 'REVENUE_SHARE', 'teacher_share_bp' => 5000, 'teacher_share_basis' => 'COLLECTED',
    ])->assertStatus(422)->assertJsonValidationErrors('teacher_share_basis');

    arpOn($this->academy);
    arpDrawer($this);

    $billed = arpGroup($this, ['name' => 'Billed', 'teacher_pay_mode' => 'REVENUE_SHARE', 'teacher_share_bp' => 5000]);
    expect(arpShare($this, $billed))->toBe(22500);

    $collected = arpGroup($this, ['name' => 'Collected', 'student_ids' => [$this->dina], 'teacher_pay_mode' => 'REVENUE_SHARE', 'teacher_share_bp' => 5000, 'teacher_share_basis' => 'COLLECTED']);
    expect($this->getJson("/api/groups/{$collected}")->assertOk()->json('group.teacher_pay.share_basis'))->toBe('COLLECTED');
    expect(arpShare($this, $collected))->toBe(0);

    // Part paid, then the rest: the share follows what came in.
    $first = $this->postJson('/api/receipts', ['guardian_id' => $this->other, 'amount_minor' => 20000, 'method' => 'CASH'])->assertCreated()->json('receipt.id');
    expect(arpShare($this, $collected))->toBe(10000);
    $this->postJson('/api/receipts', ['guardian_id' => $this->other, 'amount_minor' => 25000, 'method' => 'CASH'])->assertCreated();
    expect(arpShare($this, $collected))->toBe(22500);
    // Nothing the billed group's teacher was owed moved.
    expect(arpShare($this, $billed))->toBe(22500);

    // A receipt taken back takes its share with it.
    $this->postJson("/api/receipts/{$first}/void", ['reason' => 'Bounced'])->assertOk();
    expect(arpShare($this, $collected))->toBe(12500);

    // Switching a running group over re-reads its month.
    $this->patchJson("/api/groups/{$billed}", ['teacher_share_basis' => 'COLLECTED'])->assertOk();
    expect(arpShare($this, $billed))->toBe(0);

    // A sealed statement is left as it was paid.
    arpTenant($this->academy, fn () => DB::table('payouts')->where('teacher_id', $this->teacher)->where('period_month', 6)->update(['finalized_at' => now()->toIso8601String()]));
    $this->postJson('/api/receipts', ['guardian_id' => $this->other, 'amount_minor' => 20000, 'method' => 'CASH'])->assertCreated();
    expect(arpShare($this, $collected))->toBe(12500);
});

it('counts a payment dated back on the month it reached the line, not a month already gone', function () {
    arpOn($this->academy);
    arpDrawer($this);
    $groupId = arpGroup($this, ['student_ids' => [$this->dina], 'teacher_pay_mode' => 'REVENUE_SHARE', 'teacher_share_bp' => 5000, 'teacher_share_basis' => 'COLLECTED']);

    $this->postJson('/api/receipts', ['guardian_id' => $this->other, 'amount_minor' => 45000, 'method' => 'CASH', 'received_on' => '2026-05-20'])->assertCreated();

    expect(arpShare($this, $groupId))->toBe(22500)->and(arpShare($this, $groupId, '2026-05-01'))->toBeIn([null, 0]);
});

it('gives a client on the accounts rates for every currency, and degrades without them', function () {
    $this->getJson('/api/accounting/exchange-rates')->assertStatus(402);
    arpOn($this->academy);

    Http::fake(['*' => Http::sequence()
        ->push(['result' => 'success', 'time_last_update_unix' => 1, 'rates' => ['EGP' => 1, 'USD' => 0.02, 'OMR' => 0.008]])
        ->push(null, 500)]);

    $rates = collect($this->getJson('/api/accounting/exchange-rates')->assertOk()->assertJsonPath('available', true)->json('rates'));
    expect($rates->firstWhere('currency', 'OMR')['to_home'])->toEqual(125)
        ->and($rates->firstWhere('currency', 'USD')['to_home'])->toEqual(50)
        ->and($rates->firstWhere('currency', 'EGP'))->toBeNull();

    // The source goes down: the last good copy, marked stale.
    Cache::forget('fx_rates_all:EGP');
    $this->getJson('/api/accounting/exchange-rates')->assertOk()->assertJsonPath('stale', true)->assertJsonPath('available', true);

    // Nothing at all to fall back on: no rates, and the report stays per currency.
    Cache::flush();
    $this->getJson('/api/accounting/exchange-rates')->assertOk()->assertJsonPath('available', false)->assertJsonPath('rates', []);
});
