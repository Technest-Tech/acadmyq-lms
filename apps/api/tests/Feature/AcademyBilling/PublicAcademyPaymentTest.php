<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
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

/** Create an academy + an OPEN platform bill, returning [academyId, billId, token]. */
function academyBillFixture(object $test): array
{
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    DB::statement("select set_config('app.current_academy_id', '', true)");
    $typeId = (string) Str::uuid();
    DB::table('academy_types')->insert(['id' => $typeId, 'code' => 'PP-'.substr($typeId, 0, 8), 'name' => 'PP Type']);
    $academyId = (string) Str::uuid();
    DB::table('academies')->insert([
        'id' => $academyId, 'name' => 'Pay Academy', 'academy_type_id' => $typeId,
        'status' => 'ACTIVE', 'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'invoice_grouping' => 'PER_GUARDIAN',
    ]);
    $billId = (string) Str::uuid();
    $token = Str::random(48);
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::table('academy_invoices')->insert([
        'id' => $billId, 'academy_id' => $academyId,
        'period_start' => '2026-06-01', 'period_end' => '2026-06-30',
        'status' => 'OPEN', 'currency' => 'EGP', 'total_minor' => 75000,
        'due_date' => '2026-07-07', 'public_token' => $token,
    ]);

    return [$academyId, $billId, $token];
}

it('serves the public bill with receiving methods, noindex, and 404s on a bad token', function () {
    [, , $token] = academyBillFixture($this);

    $res = $this->getJson("/api/a/{$token}")->assertOk();
    expect($res->json('total_minor'))->toBe(75000);
    expect($res->json('academy_name'))->toBe('Pay Academy');
    expect($res->json('payment_methods'))->toHaveKey('INSTAPAY');
    $res->assertHeader('X-Robots-Tag', 'noindex, nofollow');

    $this->getJson('/api/a/'.Str::random(48))->assertNotFound();
});

it('accepts a screenshot upload and records a PENDING submission', function () {
    Storage::fake('local');
    [$academyId, $billId, $token] = academyBillFixture($this);

    $this->post("/api/a/{$token}/submit", [
        'method' => 'INSTAPAY',
        'screenshot' => UploadedFile::fake()->image('transfer.jpg'),
        'note' => 'Sent via InstaPay',
    ])->assertOk();

    $this->enterAcademyAsSuperAdmin($academyId);
    $sub = DB::table('academy_payment_submissions')->where('academy_invoice_id', $billId)->first();
    expect($sub)->not->toBeNull();
    expect($sub->review_status)->toBe('PENDING');
    expect($sub->method)->toBe('INSTAPAY');
    Storage::disk('local')->assertExists($sub->screenshot_path);
});

it('lets a Super Admin approve a submission, which marks the bill paid', function () {
    Storage::fake('local');
    [$academyId, $billId, $token] = academyBillFixture($this);

    $this->post("/api/a/{$token}/submit", [
        'method' => 'VODAFONE_CASH',
        'screenshot' => UploadedFile::fake()->image('t.png'),
    ])->assertOk();

    $this->enterAcademyAsSuperAdmin($academyId);
    $subId = DB::table('academy_payment_submissions')->where('academy_invoice_id', $billId)->value('id');

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/academies/{$academyId}/payment-submissions/{$subId}/review", [
        'decision' => 'approve',
    ])->assertOk();

    $this->enterAcademyAsSuperAdmin($academyId);
    $bill = DB::table('academy_invoices')->where('id', $billId)->first();
    expect($bill->status)->toBe('PAID');
    expect($bill->payment_method)->toBe('VODAFONE_CASH');
    expect(DB::table('academy_payment_submissions')->where('id', $subId)->value('review_status'))->toBe('APPROVED');
});

it('rejects a submission on a paid/void bill and forbids the owner from the review endpoint', function () {
    Storage::fake('local');
    [$academyId, $billId, $token] = academyBillFixture($this);
    $this->enterAcademyAsSuperAdmin($academyId);
    DB::table('academy_invoices')->where('id', $billId)->update(['status' => 'PAID']);

    $this->post("/api/a/{$token}/submit", [
        'method' => 'INSTAPAY',
        'screenshot' => UploadedFile::fake()->image('t.jpg'),
    ])->assertStatus(422);

    $owner = $this->makeUser($academyId, 'ACADEMY_OWNER');
    Sanctum::actingAs($owner);
    $this->postJson("/api/admin/academies/{$academyId}/payment-submissions/".Str::uuid()."/review", [
        'decision' => 'approve',
    ])->assertForbidden();
});
