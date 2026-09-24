<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

/**
 * The basic custom bill (Invoices → Custom bills → New bill): a student from the list OR a name
 * typed by hand, one amount + currency + description, straight to a payable link. And the link —
 * here and in the WhatsApp payment message — is on the academy's own subdomain, not the platform's.
 */
uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    config([
        'lms.site.root_domain' => 'acadmyq.test',
        'lms.site.scheme' => 'https',
        'app.frontend_url' => 'https://app.acadmyq.test',
    ]);

    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    // The test DB is shared across runs, and subdomains are unique platform-wide.
    $this->sub = 'noor'.substr(md5(uniqid('', true)), 0, 8);
    $this->origin = 'https://'.$this->sub.'.acadmyq.test';

    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'subdomain' => $this->sub,
        'plan_id' => DB::table('plans')->where('code', 'PRO')->value('id'),
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-quick@test.local']);
    $this->student = $this->createStudent($this->academy, null, ['whatsapp_phone' => '+201001112223']);
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

it('bills a student from the list and answers with a link on the academy subdomain', function () {
    Sanctum::actingAs($this->owner);

    $res = $this->postJson('/api/invoices/quick', [
        'student_id' => $this->student,
        'amount_minor' => 15000,
        'currency' => 'usd',
        'description' => 'Summer workshop',
    ])->assertCreated();

    $this->asAcademy($this->academy);
    $inv = DB::table('invoices')->where('id', $res->json('id'))->first();

    expect($inv->kind)->toBe('MANUAL')
        ->and($inv->status)->toBe('OPEN')
        ->and((string) $inv->student_id)->toBe($this->student)
        ->and($inv->payer_name)->toBeNull()
        ->and($inv->currency)->toBe('USD')
        ->and((int) $inv->total_minor)->toBe(15000)
        ->and((int) $inv->period_month)->toBe(6)
        ->and($res->json('url'))->toBe($this->origin.'/i/'.$inv->public_token);

    $line = DB::table('invoice_line_items')->where('invoice_id', $inv->id)->first();
    expect($line->description)->toBe('Summer workshop')
        ->and((int) $line->amount_minor)->toBe(15000);
});

it('bills a name typed by hand, and the public page shows that name', function () {
    Sanctum::actingAs($this->owner);

    $res = $this->postJson('/api/invoices/quick', [
        'payer_name' => 'Walk-in Visitor',
        'amount_minor' => 5000,
        'currency' => 'EGP',
        'description' => 'Placement test',
    ])->assertCreated();

    $this->asAcademy($this->academy);
    $inv = DB::table('invoices')->where('id', $res->json('id'))->first();
    expect($inv->student_id)->toBeNull()
        ->and($inv->guardian_id)->toBeNull()
        ->and($inv->payer_name)->toBe('Walk-in Visitor');

    // Listed and searchable under the typed name.
    $rows = $this->getJson('/api/invoices?search=Walk-in')->assertOk()->json('rows');
    expect(collect($rows)->pluck('payer_name'))->toContain('Walk-in Visitor');

    $this->clearTenantContext();
    $this->getJson('/api/i/'.$inv->public_token)
        ->assertOk()
        ->assertJsonPath('payer_name', 'Walk-in Visitor')
        ->assertJsonPath('total_minor', 5000);
});

it('can mark a hand-named bill paid', function () {
    Sanctum::actingAs($this->owner);

    $id = $this->postJson('/api/invoices/quick', [
        'payer_name' => 'Walk-in Visitor',
        'amount_minor' => 5000,
        'currency' => 'EGP',
        'description' => 'Placement test',
    ])->assertCreated()->json('id');

    $this->postJson("/api/invoices/{$id}/mark-paid", ['payment_method' => 'CASH'])
        ->assertOk()
        ->assertJson(['status' => 'PAID']);
});

it('needs a student or a name, an amount, a currency and a description', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/invoices/quick', [
        'amount_minor' => 5000,
        'currency' => 'EGP',
        'description' => 'x',
    ])->assertUnprocessable()->assertJsonValidationErrors(['student_id', 'payer_name']);

    $this->postJson('/api/invoices/quick', ['payer_name' => 'A'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['amount_minor', 'currency', 'description']);
});

it('refuses a hand-typed name on an automatic invoice at the database', function () {
    $this->asAcademy($this->academy);

    expect(fn () => DB::table('invoices')->insert([
        'academy_id' => $this->academy,
        'kind' => 'AUTO',
        'payer_name' => 'Nobody',
        'period_year' => 2026,
        'period_month' => 6,
        'currency' => 'EGP',
        'public_token' => 'tok-'.uniqid(),
    ]))->toThrow(Illuminate\Database\QueryException::class);
});

it('sends the payment message with the link on the academy subdomain', function () {
    Sanctum::actingAs($this->owner);

    $id = $this->postJson('/api/invoices/quick', [
        'student_id' => $this->student,
        'amount_minor' => 5000,
        'currency' => 'EGP',
        'description' => 'Book',
    ])->assertCreated()->json('id');

    $res = $this->postJson("/api/invoices/{$id}/send-link")->assertOk();

    expect($res->json('url'))->toStartWith($this->origin.'/i/')
        ->and($res->json('message'))->toContain($this->origin.'/i/')
        ->and($res->json('message'))->not->toContain('app.acadmyq.test');
});

it('falls back to the platform address for an academy with no subdomain', function () {
    $bare = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'plan_id' => DB::table('plans')->where('code', 'PRO')->value('id'),
    ]);
    $bareOwner = $this->makeUser($bare, 'ACADEMY_OWNER', ['email' => 'owner-bare-'.uniqid().'@test.local']);
    $this->clearTenantContext();

    Sanctum::actingAs($bareOwner);
    $url = $this->postJson('/api/invoices/quick', [
        'payer_name' => 'Walk-in',
        'amount_minor' => 100,
        'currency' => 'EGP',
        'description' => 'x',
    ])->assertCreated()->json('url');

    expect($url)->toStartWith('https://app.acadmyq.test/i/');
});

it('tells the web app the academy public origin', function () {
    Sanctum::actingAs($this->owner);

    $this->getJson('/api/auth/me')
        ->assertOk()
        ->assertJsonPath('academy.publicOrigin', $this->origin);
});
