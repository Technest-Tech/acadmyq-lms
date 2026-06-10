<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;

it('reports the app is up', function (): void {
    // TC-0.9
    $this->getJson('/api/health')
        ->assertOk()
        ->assertJsonPath('app', 'ok')
        ->assertJsonStructure(['app', 'db', 'version', 'time']);
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
