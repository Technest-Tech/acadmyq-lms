<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * The owner's income book (FinanceLedger + the Admin\Finance controllers). What matters here is
 * the money arithmetic — the waterfall over installments, rolling subscription cycles, a sale
 * completing itself when paid off — and the door: Super Admin only, on both the Gate and the
 * database.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
});

function financeAdmin(): void
{
    $admin = test()->makeUser(null, 'SUPER_ADMIN', ['email' => 'sa-finance-'.uniqid().'@test.local']);
    Sanctum::actingAs($admin);
}

/** A one-time sale for a new client, split into two installments. */
function saleInParts(array $overrides = []): array
{
    return array_merge([
        'client' => ['name' => 'Azhary Academy', 'phone' => '+201000000001'],
        'title' => 'Course site + setup',
        'service' => 'COURSE_SITE',
        'kind' => 'ONE_TIME',
        'currency' => 'EGP',
        'started_on' => '2020-01-01',
        'installments' => [
            ['due_on' => '2020-01-01', 'amount_minor' => 200000],
            ['due_on' => '2099-06-01', 'amount_minor' => 300000, 'note' => 'on delivery'],
        ],
    ], $overrides);
}

it('opens the book to a Super Admin only', function () {
    $academy = $this->createAcademy();
    $owner = $this->makeUser($academy, 'ACADEMY_OWNER', ['email' => 'owner-fin@test.local']);

    Sanctum::actingAs($owner);
    $this->getJson('/api/admin/finance/overview')->assertForbidden();
    $this->getJson('/api/admin/finance/deals')->assertForbidden();
    $this->postJson('/api/admin/finance/deals', saleInParts())->assertForbidden();

    financeAdmin();
    $res = $this->getJson('/api/admin/finance/overview')->assertOk();
    expect($res->json('totals'))->toBe([]);
    expect($res->json('counts.clients'))->toBe(0);
});

it('flows money down the installments oldest-first, and completes the sale when paid off', function () {
    financeAdmin();

    $res = $this->postJson('/api/admin/finance/deals', saleInParts())->assertCreated();
    $id = $res->json('deal.id');

    // The total follows the plan, not the (absent) amount field.
    expect($res->json('deal.amount_minor'))->toBe(500000);
    expect($res->json('deal.outstanding_minor'))->toBe(500000);
    expect($res->json('deal.overdue_minor'))->toBe(200000);
    expect($res->json('deal.next_due_on'))->toBe('2020-01-01');
    expect($res->json('schedule.0.status'))->toBe('OVERDUE');
    expect($res->json('schedule.1.status'))->toBe('PENDING');

    // 3,500 received against a 2,000 + 3,000 plan: the first is paid, 1,500 sits on the second.
    $res = $this->postJson("/api/admin/finance/deals/{$id}/payments", [
        'paid_on' => '2020-01-05', 'amount_minor' => 350000, 'method' => 'INSTAPAY', 'reference' => 'IP-1',
    ])->assertCreated();

    expect($res->json('deal.paid_minor'))->toBe(350000);
    expect($res->json('deal.outstanding_minor'))->toBe(150000);
    expect($res->json('deal.overdue_minor'))->toBe(0);
    expect($res->json('deal.next_due_on'))->toBe('2099-06-01');
    expect($res->json('deal.next_due_minor'))->toBe(150000);
    expect($res->json('deal.status'))->toBe('ACTIVE');
    expect($res->json('schedule.0.status'))->toBe('PAID');
    expect($res->json('schedule.1.status'))->toBe('PARTIAL');
    expect($res->json('schedule.1.paid_minor'))->toBe(150000);

    // The rest arrives: the deal closes itself.
    $res = $this->postJson("/api/admin/finance/deals/{$id}/payments", [
        'paid_on' => '2020-02-01', 'amount_minor' => 150000, 'method' => 'CASH',
    ])->assertCreated();

    expect($res->json('deal.outstanding_minor'))->toBe(0);
    expect($res->json('deal.status'))->toBe('COMPLETED');
    expect($res->json('deal.next_due_on'))->toBeNull();
    expect($res->json('payments'))->toHaveCount(2);

    // Removing the last payment reopens it.
    $paymentId = $res->json('payments.0.id');
    $this->deleteJson("/api/admin/finance/payments/{$paymentId}")->assertOk();
    $res = $this->getJson("/api/admin/finance/deals/{$id}")->assertOk();
    expect($res->json('deal.status'))->toBe('ACTIVE');
    expect($res->json('deal.outstanding_minor'))->toBe(150000);

    $this->asSuperAdmin();
    expect(DB::table('audit_log')->where('action', 'finance_deal.created')->where('entity_id', $id)->exists())->toBeTrue();
    expect(DB::table('audit_log')->where('action', 'finance_payment.deleted')->where('entity_id', $paymentId)->exists())->toBeTrue();
});

it('rolls a subscription forward one cycle per payment, keeping the day it started on', function () {
    financeAdmin();

    $res = $this->postJson('/api/admin/finance/deals', [
        'client' => ['name' => 'Noor School'],
        'title' => 'Management system — monthly',
        'service' => 'MANAGEMENT_SYSTEM',
        'kind' => 'SUBSCRIPTION',
        'billing_interval' => 'MONTHLY',
        'amount_minor' => 100000,
        'currency' => 'EGP',
        'started_on' => '2099-01-31',
    ])->assertCreated();
    $id = $res->json('deal.id');

    expect($res->json('schedule'))->toHaveCount(1);
    expect($res->json('deal.next_due_on'))->toBe('2099-01-31');

    // Three months paid at once: three cycles settle, the fourth opens on the anchored day.
    $res = $this->postJson("/api/admin/finance/deals/{$id}/payments", [
        'paid_on' => '2099-01-31', 'amount_minor' => 300000, 'method' => 'BANK_TRANSFER',
    ])->assertCreated();

    $dues = array_column($res->json('schedule'), 'due_on');
    expect($dues)->toBe(['2099-01-31', '2099-02-28', '2099-03-31', '2099-04-30']);
    expect(array_column($res->json('schedule'), 'status'))->toBe(['PAID', 'PAID', 'PAID', 'PENDING']);
    expect($res->json('deal.next_due_on'))->toBe('2099-04-30');
    expect($res->json('deal.next_due_minor'))->toBe(100000);
    expect($res->json('deal.status'))->toBe('ACTIVE');

    // A price change applies to cycles rolled from now on, never to the open one.
    $this->patchJson("/api/admin/finance/deals/{$id}", ['amount_minor' => 120000])->assertOk();
    $res = $this->postJson("/api/admin/finance/deals/{$id}/payments", [
        'paid_on' => '2099-04-30', 'amount_minor' => 100000, 'method' => 'CASH',
    ])->assertCreated();
    expect($res->json('schedule.4.due_on'))->toBe('2099-05-31');
    expect($res->json('schedule.4.amount_minor'))->toBe(120000);

    // Cancelling stops the clock: no further cycle, and nothing owed in the statistics.
    $this->patchJson("/api/admin/finance/deals/{$id}", ['status' => 'CANCELLED'])->assertOk();
    $overview = $this->getJson('/api/admin/finance/overview')->assertOk();
    expect($overview->json('counts.active_subscriptions'))->toBe(0);
    expect($overview->json('totals.0.outstanding_minor'))->toBe(0);
    expect($overview->json('totals.0.total_minor'))->toBe(400000);
});

it('records income paid on the spot as a completed deal, and sums the ledger per currency', function () {
    financeAdmin();

    $this->postJson('/api/admin/finance/deals', [
        'client' => ['name' => 'Walk-in'],
        'title' => 'Landing page',
        'service' => 'CUSTOM_WORK',
        'kind' => 'ONE_TIME',
        'amount_minor' => 50000,
        'currency' => 'USD',
        'started_on' => '2020-03-10',
        'payment' => ['paid_on' => '2020-03-10', 'amount_minor' => 50000, 'method' => 'PAYPAL'],
    ])->assertCreated()->assertJsonPath('deal.status', 'COMPLETED');

    $this->postJson('/api/admin/finance/deals', saleInParts(['payment' => [
        'paid_on' => '2020-01-01', 'amount_minor' => 200000, 'method' => 'CASH',
    ]]))->assertCreated()->assertJsonPath('deal.status', 'ACTIVE');

    $ledger = $this->getJson('/api/admin/finance/payments?sort=-paid_on')->assertOk();
    expect($ledger->json('total'))->toBe(2);
    expect($ledger->json('sums'))->toBe([
        ['currency' => 'EGP', 'amount_minor' => 200000, 'payments' => 1],
        ['currency' => 'USD', 'amount_minor' => 50000, 'payments' => 1],
    ]);

    $usd = $this->getJson('/api/admin/finance/payments?filter[currency]=USD')->assertOk();
    expect($usd->json('total'))->toBe(1);
    expect($usd->json('sums.0.amount_minor'))->toBe(50000);
    expect($usd->json('rows.0.client_name'))->toBe('Walk-in');

    $deals = $this->getJson('/api/admin/finance/deals?filter[status]=ACTIVE')->assertOk();
    expect($deals->json('total'))->toBe(1);
    expect($deals->json('counts.COMPLETED'))->toBe(1);
    expect($deals->json('rows.0.client_name'))->toBe('Azhary Academy');

    $overview = $this->getJson('/api/admin/finance/overview')->assertOk();
    $byCurrency = collect($overview->json('totals'))->keyBy('currency');
    expect($byCurrency['EGP']['outstanding_minor'])->toBe(300000);
    expect($byCurrency['USD']['total_minor'])->toBe(50000);
    expect($overview->json('counts.clients'))->toBe(2);
    expect($overview->json('upcoming.0.remaining_minor'))->toBe(300000);
    expect(collect($overview->json('by_service'))->pluck('service')->all())->toBe([]); // 2020 money is not "this year"
});

it('keeps one client per name and refuses to delete a client with history', function () {
    financeAdmin();

    $client = $this->postJson('/api/admin/finance/clients', ['name' => 'Azhary Academy'])->assertCreated();
    $this->postJson('/api/admin/finance/clients', ['name' => 'azhary academy'])->assertStatus(422);

    // Typing the same name in the deal form's "new client" box lands on the same client.
    $deal = $this->postJson('/api/admin/finance/deals', saleInParts())->assertCreated();
    expect($deal->json('deal.client_id'))->toBe($client->json('client.id'));

    $this->deleteJson('/api/admin/finance/clients/'.$client->json('client.id'))->assertStatus(409);
    $this->deleteJson('/api/admin/finance/deals/'.$deal->json('deal.id'))->assertOk();
    $this->deleteJson('/api/admin/finance/clients/'.$client->json('client.id'))->assertOk();
});

it('rejects a subscription without a cycle and a sale without money', function () {
    financeAdmin();

    $this->postJson('/api/admin/finance/deals', saleInParts([
        'kind' => 'SUBSCRIPTION', 'installments' => [], 'amount_minor' => 1000,
    ]))->assertStatus(422)->assertJsonValidationErrors('billing_interval');

    $this->postJson('/api/admin/finance/deals', saleInParts(['installments' => []]))
        ->assertStatus(422)->assertJsonValidationErrors('amount_minor');
});

it('hides the book from every academy context — the database says so, not just the Gate', function () {
    financeAdmin();
    $this->postJson('/api/admin/finance/deals', saleInParts())->assertCreated();

    $academy = $this->createAcademy();
    $this->asAcademy($academy);

    expect(DB::table('finance_clients')->count())->toBe(0);
    expect(DB::table('finance_deals')->count())->toBe(0);
    expect(DB::table('finance_installments')->count())->toBe(0);
});
