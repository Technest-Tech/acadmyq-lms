<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

/**
 * Owner-managed teacher sign-in login (email + password): create one when the teacher has none,
 * or change the email / reset the password when they do — surfaced on the teacher detail page.
 */
uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy();
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-login@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'No Login Teacher']);
});

it('creates a login for a teacher that has none', function () {
    Sanctum::actingAs($this->owner);

    $res = $this->patchJson("/api/teachers/{$this->teacher}/login", [
        'email' => 'newteacher@test.local',
        'password' => 'secret-pass-123',
    ])->assertStatus(201);
    expect($res->json('created'))->toBeTrue();

    $this->asAcademy($this->academy);
    $teacher = DB::table('teachers')->where('id', $this->teacher)->first();
    expect($teacher->user_id)->not->toBeNull();
    $user = DB::table('users')->where('id', $teacher->user_id)->first();
    expect($user->email)->toBe('newteacher@test.local')
        ->and(Hash::check('secret-pass-123', $user->password))->toBeTrue();
    expect(DB::table('user_roles')->where('user_id', $teacher->user_id)->where('role', 'TEACHER')->exists())->toBeTrue();
});

it('reflects the login state on the teacher detail', function () {
    Sanctum::actingAs($this->owner);
    expect($this->getJson("/api/teachers/{$this->teacher}")->assertOk()->json('login.has_login'))->toBeFalse();

    $this->patchJson("/api/teachers/{$this->teacher}/login", [
        'email' => 'shown@test.local', 'password' => 'secret-pass-123',
    ])->assertStatus(201);

    $login = $this->getJson("/api/teachers/{$this->teacher}")->assertOk()->json('login');
    expect($login['has_login'])->toBeTrue()
        ->and($login['email'])->toBe('shown@test.local');
});

it('requires both email and password when creating a login', function () {
    Sanctum::actingAs($this->owner);

    $this->patchJson("/api/teachers/{$this->teacher}/login", ['email' => 'only@test.local'])
        ->assertStatus(422)->assertJsonValidationErrors('password');
});

it('updates the email and password of an existing login', function () {
    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/teachers/{$this->teacher}/login", [
        'email' => 'before@test.local', 'password' => 'secret-pass-123',
    ])->assertStatus(201);

    $res = $this->patchJson("/api/teachers/{$this->teacher}/login", [
        'email' => 'after@test.local', 'password' => 'brand-new-pass-9',
    ])->assertOk();
    expect($res->json('created'))->toBeFalse()
        ->and($res->json('changed'))->toContain('email')
        ->and($res->json('changed'))->toContain('password');

    $this->asAcademy($this->academy);
    $teacher = DB::table('teachers')->where('id', $this->teacher)->first();
    $user = DB::table('users')->where('id', $teacher->user_id)->first();
    expect($user->email)->toBe('after@test.local')
        ->and(Hash::check('brand-new-pass-9', $user->password))->toBeTrue();
});

it('rejects changing a login to an email already in use', function () {
    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/teachers/{$this->teacher}/login", [
        'email' => 'taken@test.local', 'password' => 'secret-pass-123',
    ])->assertStatus(201);

    $teacherB = $this->createTeacher($this->academy, ['full_name' => 'Teacher B']);
    $this->patchJson("/api/teachers/{$teacherB}/login", [
        'email' => 'taken@test.local', 'password' => 'another-pass-1',
    ])->assertStatus(422)->assertJsonValidationErrors('email');
});

it('forbids a teacher from setting a login (owner-only)', function () {
    $teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-actor@test.local']);
    Sanctum::actingAs($teacherUser);

    $this->patchJson("/api/teachers/{$this->teacher}/login", [
        'email' => 'x@test.local', 'password' => 'secret-pass-123',
    ])->assertStatus(403);
});
