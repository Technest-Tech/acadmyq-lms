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
    Storage::fake('local');

    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
    $this->academy = $this->createAcademy();
});

it('uploads a logo, stores it and writes the url every branded surface reads', function () {
    Sanctum::actingAs($this->admin);

    $url = $this->post("/api/admin/academies/{$this->academy}/logo", [
        'logo' => UploadedFile::fake()->image('brand.png', 200, 200),
    ])->assertOk()->json('brand_logo_url');

    expect($url)->toContain("/api/brand/{$this->academy}/logo/");

    $this->asSuperAdmin();
    expect(DB::table('academies')->where('id', $this->academy)->value('brand_logo_url'))->toBe($url);

    $files = Storage::disk('local')->files("academy-logos/{$this->academy}");
    expect($files)->toHaveCount(1);
});

it('serves the uploaded logo publicly — no login, since the sign-in page paints it', function () {
    Sanctum::actingAs($this->admin);
    $url = $this->post("/api/admin/academies/{$this->academy}/logo", [
        'logo' => UploadedFile::fake()->image('brand.png'),
    ])->json('brand_logo_url');

    $path = parse_url($url, PHP_URL_PATH);

    // A visitor with no session at all.
    app('auth')->forgetGuards();
    $this->get($path)
        ->assertOk()
        ->assertHeader('Content-Type', 'image/png');
});

it('replaces rather than accumulates: one client folder holds exactly one logo', function () {
    Sanctum::actingAs($this->admin);

    $first = $this->post("/api/admin/academies/{$this->academy}/logo", [
        'logo' => UploadedFile::fake()->image('one.png'),
    ])->json('brand_logo_url');

    $second = $this->post("/api/admin/academies/{$this->academy}/logo", [
        'logo' => UploadedFile::fake()->image('two.png'),
    ])->json('brand_logo_url');

    expect($second)->not->toBe($first);
    expect(Storage::disk('local')->files("academy-logos/{$this->academy}"))->toHaveCount(1);

    // The old URL is gone — a replaced logo can never keep serving from a cache-immortal path.
    $this->get((string) parse_url($first, PHP_URL_PATH))->assertNotFound();
});

it('removes the logo and clears the column', function () {
    Sanctum::actingAs($this->admin);
    $this->post("/api/admin/academies/{$this->academy}/logo", [
        'logo' => UploadedFile::fake()->image('brand.png'),
    ])->assertOk();

    $this->deleteJson("/api/admin/academies/{$this->academy}/logo")->assertOk();

    $this->asSuperAdmin();
    expect(DB::table('academies')->where('id', $this->academy)->value('brand_logo_url'))->toBeNull();
    expect(Storage::disk('local')->files("academy-logos/{$this->academy}"))->toBeEmpty();
});

it('rejects a file that is not an image we will serve', function () {
    Sanctum::actingAs($this->admin);

    $this->post("/api/admin/academies/{$this->academy}/logo", [
        'logo' => UploadedFile::fake()->create('payload.svg', 4, 'image/svg+xml'),
    ])->assertStatus(422);
});

it('is closed to a user without academy.configure', function () {
    $teacher = $this->makeUser($this->academy, 'TEACHER');
    Sanctum::actingAs($teacher);

    $this->post("/api/admin/academies/{$this->academy}/logo", [
        'logo' => UploadedFile::fake()->image('brand.png'),
    ])->assertForbidden();
});

it('404s for an academy that does not exist', function () {
    Sanctum::actingAs($this->admin);

    $this->post('/api/admin/academies/'.Str::uuid().'/logo', [
        'logo' => UploadedFile::fake()->image('brand.png'),
    ])->assertNotFound();
});
