<?php

declare(strict_types=1);

use App\Services\ModuleBilling;
use Database\Seeders\DemoAcademySeeder;
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
 * The Accounting section's pages (docs/groups/01-ACCOUNTING.md): overview, group collection &
 * profit, arrears (aged) + WhatsApp reminder, statement of account, daily collections. Pinned here:
 *   - an academy WITHOUT accounting never reaches any of it, and its old group pages are untouched;
 *   - every figure is the receipts' (partial payments, credit, voids), and money stays with money roles.
 */
beforeEach(function () {
    // Wednesday 17 June 2026. The group runs from 1 May: May + June are billed (450 each, per kid).
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'invoice_grouping' => 'PER_GUARDIAN']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-pages@test.local', 'full_name' => 'Owner Omar']);
    $this->supervisor = $this->makeUser($this->academy, 'SUPERVISOR', ['email' => 'sup-pages@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona', 'session_rate_minor' => 6000, 'currency' => 'EGP']);
    $this->parent = $this->createGuardian($this->academy, ['full_name' => 'Parent of two', 'whatsapp_phone' => '+201001112223']);
    $this->adam = $this->createStudent($this->academy, $this->parent, ['full_name' => 'Adam', 'status' => 'REGULAR']);
    $this->bassel = $this->createStudent($this->academy, $this->parent, ['full_name' => 'Bassel', 'status' => 'REGULAR']);
    $this->mother = $this->createGuardian($this->academy, ['full_name' => 'Celine’s mother', 'whatsapp_phone' => '+201009998887']);
    $this->celine = $this->createStudent($this->academy, $this->mother, ['full_name' => 'Celine', 'status' => 'REGULAR']);
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    $this->groupId = $this->postJson('/api/groups', [
        'name' => 'English A1',
        'teacher_id' => $this->teacher,
        'start_date' => '2026-05-01',
        'slots' => [['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60]],
        'billing_mode' => 'MONTHLY',
        'price_minor' => 45000,
        'currency' => 'EGP',
        'student_ids' => [$this->adam, $this->bassel, $this->celine],
    ])->assertCreated()->json('group.id');
});

afterEach(fn () => Carbon::setTestNow());

function apgSwitchOn(string $academyId): void
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

function apgLine(string $academyId, string $studentId, string $period): string
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'ACADEMY_OWNER', true)");
    try {
        return (string) DB::table('invoice_line_items')->where('student_id', $studentId)->where('group_period', $period)->value('id');
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

/** Adam: May + June paid (cash). Bassel: 200 of June (InstaPay). Celine: nothing. */
function apgPayments($test): void
{
    apgSwitchOn($test->academy);
    Sanctum::actingAs($test->owner);
    $test->postJson('/api/receipts', [
        'guardian_id' => $test->parent, 'amount_minor' => 90000, 'method' => 'CASH', 'apply_rest' => false,
        'line_ids' => [apgLine($test->academy, $test->adam, '2026-05-01'), apgLine($test->academy, $test->adam, '2026-06-01')],
    ])->assertCreated();
    $test->postJson('/api/receipts', [
        'guardian_id' => $test->parent, 'amount_minor' => 20000, 'method' => 'INSTAPAY', 'apply_rest' => false,
        'line_ids' => [apgLine($test->academy, $test->bassel, '2026-06-01')],
    ])->assertCreated();
}

it('stays out of reach for an academy without accounting, whose old group pages are unchanged', function () {
    Sanctum::actingAs($this->owner);
    foreach (['overview', 'groups', 'arrears', 'daily', 'statement?guardian_id='.$this->parent] as $page) {
        $this->getJson("/api/accounting/{$page}")->assertStatus(402);
    }
    $this->postJson('/api/accounting/arrears/remind', ['guardian_id' => $this->parent])->assertStatus(402);

    // The classic group pages answer exactly as before, with no receipt-based figures.
    $board = $this->getJson('/api/group-payments?month=2026-06')->assertOk();
    expect($board->json('accounting'))->toBeFalse()
        ->and($board->json('totals.0.billed_minor'))->toBe(135000)
        ->and($board->json('totals.0.paid_minor'))->toBe(0);
    $this->getJson("/api/groups/{$this->groupId}/money?month=2026-06")->assertOk();
    $this->getJson('/api/group-reports')->assertOk();
    expect(DB::table('academy_ledgers')->count())->toBe(0);
});

it('gives the month at a glance: collected by method, collector and day, what is owed and how old', function () {
    apgPayments($this);

    $res = $this->getJson('/api/accounting/overview?month=2026-06')->assertOk();
    $collected = $res->json('collected.0');
    expect($collected['amount_minor'])->toBe(110000)
        ->and($collected['count'])->toBe(2)
        ->and($collected['today_minor'])->toBe(110000)
        ->and($collected['by_method'])->toBe(['CASH' => 90000, 'INSTAPAY' => 20000])
        ->and($collected['by_collector'][0]['name'])->toBe('Owner Omar')
        ->and(collect($collected['by_day'])->firstWhere('date', '2026-06-17')['amount_minor'])->toBe(110000)
        ->and($collected['by_day'])->toHaveCount(30);

    // June billed 1350; 450 (Adam) + 200 (Bassel) of it is paid.
    expect($res->json('billed.0'))->toMatchArray(['billed_minor' => 135000, 'paid_minor' => 65000]);
    // Owed: 2700 billed − 1100 paid = 1600; May's unpaid (Bassel + Celine = 900) is overdue.
    expect($res->json('owed.0'))->toMatchArray(['due_minor' => 160000, 'overdue_minor' => 90000, 'payers' => 2, 'd0_30' => 70000, 'd31_60' => 90000]);
    expect($res->json('top_debtors.0.name'))->toBe('Celine’s mother');
    expect($res->json('recent_receipts'))->toHaveCount(2);
});

it('shows every group’s collection and profit, and a per-teacher roll-up for payroll readers', function () {
    apgPayments($this);

    $res = $this->getJson('/api/accounting/groups?month=2026-06')->assertOk();
    $row = collect($res->json('groups'))->firstWhere('id', $this->groupId);
    expect($row['students'])->toBe(3);
    expect($row['money'][0])->toMatchArray([
        'expected_minor' => 135000, 'collected_minor' => 65000, 'remaining_minor' => 70000,
        'arrears_minor' => 90000, 'received_in_month_minor' => 110000, 'rate' => 0.4815,
        'teacher_cost_minor' => 0, 'net_minor' => 110000,
    ]);
    expect($res->json('teachers.0'))->toMatchArray(['teacher_name' => 'Miss Mona', 'groups' => 1, 'collected_minor' => 65000]);

    // A supervisor never reaches money.
    Sanctum::actingAs($this->supervisor);
    $this->getJson('/api/accounting/groups')->assertForbidden();
    $this->getJson('/api/accounting/overview')->assertForbidden();
});

it('lists who owes, aged, filtered by group, bucket and name', function () {
    apgPayments($this);

    $res = $this->getJson('/api/accounting/arrears')->assertOk();
    $payers = collect($res->json('payers'));
    expect($payers)->toHaveCount(2);
    $parent = $payers->firstWhere('id', $this->parent);
    expect($parent['students'])->toEqualCanonicalizing(['Bassel'])
        ->and($parent['groups'])->toBe(['English A1'])
        ->and($parent['balances'][0])->toMatchArray(['due_minor' => 70000, 'overdue_minor' => 45000, 'd0_30' => 25000, 'd31_60' => 45000])
        ->and($parent['oldest_due'])->toBe('2026-05-01')
        ->and($parent['last_receipt']['amount_minor'])->toBe(20000)
        ->and($parent['phone'])->toBe('+201001112223');
    expect($res->json('totals.0'))->toMatchArray(['due_minor' => 160000, 'payers' => 2]);

    expect($this->getJson('/api/accounting/arrears?q=celine')->json('payers'))->toHaveCount(1);
    expect($this->getJson('/api/accounting/arrears?bucket=d90_plus')->json('payers'))->toHaveCount(0);
    expect($this->getJson("/api/accounting/arrears?group_id={$this->groupId}")->json('payers'))->toHaveCount(2);
});

it('sends a payer a WhatsApp reminder of what they owe', function () {
    apgPayments($this);

    $res = $this->postJson('/api/accounting/arrears/remind', ['guardian_id' => $this->mother])->assertOk();
    expect($res->json('phone'))->toBe('+201009998887')
        ->and($res->json('message'))->toContain('900.00 EGP')
        ->and($res->json('message'))->toContain('/i/');

    // Nothing owed → refused, not an empty message.
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/receipts', ['guardian_id' => $this->mother, 'amount_minor' => 90000, 'method' => 'CASH'])->assertCreated();
    $this->postJson('/api/accounting/arrears/remind', ['guardian_id' => $this->mother])->assertStatus(422);
});

it('builds a statement of account with an opening balance and a running balance', function () {
    apgPayments($this);

    $res = $this->getJson("/api/accounting/statement?guardian_id={$this->parent}&from=2026-06-01&to=2026-06-30")->assertOk();
    $egp = $res->json('currencies.0');
    // May's two charges (900) are before the window: they open it.
    expect($egp['opening_minor'])->toBe(90000)
        ->and($egp['charges_minor'])->toBe(90000)
        ->and($egp['receipts_minor'])->toBe(110000)
        ->and($egp['closing_minor'])->toBe(70000);
    expect(array_column($egp['entries'], 'kind'))->toBe(['CHARGE', 'CHARGE', 'RECEIPT', 'RECEIPT']);
    expect(end($egp['entries'])['balance_minor'])->toBe(70000);
    expect($res->json('students'))->toBe(['Adam', 'Bassel']);
    expect($res->json('balance.0.due_minor'))->toBe(70000);

    // Asked for a child, it is the family's statement.
    expect($this->getJson("/api/accounting/statement?student_id={$this->adam}")->json('payer.id'))->toBe($this->parent);
});

it('counts the day’s collections by method and collector, voids apart', function () {
    apgPayments($this);
    $voidMe = $this->postJson('/api/receipts', ['guardian_id' => $this->mother, 'amount_minor' => 1000, 'method' => 'WALLET'])->json('receipt.id');
    $this->postJson("/api/receipts/{$voidMe}/void", ['reason' => 'Wrong family'])->assertOk();

    $res = $this->getJson('/api/accounting/daily?from=2026-06-15&to=2026-06-17')->assertOk();
    expect(array_column($res->json('days'), 'date'))->toBe(['2026-06-17', '2026-06-16', '2026-06-15']);
    $today = $res->json('days.0');
    expect($today['voided'])->toBe(1)
        ->and($today['currencies'][0]['amount_minor'])->toBe(110000)
        ->and($today['currencies'][0]['by_method'])->toBe(['CASH' => 90000, 'INSTAPAY' => 20000])
        ->and($today['currencies'][0]['by_collector'][0]['name'])->toBe('Owner Omar');
    expect($res->json('days.1.currencies'))->toBe([]);
    expect($res->json('totals.0.amount_minor'))->toBe(110000);

    $this->getJson('/api/accounting/daily?from=2026-01-01&to=2026-06-17')->assertStatus(422);
});
