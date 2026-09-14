<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * WhatsApp group alerts — the Super Admin surface (link / edit / test / unlink a client's staff
 * groups) and the gateway webhook that walks an alert through sent → delivered → read.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(modules: ['MANAGEMENT', 'WHATSAPP']);
    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
    $this->base = "/api/admin/academies/{$this->academy}/whatsapp/groups";

    $this->gateway = [
        'status' => 'CONNECTED',
        'groups' => [
            ['id' => '120363111111111111@g.us', 'subject' => 'Supervision team', 'size' => 6, 'announce' => false, 'isAdmin' => false, 'canSend' => true],
            ['id' => '120363222222222222@g.us', 'subject' => 'Owners only', 'size' => 3, 'announce' => true, 'isAdmin' => false, 'canSend' => false],
        ],
    ];
    Http::fake([
        '*/api/groups' => fn () => $this->gateway['status'] === 'CONNECTED'
            ? Http::response(['groups' => $this->gateway['groups']], 200)
            : Http::response(['error' => 'not_connected'], 409),
        '*/api/status' => fn () => Http::response(['status' => $this->gateway['status']], 200),
        '*/api/send-message' => Http::response(['data' => ['msgId' => 'wamid.test']], 200),
    ]);
});

function linkSupervision(array $body = []): TestResponse
{
    return test()->postJson(test()->base, array_merge([
        'jid' => '120363111111111111@g.us',
        'label' => 'Supervision',
        'language' => 'ar',
        'events' => ['SESSION_STARTED', 'SESSION_NOT_MARKED', 'REPORT_OVERDUE'],
        'settings' => ['not_marked_after_minutes' => 20, 'report_overdue_hours' => 3],
    ], $body));
}

it('lists the groups the connected number is in, marking the ones already linked', function () {
    giveWhatsAppToken($this->academy);
    Sanctum::actingAs($this->admin);

    linkSupervision()->assertCreated();

    $groups = $this->getJson("{$this->base}/available")->assertOk()->json('groups');
    expect(collect($groups)->firstWhere('id', '120363111111111111@g.us'))
        ->toMatchArray(['subject' => 'Supervision team', 'linked' => true, 'can_send' => true]);
    expect(collect($groups)->firstWhere('id', '120363222222222222@g.us'))
        ->toMatchArray(['linked' => false, 'can_send' => false]);
});

it('links a group with its alerts, timings and a start instant per alert', function () {
    giveWhatsAppToken($this->academy);
    Sanctum::actingAs($this->admin);

    $group = linkSupervision()->assertCreated()->json('group');

    expect($group)->toMatchArray([
        'name' => 'Supervision team',
        'label' => 'Supervision',
        'language' => 'ar',
        'events' => ['SESSION_STARTED', 'SESSION_NOT_MARKED', 'REPORT_OVERDUE'],
        'settings' => ['not_marked_after_minutes' => 20, 'report_overdue_hours' => 3],
        'is_active' => true,
    ]);

    $this->enterAcademyAsSuperAdmin($this->academy);
    $since = json_decode(DB::table('whatsapp_groups')->where('id', $group['id'])->value('event_since'), true);
    expect(array_keys($since))->toEqualCanonicalizing(['SESSION_STARTED', 'SESSION_NOT_MARKED', 'REPORT_OVERDUE']);
});

it('refuses a group the number is not in, and an admins-only group it cannot post to', function () {
    giveWhatsAppToken($this->academy);
    Sanctum::actingAs($this->admin);

    linkSupervision(['jid' => '120363999999999999@g.us'])->assertStatus(422)->assertJsonPath('error', 'not_a_member');
    linkSupervision(['jid' => '120363222222222222@g.us'])->assertStatus(422)->assertJsonPath('error', 'admins_only');
    linkSupervision()->assertCreated();
    linkSupervision()->assertStatus(422)->assertJsonPath('error', 'already_linked');
});

it('rejects unknown alert types and out-of-range timings', function () {
    giveWhatsAppToken($this->academy);
    Sanctum::actingAs($this->admin);

    linkSupervision(['events' => ['SESSION_STARTED', 'EVERYTHING']])->assertStatus(422)->assertJsonValidationErrors('events.1');
    linkSupervision(['settings' => ['report_overdue_hours' => 0]])->assertStatus(422)->assertJsonValidationErrors('settings.report_overdue_hours');
    linkSupervision(['jid' => '201234567890@s.whatsapp.net'])->assertStatus(422)->assertJsonValidationErrors('jid');
});

it('needs a connected number to list or link groups', function () {
    Sanctum::actingAs($this->admin);

    // No token at all.
    $this->getJson("{$this->base}/available")->assertStatus(409)->assertJsonPath('error', 'not_connected');

    // A token, but the session dropped.
    giveWhatsAppToken($this->academy);
    $this->gateway['status'] = 'DISCONNECTED';
    linkSupervision()->assertStatus(409)->assertJsonPath('error', 'not_connected');
});

it('starts a newly ticked alert from now, and drops pending alerts of an unticked one', function () {
    giveWhatsAppToken($this->academy);
    Sanctum::actingAs($this->admin);
    $group = linkSupervision(['events' => ['SESSION_NOT_MARKED']])->json('group');

    $this->enterAcademyAsSuperAdmin($this->academy);
    $pending = (string) Str::uuid();
    DB::table('whatsapp_group_alerts')->insert([
        'id' => $pending, 'academy_id' => $this->academy, 'group_id' => $group['id'],
        'event_type' => 'SESSION_NOT_MARKED', 'subject_key' => (string) Str::uuid(),
        'due_at' => now()->toIso8601String(), 'status' => 'PENDING',
    ]);

    $this->putJson("{$this->base}/{$group['id']}", ['events' => ['PAYMENT_RECEIVED'], 'label' => 'Accounting'])
        ->assertOk()
        ->assertJsonPath('group.events', ['PAYMENT_RECEIVED'])
        ->assertJsonPath('group.label', 'Accounting');

    $this->enterAcademyAsSuperAdmin($this->academy);
    $since = json_decode(DB::table('whatsapp_groups')->where('id', $group['id'])->value('event_since'), true);
    expect(array_keys($since))->toBe(['PAYMENT_RECEIVED']);
    expect(DB::table('whatsapp_group_alerts')->where('id', $pending)->value('status'))->toBe('SKIPPED');
});

it('sends a test into the group through the delivery ledger', function () {
    giveWhatsAppToken($this->academy);
    Sanctum::actingAs($this->admin);
    $group = linkSupervision()->json('group');

    $res = $this->postJson("{$this->base}/{$group['id']}/test")->assertOk();
    expect($res->json('alert'))->toMatchArray(['event_type' => 'TEST', 'status' => 'QUEUED']);

    Http::assertSent(fn ($req) => str_contains($req->url(), '/api/send-message')
        && $req->data()['to'] === '120363111111111111@g.us'
        && str_contains($req->data()['text'], 'رسالة تجريبية'));

    $this->getJson("{$this->base}/{$group['id']}/alerts")->assertOk()->assertJsonPath('alerts.0.event_type', 'TEST');
    expect($this->getJson($this->base)->assertOk()->json('groups.0.recent.0.status'))->toBe('QUEUED');
});

it('will not test a group while the number is disconnected', function () {
    giveWhatsAppToken($this->academy);
    Sanctum::actingAs($this->admin);
    $group = linkSupervision()->json('group');

    $this->gateway['status'] = 'DISCONNECTED';
    $this->postJson("{$this->base}/{$group['id']}/test")->assertStatus(409)->assertJsonPath('error', 'not_connected');
});

it('unlinks a group', function () {
    giveWhatsAppToken($this->academy);
    Sanctum::actingAs($this->admin);
    $group = linkSupervision()->json('group');

    $this->deleteJson("{$this->base}/{$group['id']}")->assertOk();
    expect($this->getJson($this->base)->json('groups'))->toBe([]);
    $this->deleteJson("{$this->base}/{$group['id']}")->assertNotFound();
});

it('is Super Admin only', function () {
    $owner = $this->makeUser($this->academy, 'ACADEMY_OWNER');
    Sanctum::actingAs($owner);

    $this->getJson($this->base)->assertForbidden();
    linkSupervision()->assertForbidden();
});

it('walks a group alert through sent, delivered and read from gateway webhooks', function () {
    config()->set('services.whatsapp_gateway.webhook_secret', 'webhook-secret-for-tests');
    giveWhatsAppToken($this->academy);
    Sanctum::actingAs($this->admin);
    $group = linkSupervision()->json('group');
    $alertId = $this->postJson("{$this->base}/{$group['id']}/test")->json('alert.id');

    $hook = function (string $status) {
        $body = json_encode(['event' => 'message.status', 'academyId' => $this->academy, 'sessionId' => 's', 'data' => ['msgId' => 'wamid.test', 'status' => $status]]);

        return $this->call('POST', '/api/internal/wa/webhook', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_X_WA_SIGNATURE' => 'sha256='.hash_hmac('sha256', $body, 'webhook-secret-for-tests'),
        ], $body)->assertOk();
    };
    $row = function () use ($alertId) {
        $this->enterAcademyAsSuperAdmin($this->academy);

        return DB::table('whatsapp_group_alerts')->where('id', $alertId)->first();
    };

    $hook('sent');
    expect($row()->status)->toBe('SENT');

    $hook('delivered');
    expect($row()->status)->toBe('DELIVERED')->and($row()->delivered_at)->not->toBeNull();

    // A late "sent" never walks it backwards.
    $hook('sent');
    expect($row()->status)->toBe('DELIVERED');

    $hook('read');
    expect($row()->read_at)->not->toBeNull();
});
