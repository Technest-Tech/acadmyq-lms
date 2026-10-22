<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/** The web error page reports the browser-side exception behind it, to the log only. */
it('logs a signed-in client\'s browser error with who hit it', function () {
    $academy = $this->createAcademy();
    $owner = $this->makeUser($academy, 'ACADEMY_OWNER', ['email' => 'owner-clienterr@test.local']);
    Log::spy();

    Sanctum::actingAs($owner);
    $this->postJson('/api/client-errors', [
        'message' => "TypeError: Cannot read properties of undefined (reading 'map')",
        'stack' => 'at StudentsList (page.js:1:2)',
        'path' => '/students',
    ])->assertStatus(202);

    Log::shouldHaveReceived('warning')->withArgs(fn ($msg, $ctx) => $msg === 'client.error'
        && $ctx['path'] === '/students'
        && $ctx['academy_id'] === $academy
        && $ctx['user_id'] === (string) $owner->id)->once();
});

it('refuses an anonymous report', function () {
    $this->postJson('/api/client-errors', ['message' => 'x'])->assertUnauthorized();
});
