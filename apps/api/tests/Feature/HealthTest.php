<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

it('reports the app is up', function (): void {
    // TC-0.9
    $this->getJson('/api/health')
        ->assertOk()
        ->assertJsonPath('app', 'ok')
        ->assertJsonStructure(['app', 'db', 'scheduler', 'version', 'time']);
});

it('reports db: ok when the connection is live', function (): void {
    // TC-0.10 — sqlite :memory: locally; CI overrides to PostgreSQL via real env.
    $this->getJson('/api/health')
        ->assertOk()
        ->assertJsonPath('db', 'ok');
});

it('reports db: error with a degraded 200 payload when the DB is unreachable', function (): void {
    // TC-0.11 — point the default connection at an unopenable database.
    config([
        'database.default' => 'bogus',
        'database.connections.bogus' => [
            'driver' => 'sqlite',
            'database' => '/nonexistent-dir/does-not-exist.sqlite',
            'prefix' => '',
            'foreign_key_constraints' => false,
        ],
    ]);
    DB::purge('bogus');

    $this->getJson('/api/health')
        ->assertOk() // degraded, NOT a 500 crash
        ->assertJsonPath('app', 'ok')
        ->assertJsonPath('db', 'error');
});

// ── Is the scheduler alive? ──────────────────────────────────────────────────
// The cron driving every recurring job was absent from production for two months and nothing
// reported it, so the health check now carries the two ages that make that visible.

it('reports how long ago the scheduler last ran', function (): void {
    Cache::put('scheduler.heartbeat_at', now()->subSeconds(90)->toIso8601String());
    Cache::put('scheduler.last_roll_at', now()->subHours(6)->toIso8601String());

    $body = $this->getJson('/api/health')->assertOk()->json('scheduler');

    expect($body['age_seconds'])->toBeGreaterThanOrEqual(89)->toBeLessThan(120);
    expect((int) $body['last_roll_age_hours'])->toBe(6);
});

it('reports null ages rather than failing when the scheduler has never run', function (): void {
    Cache::forget('scheduler.heartbeat_at');
    Cache::forget('scheduler.last_roll_at');

    $this->getJson('/api/health')
        ->assertOk()
        ->assertJsonPath('scheduler.age_seconds', null)
        ->assertJsonPath('scheduler.last_roll_age_hours', null);
});
