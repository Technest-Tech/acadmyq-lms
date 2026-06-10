<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * TC-1.1 / TC-1.2 (AC-1.1): migrations apply from empty, roll back cleanly, and
 * re-apply. This test drives real migrate commands, so it must NOT use
 * RefreshDatabase (no surrounding transaction). It leaves the database fully migrated.
 */
function enumExists(string $name): bool
{
    return DB::table('pg_type')->where('typname', $name)->exists();
}

it('applies, rolls back, and re-applies the whole migration set cleanly', function () {
    // Fresh apply from empty (drop-types so a repeat run starts truly clean).
    Artisan::call('migrate:fresh', ['--drop-types' => true, '--force' => true]);
    expect(Schema::hasTable('students'))->toBeTrue();
    expect(Schema::hasTable('invoices'))->toBeTrue();
    expect(enumExists('session_status'))->toBeTrue();

    // Roll back the entire batch.
    Artisan::call('migrate:rollback', ['--force' => true]);
    expect(Schema::hasTable('students'))->toBeFalse();
    expect(Schema::hasTable('invoices'))->toBeFalse();
    expect(enumExists('session_status'))->toBeFalse();

    // Re-apply succeeds.
    Artisan::call('migrate', ['--force' => true]);
    expect(Schema::hasTable('students'))->toBeTrue();
    expect(enumExists('session_status'))->toBeTrue();
})->skip(
    fn () => DB::connection()->getDriverName() !== 'pgsql',
    'RLS migrations require PostgreSQL.'
);
