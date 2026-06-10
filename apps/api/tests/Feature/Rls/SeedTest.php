<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class);

/** The seeder clears context when done; re-enter the demo academy to read its rows. */
function enterDemoAcademy(): string
{
    test()->asSuperAdmin();                       // super admin may see all academies
    $id = DB::table('academies')->where('subdomain', 'noor')->value('id');
    test()->enterAcademyAsSuperAdmin($id);

    return $id;
}

// ── TC-1.31 (AC-1.12): seeding an empty DB yields the demo academy ───────────
it('seeds the demo Qur\'an academy with the expected counts', function () {
    $this->seed(DemoAcademySeeder::class);
    enterDemoAcademy();

    expect(DB::table('academies')->where('subdomain', 'noor')->count())->toBe(1);
    expect(DB::table('guardians')->count())->toBe(1);
    expect(DB::table('students')->count())->toBe(2);
    expect(DB::table('teachers')->count())->toBe(2);
    expect(DB::table('report_field_definitions')->count())->toBe(5);
});

// ── TC-1.32 (AC-1.12): the seeder is idempotent ──────────────────────────────
it('produces identical counts when run twice', function () {
    $this->seed(DemoAcademySeeder::class);
    $this->seed(DemoAcademySeeder::class);
    enterDemoAcademy();

    expect(DB::table('students')->count())->toBe(2);
    expect(DB::table('teachers')->count())->toBe(2);
    expect(DB::table('report_field_definitions')->count())->toBe(5);
    expect(DB::table('subscriptions')->count())->toBe(2);
    expect(DB::table('sessions')->count())->toBe(4);
});

// ── TC-1.33 (R-CRF-1, AC-1.12): QURAN report fields with correct types ───────
it('seeds the QURAN report-field definitions with correct types', function () {
    $this->seed(DemoAcademySeeder::class);
    enterDemoAcademy();

    $fields = DB::table('report_field_definitions')->pluck('field_type', 'key');
    expect($fields['surah_from'])->toBe('TEXT');
    expect($fields['surah_to'])->toBe('TEXT');
    expect($fields['tajweed_rating'])->toBe('SELECT');
    expect($fields['next_assignment'])->toBe('TEXT');
    expect($fields['notes'])->toBe('TEXTAREA');
});
