<?php

declare(strict_types=1);

use App\Jobs\AccountsDailyJob;
use App\Services\AccountReminders;
use App\Services\FinanceLedger;
use App\Services\PlatformAccounts;
use Carbon\CarbonImmutable;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * Accounts (2026-11-08): the owner's book became the platform's one money book. What matters:
 * an agreement turns into the right schedule (monthly … yearly with a discount, one payment +
 * yearly support, outright), unpaid cycles accrue, money from a client pays its oldest dues, a
 * changed agreement keeps what was owed, a client pays from one link and the proof lands in the
 * book, the old bills move in, and the reminders go out once per step.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->admin = $this->makeUser(null, 'SUPER_ADMIN', ['email' => 'sa-acct-'.uniqid().'@test.local']);
});

function acctToday(): CarbonImmutable
{
    return CarbonImmutable::parse((string) DB::selectOne('select current_date::text as d')->d);
}

/** A monthly agreement for a platform client, first due on $firstDue. */
function acctMonthly(string $firstDue, int $amount = 100000): array
{
    return [
        'plan' => 'MONTHLY',
        'currency' => 'EGP',
        'recurring' => ['amount_minor' => $amount, 'first_due_on' => $firstDue],
    ];
}

it('keeps Accounts to the Super Admin', function () {
    $academyId = $this->createAcademy();
    Sanctum::actingAs($this->makeUser($academyId, 'ACADEMY_OWNER'));

    $this->getJson('/api/admin/finance/dues')->assertForbidden();
    $this->putJson("/api/admin/clients/{$academyId}/agreement", acctMonthly('2099-01-01'))->assertForbidden();
    $this->getJson("/api/admin/clients/{$academyId}/account")->assertForbidden();
});

it('opens a platform client account from its agreement and shows it on the client page', function () {
    $academyId = $this->createAcademy(overrides: ['name' => 'Noor Academy']);
    Sanctum::actingAs($this->admin);

    $this->getJson("/api/admin/clients/{$academyId}/account")->assertOk()->assertJson(['account' => null]);

    $res = $this->putJson("/api/admin/clients/{$academyId}/agreement", acctMonthly('2099-03-31'))->assertOk();
    expect($res->json('account.plan'))->toBe('MONTHLY');
    expect($res->json('account.academy_id'))->toBe($academyId);
    expect($res->json('account.name'))->toBe('Noor Academy');
    expect($res->json('account.next_due_on'))->toBe('2099-03-31');
    expect($res->json('deals'))->toHaveCount(1);
    expect($res->json('deals.0.billing_interval'))->toBe('MONTHLY');
    expect($res->json('pay_url'))->toContain('/a/');

    // The client page and the roster read the same account.
    $show = $this->getJson("/api/admin/clients/{$academyId}")->assertOk();
    expect($show->json('account.plan'))->toBe('MONTHLY');
    expect($show->json('account.recurring.amount_minor'))->toBe(100000);
    $row = collect($this->getJson('/api/admin/clients')->assertOk()->json('clients'))->firstWhere('id', $academyId);
    expect($row['account']['next_due_on'])->toBe('2099-03-31');
});

it('runs every 6 months, and yearly with the discount on record', function () {
    $a = $this->createAcademy();
    $b = $this->createAcademy();
    Sanctum::actingAs($this->admin);

    $semi = $this->putJson("/api/admin/clients/{$a}/agreement", [
        'plan' => 'SEMI_ANNUAL', 'currency' => 'EGP',
        'recurring' => ['amount_minor' => 540000, 'first_due_on' => '2099-01-31'],
    ])->assertOk();
    $dealId = $semi->json('deals.0.id');
    // Pay one cycle: the next one opens six months later, on the anchored day.
    $this->postJson("/api/admin/finance/deals/{$dealId}/payments", [
        'paid_on' => '2099-01-31', 'amount_minor' => 540000, 'method' => 'INSTAPAY',
    ])->assertCreated();
    $sched = $this->getJson("/api/admin/finance/deals/{$dealId}")->assertOk()->json('schedule');
    expect(array_column($sched, 'due_on'))->toBe(['2099-01-31', '2099-07-31']);

    $yearly = $this->putJson("/api/admin/clients/{$b}/agreement", [
        'plan' => 'YEARLY', 'currency' => 'EGP',
        'recurring' => ['amount_minor' => 1020000, 'list_amount_minor' => 1200000, 'first_due_on' => '2099-02-01'],
    ])->assertOk();
    expect($yearly->json('deals.0.list_amount_minor'))->toBe(1200000);
    expect($yearly->json('account.rec_list_amount_minor'))->toBe(1200000);
    expect($yearly->json('deals.0.billing_interval'))->toBe('YEARLY');

    // The run-rate counts six months as a sixth and a year as a twelfth.
    $mrr = $this->getJson('/api/admin/finance/overview')->assertOk()->json('totals.0.mrr_minor');
    expect($mrr)->toBe(90000 + 85000);
});

it('sells the system once plus yearly support and server, and outright to a client off our servers', function () {
    $academyId = $this->createAcademy();
    Sanctum::actingAs($this->admin);

    $res = $this->putJson("/api/admin/clients/{$academyId}/agreement", [
        'plan' => 'ONE_TIME_SUPPORT', 'currency' => 'EGP',
        'one_time' => ['installments' => [
            ['due_on' => '2099-01-01', 'amount_minor' => 2000000],
            ['due_on' => '2099-03-01', 'amount_minor' => 1000000],
        ]],
        'recurring' => ['amount_minor' => 500000, 'first_due_on' => '2100-01-01'],
        'paid_now' => ['amount_minor' => 2000000, 'paid_on' => '2099-01-01', 'method' => 'BANK_TRANSFER'],
    ])->assertOk();

    $deals = collect($res->json('deals'))->keyBy('kind');
    expect($deals['ONE_TIME']['amount_minor'])->toBe(3000000);
    expect($deals['ONE_TIME']['outstanding_minor'])->toBe(1000000); // the down payment went to the first part
    expect($deals['SUBSCRIPTION']['service'])->toBe('HOSTING');
    expect($deals['SUBSCRIPTION']['billing_interval'])->toBe('YEARLY');
    expect($res->json('account.plan'))->toBe('ONE_TIME_SUPPORT');
    expect($res->json('account.next_due_on'))->toBe('2099-03-01');

    // Outright, off our servers: an account with no academy, support optional (none here).
    $ext = $this->postJson('/api/admin/finance/clients', [
        'name' => 'Al-Huda Centre (own server)',
        'phone' => '+201000000777',
        'agreement' => [
            'plan' => 'OUTRIGHT', 'currency' => 'USD',
            'one_time' => ['installments' => [['due_on' => '2099-05-01', 'amount_minor' => 300000]]],
        ],
    ])->assertCreated();
    expect($ext->json('account.academy_id'))->toBeNull();
    expect($ext->json('account.plan'))->toBe('OUTRIGHT');
    expect($ext->json('deals'))->toHaveCount(1);
    expect($ext->json('deals.0.service'))->toBe('MANAGEMENT_SYSTEM');

    $hosted = $this->getJson('/api/admin/finance/clients?hosted=0')->assertOk();
    expect(collect($hosted->json('rows'))->pluck('name'))->toContain('Al-Huda Centre (own server)');
});

it('owes every cycle that has started, not just one, when a client stops paying', function () {
    $academyId = $this->createAcademy();
    Sanctum::actingAs($this->admin);

    // Monthly since ~2 months and a few days ago, nothing paid: three cycles are owed.
    $first = acctToday()->subMonthsNoOverflow(2)->subDays(3)->toDateString();
    $res = $this->putJson("/api/admin/clients/{$academyId}/agreement", acctMonthly($first))->assertOk();

    expect($res->json('deals.0.outstanding_minor'))->toBe(300000);
    expect(collect($res->json('deals.0.schedule'))->where('status', 'OVERDUE'))->toHaveCount(3);
    expect($res->json('account.has_overdue'))->toBeTrue();

    // Money from the client pays the oldest cycle first, then the next.
    $paid = $this->postJson("/api/admin/finance/clients/{$res->json('account.id')}/payments", [
        'currency' => 'EGP', 'paid_on' => acctToday()->toDateString(), 'amount_minor' => 150000, 'method' => 'CASH',
    ])->assertCreated();
    $statuses = array_column($paid->json('deals.0.schedule'), 'status');
    expect($statuses)->toBe(['PAID', 'OVERDUE', 'OVERDUE']);
    expect($paid->json('deals.0.outstanding_minor'))->toBe(150000);

    // The nightly sweep rolls nothing new until the next cycle starts.
    (new AccountsDailyJob(remind: false))->handle(app(FinanceLedger::class), app(AccountReminders::class));
    $this->asSuperAdmin();
    expect(DB::table('finance_installments')->where('deal_id', $res->json('deals.0.id'))->count())->toBe(3);
});

it('spreads money from a client over the oldest dues of every line', function () {
    $academyId = $this->createAcademy();
    Sanctum::actingAs($this->admin);

    $res = $this->putJson("/api/admin/clients/{$academyId}/agreement", [
        'plan' => 'ONE_TIME_SUPPORT', 'currency' => 'EGP',
        'one_time' => ['installments' => [['due_on' => '2020-01-01', 'amount_minor' => 50000]]],
        'recurring' => ['amount_minor' => 20000, 'first_due_on' => '2099-01-01'],
    ])->assertOk();
    $clientId = $res->json('account.id');

    // 60,000: 50,000 clears the old purchase, 10,000 goes ahead on the support line.
    $after = $this->postJson("/api/admin/finance/clients/{$clientId}/payments", [
        'currency' => 'EGP', 'paid_on' => '2026-01-01', 'amount_minor' => 60000, 'method' => 'INSTAPAY',
    ])->assertCreated();
    $deals = collect($after->json('deals'))->keyBy('kind');
    expect($deals['ONE_TIME']['status'])->toBe('COMPLETED');
    expect($deals['SUBSCRIPTION']['paid_minor'])->toBe(10000);
    expect($deals['SUBSCRIPTION']['outstanding_minor'])->toBe(10000);
    expect($after->json('payments'))->toHaveCount(2);
});

it('changes the agreement without forgiving what was already due', function () {
    $academyId = $this->createAcademy();
    Sanctum::actingAs($this->admin);

    $first = acctToday()->subMonthNoOverflow()->subDays(2)->toDateString();
    $monthly = $this->putJson("/api/admin/clients/{$academyId}/agreement", acctMonthly($first))->assertOk();
    $oldId = $monthly->json('deals.0.id');
    expect($monthly->json('deals.0.outstanding_minor'))->toBe(200000);

    // Yearly from next month: the two started months stay owed on the old line, which stops.
    $next = acctToday()->addMonthNoOverflow()->startOfMonth()->toDateString();
    $yearly = $this->putJson("/api/admin/clients/{$academyId}/agreement", [
        'plan' => 'YEARLY', 'currency' => 'EGP',
        'recurring' => ['amount_minor' => 1000000, 'list_amount_minor' => 1200000, 'first_due_on' => $next],
    ])->assertOk();

    $old = collect($yearly->json('deals'))->firstWhere('id', $oldId);
    expect($old['ends_on'])->toBe($next);
    expect($old['outstanding_minor'])->toBe(200000);
    expect($old['status'])->toBe('ACTIVE');
    $new = collect($yearly->json('deals'))->firstWhere('billing_interval', 'YEARLY');
    expect($new['next_due_on'])->toBe($next);
    expect($yearly->json('account.plan'))->toBe('YEARLY');
    expect($yearly->json('account.rec_interval'))->toBe('YEARLY');

    // Paid off, the old line completes itself and rolls no further month.
    $this->postJson("/api/admin/finance/deals/{$oldId}/payments", [
        'paid_on' => acctToday()->toDateString(), 'amount_minor' => 200000, 'method' => 'CASH',
    ])->assertCreated();
    $this->asSuperAdmin();
    (new AccountsDailyJob(remind: false))->handle(app(FinanceLedger::class), app(AccountReminders::class));
    $this->asSuperAdmin();
    expect(DB::table('finance_installments')->where('deal_id', $oldId)->count())->toBe(2);

    // An agreement fixed a minute after it was made leaves no empty line behind.
    $other = $this->createAcademy();
    Sanctum::actingAs($this->admin);
    $this->putJson("/api/admin/clients/{$other}/agreement", acctMonthly('2099-01-01'))->assertOk();
    $fixed = $this->putJson("/api/admin/clients/{$other}/agreement", acctMonthly('2099-01-01', 120000))->assertOk();
    expect($fixed->json('deals'))->toHaveCount(1);
    expect($fixed->json('deals.0.amount_minor'))->toBe(120000);
});

it('lets the client pay from one link; the approved proof lands in the book', function () {
    Storage::fake('local');
    $academyId = $this->createAcademy(overrides: ['name' => 'Link Academy']);
    Sanctum::actingAs($this->admin);
    $first = acctToday()->subDays(3)->toDateString();
    $res = $this->putJson("/api/admin/clients/{$academyId}/agreement", acctMonthly($first, 75000))->assertOk();
    $token = Str::afterLast($res->json('pay_url'), '/a/');

    $this->clearTenantContext();
    $page = $this->getJson("/api/a/{$token}")->assertOk()->assertHeader('X-Robots-Tag', 'noindex, nofollow');
    expect($page->json('client_name'))->toBe('Link Academy');
    expect($page->json('overdue'))->toBeTrue();
    expect($page->json('due_now.0.amount_minor'))->toBe(75000);
    expect($page->json())->toHaveKey('payment_methods');
    $this->getJson('/api/a/'.Str::random(22))->assertNotFound();

    $this->post("/api/a/{$token}/submit", [
        'method' => 'INSTAPAY',
        'amount' => 75000,
        'screenshot' => UploadedFile::fake()->image('proof.png'),
    ])->assertOk();
    expect($this->getJson("/api/a/{$token}")->json('pending_proof'))->toBeTrue();

    Sanctum::actingAs($this->admin);
    $dues = $this->getJson('/api/admin/finance/dues')->assertOk();
    $proof = collect($dues->json('proofs'))->firstWhere('client_name', 'Link Academy');
    expect($proof['amount_minor'])->toBe(75000);
    expect(collect($dues->json('late'))->pluck('client_id'))->toContain($res->json('account.id'));

    $this->postJson("/api/admin/finance/submissions/{$proof['id']}/approve", ['amount_minor' => 75000])->assertOk();
    $this->postJson("/api/admin/finance/submissions/{$proof['id']}/approve", ['amount_minor' => 75000])->assertStatus(409);

    $account = $this->getJson("/api/admin/clients/{$academyId}/account")->assertOk();
    expect($account->json('account.has_overdue'))->toBeFalse();
    expect($account->json('payments.0.method'))->toBe('INSTAPAY');
    expect($account->json('submissions.0.status'))->toBe('APPROVED');
});

it('shows the academy owner what it owes, and nobody else at the academy', function () {
    $academyId = $this->createAcademy();
    Sanctum::actingAs($this->admin);
    $this->putJson("/api/admin/clients/{$academyId}/agreement", acctMonthly(acctToday()->addDays(3)->toDateString(), 50000))->assertOk();

    Sanctum::actingAs($this->makeUser($academyId, 'ACADEMY_OWNER'));
    $mine = $this->getJson('/api/my-subscription')->assertOk();
    expect($mine->json('account.due_now.0.amount_minor'))->toBe(50000);
    expect($mine->json('account.pay_token'))->not->toBeNull();

    Sanctum::actingAs($this->makeUser($academyId, 'TEACHER'));
    expect($this->getJson('/api/my-subscription')->assertOk()->json('account'))->toBeNull();
});

it('lists trials ending soon and paid clients with no agreement on the Dues screen', function () {
    $paid = $this->createAcademy(overrides: ['name' => 'Paid No Deal']);
    $this->asAcademy($paid);
    DB::table('module_subscriptions')->where('academy_id', $paid)->update(['total_cost_minor' => 99900, 'base_price_minor' => 99900]);
    $trial = $this->createAcademy(overrides: ['name' => 'Trial Soon'], modules: []);
    $this->createModuleSubscription($trial, 'MANAGEMENT', ['is_trial' => true, 'trial_end' => now()->addDays(2)]);

    Sanctum::actingAs($this->admin);
    $dues = $this->getJson('/api/admin/finance/dues')->assertOk();
    $unagreed = collect($dues->json('unagreed'))->firstWhere('academy_id', $paid);
    expect($unagreed['suggested_minor'])->toBe(99900);
    expect(collect($dues->json('trials'))->pluck('academy_id'))->toContain($trial);
    expect(collect($dues->json('unagreed'))->pluck('academy_id'))->not->toContain($trial);
    expect($dues->json('reminders.ready'))->toBeFalse();
});

it('brings the old bills of a platform client into the book once', function () {
    $academyId = $this->createAcademy(overrides: ['name' => 'Legacy Billed']);
    $this->asAcademy($academyId);
    DB::table('module_subscriptions')->where('academy_id', $academyId)
        ->update(['total_cost_minor' => 80000, 'base_price_minor' => 80000, 'billing_interval' => 'MONTHLY']);
    $first = acctToday()->subMonthsNoOverflow(1)->startOfMonth();
    foreach ([[$first, 'PAID'], [$first->addMonthNoOverflow(), 'OPEN']] as [$start, $status]) {
        DB::table('academy_invoices')->insert([
            'id' => (string) Str::uuid(), 'academy_id' => $academyId,
            'period_start' => $start->toDateString(), 'period_end' => $start->addMonthNoOverflow()->toDateString(),
            'status' => $status, 'currency' => 'EGP', 'total_minor' => 80000,
            'amount_paid_minor' => $status === 'PAID' ? 80000 : 0,
            'payment_method' => $status === 'PAID' ? 'INSTAPAY' : null,
            'paid_at' => $status === 'PAID' ? $start->addDays(2) : null,
            'due_date' => $start->addDays(7)->toDateString(), 'public_token' => 'oldbill'.Str::random(15),
        ]);
    }
    $oldToken = DB::table('academy_invoices')->where('academy_id', $academyId)->where('status', 'OPEN')->value('public_token');

    $this->artisan('accounts:adopt-billing', ['--academy' => $academyId])->assertSuccessful();
    $this->artisan('accounts:adopt-billing', ['--academy' => $academyId])->assertSuccessful(); // idempotent

    Sanctum::actingAs($this->admin);
    $acct = $this->getJson("/api/admin/clients/{$academyId}/account")->assertOk();
    expect($acct->json('deals'))->toHaveCount(1);
    expect($acct->json('account.plan'))->toBe('MONTHLY');
    $schedule = $acct->json('deals.0.schedule');
    expect(array_slice(array_column($schedule, 'status'), 0, 2))->toBe(['PAID', $schedule[1]['status']]);
    expect($schedule[1]['remaining_minor'])->toBe(80000);
    expect($acct->json('payments'))->toHaveCount(1);

    // A link the client holds to its old bill opens its account now.
    $this->clearTenantContext();
    expect($this->getJson("/api/a/{$oldToken}")->assertOk()->json('client_name'))->toBe('Legacy Billed');
});

it('reminds the client once per step and sends the owner one digest', function () {
    expect(AccountReminders::stepFor(-7))->toBe('before7');
    expect(AccountReminders::stepFor(-2))->toBe('before7');
    expect(AccountReminders::stepFor(-1))->toBe('before1');
    expect(AccountReminders::stepFor(0))->toBe('before1');
    expect(AccountReminders::stepFor(1))->toBe('late0');
    expect(AccountReminders::stepFor(8))->toBe('late1');
    expect(AccountReminders::stepFor(-8))->toBeNull();
    expect(AccountReminders::stepFor(60))->toBeNull();

    Http::fake(['*' => Http::response(['data' => ['msgId' => 'wamid.1']], 200)]);

    // The sending number: a client of ours with a connected WhatsApp.
    $sender = $this->createAcademy(overrides: ['name' => 'Owner WhatsApp', 'client_type' => 'WHATSAPP']);
    $this->asAcademy($sender);
    DB::table('academy_automation_settings')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $sender,
        'wasender_token' => Crypt::encryptString('sender-token'),
        'created_at' => now(), 'updated_at' => now(),
    ]);
    $this->asSuperAdmin();
    DB::table('platform_settings')->updateOrInsert(['key' => AccountReminders::SETTINGS_KEY], [
        'value' => json_encode(['enabled' => true, 'sender_academy_id' => $sender, 'owner_phone' => '+201111111111']),
        'updated_at' => now(),
    ]);

    $academyId = $this->createAcademy(overrides: ['name' => 'Late Payer']);
    Sanctum::actingAs($this->admin);
    $this->putJson("/api/admin/clients/{$academyId}/agreement", acctMonthly(acctToday()->subDays(2)->toDateString(), 60000))->assertOk();
    $clientId = DB::table('finance_clients')->where('linked_academy_id', $academyId)->value('id');
    $this->asSuperAdmin();
    DB::table('finance_clients')->where('id', $clientId)->update(['phone' => '+201222222222']);

    $run = fn () => (new AccountsDailyJob)->handle(app(FinanceLedger::class), app(AccountReminders::class));
    $first = $run();
    expect($first['reminders']['sent'])->toBe(1);
    expect($first['reminders']['digest'])->toBeTrue();

    $second = $run();
    expect($second['reminders']['sent'])->toBe(0);
    expect($second['reminders']['digest'])->toBeFalse();

    $this->asSuperAdmin();
    expect(DB::table('finance_reminder_log')->where('client_id', $clientId)->where('status', 'SENT')->pluck('key')->all())
        ->each->toEndWith(':late0');

    $message = AccountReminders::clientMessage('Late Payer', app(FinanceLedger::class)->openDues(7, (string) $clientId), 'https://x/a/t');
    expect($message)->toContain('600 EGP')->toContain('https://x/a/t');
});

it('adopts a book entry the owner typed before the link existed', function () {
    Sanctum::actingAs($this->admin);
    $typed = $this->postJson('/api/admin/finance/clients', ['name' => 'Bright Steps'])->assertCreated()->json('client.id');
    $academyId = $this->createAcademy(overrides: ['name' => 'bright steps']);

    $this->asSuperAdmin();
    $id = app(PlatformAccounts::class)->ensureForAcademy($academyId);
    expect($id)->toBe($typed);
    expect(DB::table('finance_clients')->where('id', $typed)->value('linked_academy_id'))->toBe($academyId);
});

it('keeps the money when a platform client is wiped: its account is unlinked, not deleted', function () {
    $academyId = $this->createAcademy(overrides: ['name' => 'Gone Academy']);
    Sanctum::actingAs($this->admin);
    $this->putJson("/api/admin/clients/{$academyId}/agreement", acctMonthly('2020-01-01', 50000))->assertOk();
    $clientId = $this->getJson("/api/admin/clients/{$academyId}/account")->json('account.id');
    $this->postJson("/api/admin/finance/clients/{$clientId}/payments", [
        'currency' => 'EGP', 'paid_on' => '2020-01-02', 'amount_minor' => 50000, 'method' => 'CASH',
    ])->assertCreated();

    $this->deleteJson("/api/admin/clients/{$academyId}", ['confirm_name' => 'Gone Academy'])->assertOk();

    $this->asSuperAdmin();
    expect(DB::table('academies')->where('id', $academyId)->exists())->toBeFalse();
    $account = DB::table('finance_clients')->where('id', $clientId)->first();
    expect($account)->not->toBeNull();
    expect($account->linked_academy_id)->toBeNull();
    expect((int) DB::table('finance_payments')->join('finance_deals', 'finance_deals.id', '=', 'finance_payments.deal_id')
        ->where('finance_deals.client_id', $clientId)->sum('finance_payments.amount_minor'))->toBe(50000);
});
