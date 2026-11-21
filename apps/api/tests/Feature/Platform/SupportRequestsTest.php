<?php

declare(strict_types=1);

use App\Support\LmsMedia;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

// Support requests: an academy raises problems and change requests and follows them on its own page;
// the platform team reviews, accepts, rejects and answers them from one inbox.

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    Storage::fake(LmsMedia::disk());
    $this->clearTenantContext();

    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
    $this->asSuperAdmin();
    $this->academy = $this->createAcademy(overrides: ['name' => 'Support Academy']);
    $this->other = $this->createAcademy(overrides: ['name' => 'Other Academy']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['full_name' => 'Owner One', 'email' => 'owner-sup-'.uniqid().'@test.local']);
    $this->otherOwner = $this->makeUser($this->other, 'ACADEMY_OWNER', ['email' => 'owner-oth-'.uniqid().'@test.local']);
    $this->clearTenantContext();

    $this->raise = function (array $fields = []): array {
        Sanctum::actingAs($this->owner);

        return $this->postJson('/api/support/requests', [
            'kind' => 'PROBLEM',
            'title' => 'Bills page is empty',
            'body' => 'Since this morning the bills page shows nothing.',
            ...$fields,
        ])->assertCreated()->json('request');
    };
});

it('raises a numbered request with a screenshot and puts it in the inbox', function () {
    Sanctum::actingAs($this->owner);
    $first = $this->post('/api/support/requests', [
        'kind' => 'PROBLEM',
        'title' => 'Bills page is empty',
        'body' => 'Nothing shows.',
        'priority' => 'URGENT',
        'page' => '/invoices',
        'attachments' => [UploadedFile::fake()->image('screen.png')],
    ], ['Accept' => 'application/json'])->assertCreated();

    expect($first->json('request.number'))->toBe(1)
        ->and($first->json('request.status'))->toBe('NEW')
        ->and($first->json('request.source'))->toBe('ACADEMY')
        ->and($first->json('request.page'))->toBe('/invoices')
        ->and($first->json('request.createdBy'))->toBe('Owner One')
        ->and($first->json('request.attachments'))->toHaveCount(1)
        ->and($first->json('request.attachments.0.name'))->toBe('screen.png');

    $second = ($this->raise)(['kind' => 'CHANGE', 'title' => 'Add a column for the phone']);
    expect($second['number'])->toBe(2);

    $list = $this->getJson('/api/support/requests')->assertOk();
    expect($list->json('rows'))->toHaveCount(2)
        ->and($list->json('counts.open'))->toBe(2);

    // The platform team sees both, unread, with the academy's name.
    Sanctum::actingAs($this->admin);
    $this->getJson('/api/admin/support/summary')->assertOk()->assertJsonPath('unread', 2)->assertJsonPath('new', 2);
    $inbox = $this->getJson('/api/admin/support')->assertOk();
    expect($inbox->json('total'))->toBe(2)
        ->and($inbox->json('rows.0.academy.name'))->toBe('Support Academy')
        ->and($inbox->json('counts.URGENT'))->toBe(1)
        ->and($inbox->json('counts.UNREAD'))->toBe(2);

    // Opening one marks it read for the team only.
    $this->getJson("/api/admin/support/{$first->json('request.id')}")->assertOk();
    $this->getJson('/api/admin/support/summary')->assertJsonPath('unread', 1);
});

it('keeps requests to their academy and to people who hold support', function () {
    $request = ($this->raise)();

    Sanctum::actingAs($this->otherOwner);
    $this->getJson("/api/support/requests/{$request['id']}")->assertNotFound();
    expect($this->getJson('/api/support/requests')->assertOk()->json('rows'))->toBe([]);

    $this->asSuperAdmin();
    $teacher = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-sup-'.uniqid().'@test.local']);
    $this->clearTenantContext();
    Sanctum::actingAs($teacher);
    $this->getJson('/api/support/requests')->assertForbidden();
    $this->postJson('/api/support/requests', ['kind' => 'PROBLEM', 'title' => 'x'])->assertForbidden();

    // An academy owner never reaches the inbox.
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/admin/support')->assertForbidden();
    $this->postJson("/api/admin/support/{$request['id']}/messages", ['body' => 'hi'])->assertForbidden();
});

it('asks the academy a question and takes its answer back to where the request was', function () {
    $request = ($this->raise)();
    Sanctum::actingAs($this->admin);

    // A question needs words.
    $this->postJson("/api/admin/support/{$request['id']}/messages", ['status' => 'WAITING'])->assertUnprocessable();
    $this->postJson("/api/admin/support/{$request['id']}/messages", ['status' => 'WAITING', 'body' => 'Which month?'])
        ->assertOk()->assertJsonPath('request.status', 'WAITING');

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/support/summary')->assertJsonPath('unread', 1);
    $seen = $this->getJson("/api/support/requests/{$request['id']}")->assertOk();
    expect($seen->json('messages.0.body'))->toBe('Which month?')
        ->and($seen->json('messages.0.author'))->toBeNull(); // the academy reads "the support team"
    $this->getJson('/api/support/summary')->assertJsonPath('unread', 0);

    // Never accepted → the answer puts it back to NEW.
    $this->postJson("/api/support/requests/{$request['id']}/messages", ['body' => 'November'])
        ->assertOk()->assertJsonPath('request.status', 'NEW');

    // Accepted, asked again, answered → back to IN_PROGRESS.
    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/support/{$request['id']}/messages", ['status' => 'IN_PROGRESS'])->assertOk();
    $this->postJson("/api/admin/support/{$request['id']}/messages", ['status' => 'WAITING', 'body' => 'Which student?'])->assertOk();
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/support/requests/{$request['id']}/messages", ['body' => 'Ali'])
        ->assertOk()->assertJsonPath('request.status', 'IN_PROGRESS');

    Sanctum::actingAs($this->admin);
    $this->getJson('/api/admin/support/summary')->assertJsonPath('unread', 1);
});

it('keeps internal notes from the academy and out of its badge', function () {
    $request = ($this->raise)();
    Sanctum::actingAs($this->admin);

    $this->postJson("/api/admin/support/{$request['id']}/messages", ['body' => 'Looks like the nightly roll.', 'internal' => true, 'status' => 'IN_PROGRESS'])
        ->assertUnprocessable();
    $this->postJson("/api/admin/support/{$request['id']}/messages", ['body' => 'Looks like the nightly roll.', 'internal' => true])
        ->assertOk()->assertJsonPath('messages.0.internal', true);

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/support/summary')->assertJsonPath('unread', 0);
    expect($this->getJson("/api/support/requests/{$request['id']}")->json('messages'))->toBe([]);
});

it('rejects with a reason, reopens a solved request on a reply, and lets only a new one be withdrawn', function () {
    $rejected = ($this->raise)(['kind' => 'CHANGE', 'title' => 'Paint it pink']);
    $solved = ($this->raise)(['title' => 'Login loop']);
    $fresh = ($this->raise)(['title' => 'Sent by mistake']);

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/support/{$rejected['id']}/messages", ['status' => 'REJECTED'])->assertUnprocessable();
    $this->postJson("/api/admin/support/{$rejected['id']}/messages", ['status' => 'REJECTED', 'body' => 'Not something we can do.'])
        ->assertOk()->assertJsonPath('request.status', 'REJECTED');
    $done = $this->postJson("/api/admin/support/{$solved['id']}/messages", ['status' => 'DONE', 'body' => 'Fixed.'])->assertOk();
    expect($done->json('request.closedAt'))->not->toBeNull();

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/support/requests/{$rejected['id']}/messages", ['body' => 'Please?'])->assertStatus(409);
    $reopened = $this->postJson("/api/support/requests/{$solved['id']}/messages", ['body' => 'It is back.'])->assertOk();
    expect($reopened->json('request.status'))->toBe('IN_PROGRESS')
        ->and($reopened->json('request.closedAt'))->toBeNull()
        ->and(collect($reopened->json('messages'))->last()['statusTo'])->toBe('IN_PROGRESS');

    $this->postJson("/api/support/requests/{$solved['id']}/withdraw")->assertStatus(409);
    $this->postJson("/api/support/requests/{$fresh['id']}/withdraw")->assertOk()->assertJsonPath('request.status', 'CANCELLED');

    $counts = $this->getJson('/api/support/requests')->json('counts');
    expect($counts['open'])->toBe(1)->and($counts['closed'])->toBe(2);
});

it('logs work on a client\'s behalf and shows it on that client\'s page', function () {
    ($this->raise)();
    Sanctum::actingAs($this->admin);

    $logged = $this->postJson('/api/admin/support', [
        'academy_id' => $this->academy,
        'kind' => 'CHANGE',
        'title' => 'Group lessons on the monthly report',
        'body' => 'Delivered in today\'s update.',
    ])->assertCreated();
    expect($logged->json('request.source'))->toBe('ADMIN')
        ->and($logged->json('request.status'))->toBe('DONE')
        ->and($logged->json('request.number'))->toBe(2);

    $this->postJson('/api/admin/support', ['academy_id' => $this->other, 'kind' => 'PROBLEM', 'title' => 'Elsewhere', 'status' => 'IN_PROGRESS'])
        ->assertCreated()->assertJsonPath('request.number', 1);

    // One client's page: only its own, with its own counts.
    $page = $this->getJson("/api/admin/support?filter[academy]={$this->academy}")->assertOk();
    expect($page->json('total'))->toBe(2)
        ->and($page->json('counts.ALL'))->toBe(2)
        ->and($page->json('counts.DONE'))->toBe(1);
    expect($this->getJson('/api/admin/support?filter[status]=OPEN')->json('total'))->toBe(2);
    expect($this->getJson('/api/admin/support?filter[academy]=not-a-uuid')->assertOk()->json('total'))->toBe(0);

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/support/summary')->assertJsonPath('unread', 1);
    $row = collect($this->getJson('/api/support/requests')->json('rows'))->firstWhere('source', 'ADMIN');
    expect($row['title'])->toBe('Group lessons on the monthly report')
        ->and($row['createdBy'])->toBeNull()
        ->and($row['unread'])->toBeTrue();
});

it('logs a fix from the command line', function () {
    $exit = Artisan::call('support:log', [
        'academy' => 'Support Academy',
        'title' => 'Restored the deleted families',
        '--kind' => 'PROBLEM',
        '--body' => 'All 13 families are back.',
    ]);
    expect($exit)->toBe(0);

    $this->asSuperAdmin();
    $row = DB::table('support_requests')->where('academy_id', $this->academy)->first();
    $this->clearTenantContext();
    expect($row->title)->toBe('Restored the deleted families')
        ->and($row->status)->toBe('DONE')
        ->and($row->source)->toBe('ADMIN')
        ->and((bool) $row->unread_by_academy)->toBeTrue();

    expect(Artisan::call('support:log', ['academy' => 'Nobody', 'title' => 'x']))->toBe(1);
    expect(Artisan::call('support:log', ['academy' => 'Support Academy', 'title' => 'x', '--status' => 'MAYBE']))->toBe(1);
});
