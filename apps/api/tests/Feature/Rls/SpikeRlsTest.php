<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class);

/**
 * SPIKE test (temporary): proves fail-closed + isolation + write-constraint on ONE
 * table, locking the harness/pooler/role pattern the whole sprint depends on.
 */
$A = '11111111-1111-1111-1111-111111111111';
$B = '22222222-2222-2222-2222-222222222222';

/** Insert under the given academy's own context (so `with check` is satisfied). */
function spikeInsert(callable $ctx, string $academyId, string $label): void
{
    $ctx();
    DB::table('spike_widgets')->insert([
        'id' => DB::raw('uuid_generate_v7()'),
        'academy_id' => $academyId,
        'label' => $label,
    ]);
}

it('connects as a role that FORCE RLS actually applies to', function () {
    $row = DB::selectOne('select rolsuper, rolbypassrls from pg_roles where rolname = current_user');
    expect($row->rolsuper)->toBeFalse();
    expect($row->rolbypassrls)->toBeFalse();
});

it('fails closed: with no tenant context, a tenant table returns zero rows', function () use ($A, $B) {
    spikeInsert(fn () => $this->asAcademy($A), $A, 'A-1');
    spikeInsert(fn () => $this->asAcademy($B), $B, 'B-1');

    $this->clearTenantContext();
    expect(DB::table('spike_widgets')->count())->toBe(0);
});

it('isolates reads: context A sees only A rows, even with an explicit B filter', function () use ($A, $B) {
    spikeInsert(fn () => $this->asAcademy($A), $A, 'A-1');
    spikeInsert(fn () => $this->asAcademy($A), $A, 'A-2');
    spikeInsert(fn () => $this->asAcademy($B), $B, 'B-1');

    $this->asAcademy($A);
    expect(DB::table('spike_widgets')->count())->toBe(2);
    expect(DB::table('spike_widgets')->where('academy_id', $B)->count())->toBe(0);
});

it('blocks cross-tenant writes via with check', function () use ($A, $B) {
    $this->asAcademy($A);
    expect(fn () => DB::table('spike_widgets')->insert([
        'id' => DB::raw('uuid_generate_v7()'),
        'academy_id' => $B,
        'label' => 'evil',
    ]))->toThrow(Illuminate\Database\QueryException::class);
});

it('mints time-ordered uuid v7 values (version nibble = 7)', function () {
    $uuid = DB::selectOne('select uuid_generate_v7() as id')->id;
    // 15th hex char (index 14, after 3 dash-separated groups "xxxxxxxx-xxxx-Vxxx") is the version
    expect($uuid[14])->toBe('7');
});
