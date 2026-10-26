<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

/**
 * One payment link per family (`/f/{token}`): every child's due package bill — what it is for, its
 * lessons, what is left on it — the total, and the academy's transfer details, on one page. The
 * bills stay separate, so each package is still marked paid by its own money.
 */
uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    config(['lms.site.root_domain' => 'acadmyq.test', 'lms.site.scheme' => 'https', 'app.frontend_url' => 'https://app.acadmyq.test']);

    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'plan_id' => DB::table('plans')->where('code', 'PRO')->value('id'),
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-fpay-'.uniqid().'@test.local']);
    $this->guardian = $this->createGuardian($this->academy, ['full_name' => 'Hassan Family']);
    $this->yusuf = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Yusuf']);
    $this->maryam = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Maryam']);
    $this->other = $this->createStudent($this->academy, null, ['full_name' => 'Someone Else']);

    $this->asAcademy($this->academy);
    // Yusuf: his first package, paid up front, nothing paid yet.
    familyPackageBill($this->academy, $this->yusuf, 60000, ['sequence_no' => 1]);
    // Maryam: the renewal opened by itself when her last block ran out.
    familyPackageBill($this->academy, $this->maryam, 40000, ['sequence_no' => 2, 'opened_automatically' => true]);
    // Another family's debt never shows on this one's page.
    familyPackageBill($this->academy, $this->other, 99900, ['sequence_no' => 1]);
    DB::table('academy_payment_settings')->insert([
        'academy_id' => $this->academy,
        'method' => 'BANK_TRANSFER',
        'is_active' => true,
        'config' => json_encode(['bank_name' => 'CIB', 'account_holder' => 'Noor Academy', 'account_number' => '100200300', 'iban' => 'EG00']),
    ]);
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

/** A package with its own unpaid bill, as an ON_START package opens. */
function familyPackageBill(string $academyId, string $studentId, int $total, array $package = []): string
{
    $invoiceId = (string) Str::uuid();
    DB::table('invoices')->insert([
        'id' => $invoiceId,
        'academy_id' => $academyId,
        'kind' => 'MANUAL',
        'student_id' => $studentId,
        'period_year' => 2026,
        'period_month' => 6,
        'status' => 'OPEN',
        'currency' => 'EGP',
        'subtotal_minor' => $total,
        'total_minor' => $total,
        'public_token' => 'tok-'.Str::random(20),
    ]);
    DB::table('lesson_packages')->insert(array_merge([
        'academy_id' => $academyId,
        'student_id' => $studentId,
        'label' => '20 hours',
        'minutes_total' => 1200,
        'price_minor' => $total,
        'currency' => 'EGP',
        'hourly_rate_minor' => intdiv($total, 20),
        'status' => 'ACTIVE',
        'sequence_no' => 1,
        'starts_on' => '2026-06-01',
        'invoice_id' => $invoiceId,
    ], $package));

    return $invoiceId;
}

function familyPayToken($test): string
{
    Sanctum::actingAs($test->owner);
    $url = (string) $test->postJson("/api/packages/family/{$test->guardian}/pay-link")->assertOk()->json('url');
    portalLessContext();

    return substr($url, strrpos($url, '/f/') + 3);
}

function portalLessContext(): void
{
    foreach (['app.current_academy_id', 'app.current_role', 'app.current_user_id'] as $guc) {
        DB::statement('select set_config(?, \'\', true)', [$guc]);
    }
}

it('makes one long link per family and keeps handing out the same one', function () {
    $first = familyPayToken($this);
    $again = familyPayToken($this);

    expect(strlen($first))->toBe(48)->and($again)->toBe($first);
});

it('shows every child\'s due package, what it is for, and the family total, with the transfer details', function () {
    $token = familyPayToken($this);

    $res = $this->getJson("/api/f/{$token}")->assertOk()
        ->assertHeader('Cache-Control', 'no-store, private')
        ->assertHeader('X-Robots-Tag', 'noindex, nofollow');

    expect($res->json('guardian_name'))->toBe('Hassan Family')
        ->and(collect($res->json('items'))->pluck('child')->all())->toBe(['Maryam', 'Yusuf'])
        ->and(collect($res->json('items'))->pluck('purpose')->all())->toBe(['AUTO_RENEWAL', 'NEW'])
        ->and(collect($res->json('items'))->pluck('due_minor')->all())->toBe([40000, 60000])
        ->and($res->json('items.0.minutes'))->toBe(1200)
        ->and($res->json('items.0.url'))->toContain('/i/tok-')
        ->and($res->json('totals'))->toBe([['currency' => 'EGP', 'amount_minor' => 100000]])
        ->and($res->json('bank_transfer.bank_name'))->toBe('CIB')
        ->and($res->json('card'))->toBeFalse();
});

it('drops a bill from the page once it is paid', function () {
    $token = familyPayToken($this);

    $this->asAcademy($this->academy);
    $maryamBill = DB::table('lesson_packages')->where('student_id', $this->maryam)->value('invoice_id');
    $this->clearTenantContext();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/invoices/{$maryamBill}/mark-paid", ['payment_method' => 'CASH'])->assertOk();
    portalLessContext();

    $res = $this->getJson("/api/f/{$token}")->assertOk();
    expect(collect($res->json('items'))->pluck('child')->all())->toBe(['Yusuf'])
        ->and($res->json('totals.0.amount_minor'))->toBe(60000);
});

it('answers 404 to a token nobody issued', function () {
    $this->getJson('/api/f/'.Str::random(48))->assertNotFound();
});

it('lets only staff who send payment links make one', function () {
    $teacher = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-fpay-'.uniqid().'@test.local']);
    $this->clearTenantContext();
    Sanctum::actingAs($teacher);

    $this->postJson("/api/packages/family/{$this->guardian}/pay-link")->assertForbidden();
});

it('says on each package row what its money is for', function () {
    Sanctum::actingAs($this->owner);

    $rows = collect($this->getJson('/api/packages?scope=due')->assertOk()->json('packages'))->keyBy('student_name');
    expect($rows['Yusuf']['purpose'])->toBe('NEW')
        ->and($rows['Maryam']['purpose'])->toBe('AUTO_RENEWAL');
});
