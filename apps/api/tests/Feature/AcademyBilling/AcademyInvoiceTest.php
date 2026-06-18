<?php

declare(strict_types=1);

use App\Jobs\GenerateAcademyInvoicesJob;
use App\Jobs\SendAcademyBillRemindersJob;
use App\Services\AcademyBilling;
use App\Services\Whatsapp\WhatsAppSender;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
});

/** A non-trial academy with a paid plan, activated so it can be billed. */
function billableAcademy(object $test, int $price = 60000): string
{
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    DB::statement("select set_config('app.current_academy_id', '', true)");

    $typeId = (string) Str::uuid();
    DB::table('academy_types')->insert(['id' => $typeId, 'code' => 'BT-'.substr($typeId, 0, 8), 'name' => 'Billable Type']);

    $planId = (string) Str::uuid();
    DB::table('plans')->insert([
        'id' => $planId,
        'code' => 'BILL-'.substr($planId, 0, 8),
        'name' => 'Billable',
        'price_minor' => $price,
        'currency' => 'EGP',
        'features' => json_encode(['capabilities' => [], 'limits' => []]),
        'is_active' => true,
    ]);

    $academyId = (string) Str::uuid();
    DB::table('academies')->insert([
        'id' => $academyId,
        'name' => 'Bill '.substr($academyId, 0, 8),
        'academy_type_id' => $typeId,
        'status' => 'ACTIVE',
        'plan_id' => $planId,
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'invoice_grouping' => 'PER_GUARDIAN',
    ]);

    Sanctum::actingAs($test->admin);
    $test->postJson("/api/admin/academies/{$academyId}/subscription/activate")->assertOk();

    return $academyId;
}

it('generates a bill for the current period (idempotent) and mark-paid records it', function () {
    $academyId = billableAcademy($this);

    Sanctum::actingAs($this->admin);
    $first = $this->postJson("/api/admin/academies/{$academyId}/bills/generate")->assertOk()->json('billId');
    $second = $this->postJson("/api/admin/academies/{$academyId}/bills/generate")->assertOk()->json('billId');
    expect($second)->toBe($first); // idempotent — same period, same bill

    $this->enterAcademyAsSuperAdmin($academyId);
    expect(DB::table('academy_invoices')->where('academy_id', $academyId)->count())->toBe(1);
    expect((int) DB::table('academy_invoices')->where('id', $first)->value('total_minor'))->toBe(60000);

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/academies/{$academyId}/bills/{$first}/mark-paid", [
        'method' => 'INSTAPAY',
        'reason' => 'screenshot verified',
    ])->assertOk();

    $this->enterAcademyAsSuperAdmin($academyId);
    $bill = DB::table('academy_invoices')->where('id', $first)->first();
    expect($bill->status)->toBe('PAID');
    expect((int) $bill->amount_paid_minor)->toBe(60000);
    expect($bill->paid_at)->not->toBeNull();
});

it('refuses to bill a trial subscription', function () {
    $academyId = $this->createAcademy(overrides: ['status' => 'TRIAL']);

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/academies/{$academyId}/bills/generate")->assertStatus(422);
});

it('reminder job flips an overdue bill and sends a deep-link reminder (idempotent per day)', function () {
    $academyId = billableAcademy($this);
    // Give the owner a phone so the reminder has a recipient.
    $this->makeUser($academyId, 'ACADEMY_OWNER', ['email' => 'owner-'.substr($academyId, 0, 6).'@t.local']);
    $this->enterAcademyAsSuperAdmin($academyId);
    DB::table('users')->where('academy_id', $academyId)->update(['phone' => '+201234567890']);

    // A bill already past its due date.
    $this->enterAcademyAsSuperAdmin($academyId);
    $billId = (string) Str::uuid();
    DB::table('academy_invoices')->insert([
        'id' => $billId,
        'academy_id' => $academyId,
        'period_start' => now()->subMonth()->toDateString(),
        'period_end' => now()->subDay()->toDateString(),
        'status' => 'OPEN',
        'currency' => 'EGP',
        'total_minor' => 60000,
        'due_date' => now()->subDays(2)->toDateString(),
        'public_token' => Str::random(48),
    ]);

    $out = (new SendAcademyBillRemindersJob($academyId))->handle(app(AcademyBilling::class), app(WhatsAppSender::class));
    expect($out[$academyId])->toBe(1);

    $this->enterAcademyAsSuperAdmin($academyId);
    expect(DB::table('academy_invoices')->where('id', $billId)->value('status'))->toBe('OVERDUE');
    expect((int) DB::table('academy_invoices')->where('id', $billId)->value('reminder_count'))->toBe(1);

    // Same day → deduped, no second reminder.
    $out2 = (new SendAcademyBillRemindersJob($academyId))->handle(app(AcademyBilling::class), app(WhatsAppSender::class));
    expect($out2[$academyId])->toBe(0);
});

it('forbids an owner from the bills endpoint and isolates bills per academy (RLS)', function () {
    $academyId = billableAcademy($this);
    $owner = $this->makeUser($academyId, 'ACADEMY_OWNER');

    Sanctum::actingAs($owner);
    $this->getJson("/api/admin/academies/{$academyId}/bills")->assertForbidden();
});
