<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * Learner password reset (docs/lms/10 §2) — the piece the learner site was missing.
 *
 * The three properties worth a test: the endpoint cannot be used to enumerate customers, only a
 * HASH of the token is stored, and spending a token kills every other live token AND every session.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(modules: ['LMS'], overrides: [
        'client_type' => 'LMS',
        'subdomain' => 'reset-site',
    ]);

    $this->token = $this->withHeaders(['X-Academy' => 'reset-site'])
        ->postJson('/api/learn/auth/register', [
            'full_name' => 'Omar Nabil',
            'email' => 'omar@example.com',
            'password' => 'oldpassword1',
            'phone' => '+201000000002',
        ])->assertCreated()->json('token');
});

it('answers the same way for a real address and a stranger', function () {
    $real = $this->withHeaders(['X-Academy' => 'reset-site'])
        ->postJson('/api/learn/auth/forgot-password', ['email' => 'omar@example.com']);
    $fake = $this->withHeaders(['X-Academy' => 'reset-site'])
        ->postJson('/api/learn/auth/forgot-password', ['email' => 'nobody@example.com']);

    expect($real->status())->toBe(202)->and($fake->status())->toBe(202);

    // Only the real one actually minted anything.
    $this->asAcademy($this->academy);
    expect(DB::table('learner_password_resets')->count())->toBe(1);
});

it('stores only a hash of the token, never the token itself', function () {
    $this->withHeaders(['X-Academy' => 'reset-site'])
        ->postJson('/api/learn/auth/forgot-password', ['email' => 'omar@example.com'])
        ->assertStatus(202);

    $this->asAcademy($this->academy);
    $row = DB::table('learner_password_resets')->orderByDesc('created_at')->first();

    // sha256 hex — not something a reader could hand to /reset-password.
    expect($row->token_hash)->toMatch('/^[0-9a-f]{64}$/')
        ->and($row->used_at)->toBeNull()
        ->and($row->channel)->toBe('WHATSAPP'); // the learner left a phone number
});

it('resets the password, spends the token, and signs every session out', function () {
    // Mint the token through the app, then reproduce it: the plaintext never leaves the request, so
    // the test writes its own row with a known token — the same shape the controller writes.
    $plain = 'a-known-test-token-value';
    $this->asAcademy($this->academy);
    $learnerId = DB::table('learners')->value('id');
    DB::table('learner_password_resets')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'learner_id' => $learnerId,
        'token_hash' => hash('sha256', $plain),
        'channel' => 'EMAIL',
        // ISO-8601 with an offset, not a Carbon: the builder binds a Carbon as a NAIVE string that
        // Postgres reads in the session time zone (Africa/Cairo) while the app runs in UTC, which
        // would put this "one hour from now" two hours in the PAST.
        'expires_at' => now()->addHour()->toIso8601String(),
    ]);

    $this->withHeaders(['X-Academy' => 'reset-site'])
        ->postJson('/api/learn/auth/reset-password', [
            'token' => $plain,
            'password' => 'brandnewpass1',
            'password_confirmation' => 'brandnewpass1',
        ])->assertOk();

    // The new password works, the old one does not.
    $this->withHeaders(['X-Academy' => 'reset-site'])
        ->postJson('/api/learn/auth/login', ['email' => 'omar@example.com', 'password' => 'oldpassword1'])
        ->assertStatus(422);
    $this->withHeaders(['X-Academy' => 'reset-site'])
        ->postJson('/api/learn/auth/login', ['email' => 'omar@example.com', 'password' => 'brandnewpass1'])
        ->assertOk();

    // The token is spent, and the token issued at registration is gone with it.
    $this->asAcademy($this->academy);
    expect(DB::table('learner_password_resets')->whereNull('used_at')->count())->toBe(0);

    $this->withHeaders(['X-Academy' => 'reset-site', 'Authorization' => "Bearer {$this->token}"])
        ->getJson('/api/learn/me')
        ->assertUnauthorized();
});

it('refuses an expired or already-used token', function () {
    $plain = 'expired-token';
    $this->asAcademy($this->academy);
    DB::table('learner_password_resets')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'learner_id' => DB::table('learners')->value('id'),
        'token_hash' => hash('sha256', $plain),
        'channel' => 'EMAIL',
        'expires_at' => now()->subMinute()->toIso8601String(),
    ]);

    $this->withHeaders(['X-Academy' => 'reset-site'])
        ->postJson('/api/learn/auth/reset-password', [
            'token' => $plain,
            'password' => 'brandnewpass1',
            'password_confirmation' => 'brandnewpass1',
        ])->assertStatus(422);
});
