<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * The marketing site's demo-request form: the one endpoint on the platform that a complete stranger
 * may write to. Its whole risk surface is that sentence, so what is tested here is the shape of the
 * door — who may push a row in, who may ever read one back, and what stops a bot filling the table.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    RateLimiter::clear('demo-requests');
});

/** A complete, valid submission. */
function demoPayload(array $overrides = []): array
{
    return array_merge([
        'name' => 'سارة أحمد',
        'email' => 'sara@example.com',
        'phone' => '+201112223334',
        'country' => 'EG',
        'product' => 'COURSE_PLATFORM',
        'role' => 'مدرّسة لغة إنجليزية',
        'message' => 'عايزة أعرف تفاصيل أكتر عن منصة الكورسات.',
        'consent' => true,
        'locale' => 'ar',
        'source' => '/course-platform',
    ], $overrides);
}

it('accepts a demo request from an anonymous visitor', function () {
    $this->postJson('/api/public/demo-requests', demoPayload())
        ->assertCreated()
        ->assertJson(['ok' => true]);

    $this->asSuperAdmin();
    $row = DB::table('demo_requests')->first();

    expect($row->name)->toBe('سارة أحمد');
    expect($row->phone)->toBe('+201112223334');
    expect($row->product)->toBe('COURSE_PLATFORM');
    expect($row->country)->toBe('EG');
    expect($row->source)->toBe('/course-platform');
    expect($row->status)->toBe('NEW');
    expect((bool) $row->consent)->toBeTrue();
});

it('refuses a submission without consent, a phone or a known product', function () {
    $this->postJson('/api/public/demo-requests', demoPayload(['consent' => false]))
        ->assertStatus(422)->assertJsonValidationErrors('consent');

    $this->postJson('/api/public/demo-requests', demoPayload(['phone' => '']))
        ->assertStatus(422)->assertJsonValidationErrors('phone');

    $this->postJson('/api/public/demo-requests', demoPayload(['product' => 'SOMETHING_ELSE']))
        ->assertStatus(422)->assertJsonValidationErrors('product');

    $this->asSuperAdmin();
    expect(DB::table('demo_requests')->count())->toBe(0);
});

it('lets the email be omitted — a phone is the contact that always exists here', function () {
    $this->postJson('/api/public/demo-requests', demoPayload(['email' => null]))
        ->assertCreated();

    $this->asSuperAdmin();
    expect(DB::table('demo_requests')->value('email'))->toBeNull();
});

it('swallows a honeypot submission with the same 201 a human gets, and stores nothing', function () {
    $this->postJson('/api/public/demo-requests', demoPayload(['website' => 'http://spam.example']))
        ->assertCreated()
        ->assertJson(['ok' => true]);

    $this->asSuperAdmin();
    expect(DB::table('demo_requests')->count())->toBe(0);
});

it('throttles a flood from one address once the hourly ceiling is reached', function () {
    foreach (range(1, 6) as $i) {
        $this->postJson('/api/public/demo-requests', demoPayload(['phone' => '+2011122233'.$i.'4']))
            ->assertCreated();
    }

    $this->postJson('/api/public/demo-requests', demoPayload())->assertStatus(429);

    $this->asSuperAdmin();
    expect(DB::table('demo_requests')->count())->toBe(6);
});

it('never lets the public endpoint read a lead back', function () {
    // The response is a bare acknowledgement — no id, no row, nothing that could be walked.
    $body = $this->postJson('/api/public/demo-requests', demoPayload())->json();

    expect($body)->toBe(['ok' => true]);
});

it('shows the queue to a Super Admin and hides it from an academy owner', function () {
    $this->postJson('/api/public/demo-requests', demoPayload())->assertCreated();
    $this->postJson('/api/public/demo-requests', demoPayload([
        'name' => 'Mohamed Ali',
        'phone' => '+201005005000',
        'product' => 'ACADEMY_MANAGEMENT',
    ]))->assertCreated();

    $academy = $this->createAcademy();
    $owner = $this->makeUser($academy, 'ACADEMY_OWNER', ['email' => 'owner-demo@test.local']);
    $admin = $this->makeUser(null, 'SUPER_ADMIN', ['email' => 'sa-demo@test.local']);

    Sanctum::actingAs($owner);
    $this->getJson('/api/admin/demo-requests')->assertForbidden();

    Sanctum::actingAs($admin);
    $res = $this->getJson('/api/admin/demo-requests')->assertOk();

    expect($res->json('total'))->toBe(2);
    expect($res->json('counts.NEW'))->toBe(2);
    // Newest first.
    expect($res->json('rows.0.name'))->toBe('Mohamed Ali');

    $filtered = $this->getJson('/api/admin/demo-requests?filter[product]=COURSE_PLATFORM')->assertOk();
    expect($filtered->json('total'))->toBe(1);
    expect($filtered->json('rows.0.name'))->toBe('سارة أحمد');
});

it('records the outcome of working a lead, and audits who decided it', function () {
    $this->postJson('/api/public/demo-requests', demoPayload())->assertCreated();

    $admin = $this->makeUser(null, 'SUPER_ADMIN', ['email' => 'sa-work@test.local']);
    $this->asSuperAdmin();
    $id = (string) DB::table('demo_requests')->value('id');

    Sanctum::actingAs($admin);
    $this->patchJson("/api/admin/demo-requests/{$id}", [
        'status' => 'CONTACTED',
        'note' => 'اتصلت بيها، هتشوف العرض وترد.',
    ])->assertOk()->assertJsonPath('request.status', 'CONTACTED');

    $this->patchJson("/api/admin/demo-requests/{$id}", ['status' => 'NOPE'])->assertStatus(422);

    $this->asSuperAdmin();
    expect(DB::table('demo_requests')->where('id', $id)->value('note'))
        ->toBe('اتصلت بيها، هتشوف العرض وترد.');

    $audit = DB::table('audit_log')->where('entity_id', $id)->first();
    expect($audit->action)->toBe('demo_request.updated');
    expect($audit->academy_id)->toBeNull();
});

it('keeps leads out of reach of every academy context — the database says so, not just the Gate', function () {
    $this->postJson('/api/public/demo-requests', demoPayload())->assertCreated();

    $academy = $this->createAcademy();
    $this->asAcademy($academy);

    expect(DB::table('demo_requests')->count())->toBe(0);
});
