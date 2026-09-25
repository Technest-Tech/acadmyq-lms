<?php

declare(strict_types=1);

use App\Support\AcademyUrl;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * The management side's password flows. Until these existed, the ONLY way any staff login ever got
 * a password was someone typing one for them: the "send reset link" buttons built their URL from a
 * route this API never had, threw, and were silently swallowed — while the audit trail said sent.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy();
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-reset@test.local']);
});

function fromWeb()
{
    return test()->withHeader('Origin', 'http://localhost:3000');
}

it('mails a reset link that points at the web reset page', function () {
    Notification::fake();

    fromWeb()->postJson('/api/auth/forgot-password', ['email' => 'owner-reset@test.local'])
        ->assertStatus(202);

    Notification::assertSentTo($this->owner, ResetPassword::class, function (ResetPassword $n, array $channels, object $notifiable) {
        $url = (string) call_user_func(ResetPassword::$createUrlCallback, $notifiable, $n->token);

        return str_starts_with($url, AcademyUrl::platform().'/reset-password?token=')
            && str_contains($url, 'email='.rawurlencode('owner-reset@test.local'));
    });
});

it('answers 202 for an unknown email too, and sends nothing', function () {
    Notification::fake();

    fromWeb()->postJson('/api/auth/forgot-password', ['email' => 'nobody@test.local'])->assertStatus(202);

    Notification::assertNothingSent();
});

it('resets the password with a valid token and the new password signs in', function () {
    $token = Password::broker()->createToken($this->owner);

    fromWeb()->postJson('/api/auth/reset-password', [
        'email' => 'owner-reset@test.local',
        'token' => $token,
        'password' => 'brand-new-secret-1',
    ])->assertOk();

    fromWeb()->postJson('/api/auth/login', ['email' => 'owner-reset@test.local', 'password' => 'brand-new-secret-1'])
        ->assertOk()
        ->assertJsonPath('role', 'ACADEMY_OWNER');

    // The token is single-use.
    fromWeb()->postJson('/api/auth/reset-password', [
        'email' => 'owner-reset@test.local',
        'token' => $token,
        'password' => 'another-secret-12',
    ])->assertStatus(422);

    $this->asAcademy($this->academy);
    expect(DB::table('audit_log')->where('action', 'auth.password_reset')->where('entity_id', $this->owner->id)->exists())->toBeTrue();
});

it('rejects a bad token without touching the password', function () {
    fromWeb()->postJson('/api/auth/reset-password', [
        'email' => 'owner-reset@test.local',
        'token' => 'not-a-token',
        'password' => 'brand-new-secret-1',
    ])->assertStatus(422);

    fromWeb()->postJson('/api/auth/login', ['email' => 'owner-reset@test.local', 'password' => 'password'])->assertOk();
});

it('lets a signed-in user change their own password when they know the current one', function () {
    $teacher = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-pw@test.local']);
    Sanctum::actingAs($teacher);

    $this->postJson('/api/auth/password', ['current_password' => 'wrong', 'password' => 'new-secret-123'])
        ->assertStatus(422);

    $this->postJson('/api/auth/password', ['current_password' => 'password', 'password' => 'new-secret-123'])
        ->assertOk();

    $this->asSuperAdmin();
    $hash = (string) DB::selectOne('select password from app.auth_find_by_id(?::uuid)', [$teacher->id])->password;
    expect(Hash::check('new-secret-123', $hash))->toBeTrue();

    $this->asAcademy($this->academy);
    expect(DB::table('audit_log')->where('action', 'auth.password_changed')->where('actor_user_id', $teacher->id)->exists())->toBeTrue();
});

it('lets the platform admin reset button actually send a link now', function () {
    Notification::fake();
    $admin = $this->makeUser(null, 'SUPER_ADMIN');
    Sanctum::actingAs($admin);

    $this->postJson("/api/admin/users/{$this->owner->id}/reset-password")
        ->assertOk()
        ->assertJsonPath('sent', true);

    Notification::assertSentTo($this->owner, ResetPassword::class);
});
