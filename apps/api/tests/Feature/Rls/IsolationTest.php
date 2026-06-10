<?php

declare(strict_types=1);

use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class);

beforeEach(function () {
    $this->A = $this->createAcademy();
    $this->B = $this->createAcademy();
    // Academy A: two students; Academy B: one student.
    $this->createStudent($this->A);
    $this->createStudent($this->A);
    $this->bStudent = $this->createStudent($this->B);
});

// ── TC-1.7 (AC-1.3): context A sees only A's students ────────────────────────
it('scopes reads to the active academy', function () {
    $this->asAcademy($this->A);
    expect(DB::table('students')->count())->toBe(2);

    $this->asAcademy($this->B);
    expect(DB::table('students')->count())->toBe(1);
});

// ── TC-1.8 (AC-1.3): an explicit cross-tenant filter still yields nothing ─────
it('returns zero rows for an explicit cross-tenant filter', function () {
    $this->asAcademy($this->A);
    expect(DB::table('students')->where('academy_id', $this->B)->count())->toBe(0);
});

// ── TC-1.9 (AC-1.4): with check rejects an insert into another tenant ─────────
it('rejects inserting a row tagged with another academy', function () {
    $this->asAcademy($this->A);
    expect(fn () => DB::table('students')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->B,            // cross-tenant
        'guardian_id' => DB::table('guardians')->value('id'),
        'full_name' => 'Smuggled',
    ]))->toThrow(QueryException::class);
});

// ── TC-1.10 (AC-1.5): cannot move a row to another tenant via update ──────────
it('rejects updating a row into another academy', function () {
    $this->asAcademy($this->A);
    $aStudent = DB::table('students')->value('id');
    expect(fn () => DB::table('students')->where('id', $aStudent)->update(['academy_id' => $this->B]))
        ->toThrow(QueryException::class);
});

// ── TC-1.11 (AC-1.3): B's rows are invisible, hence not deletable from A ──────
it('cannot delete an invisible cross-tenant row', function () {
    $this->asAcademy($this->A);
    $affected = DB::table('students')->where('id', $this->bStudent)->delete();
    expect($affected)->toBe(0);

    // And it still exists, seen from B.
    $this->asAcademy($this->B);
    expect(DB::table('students')->where('id', $this->bStudent)->exists())->toBeTrue();
});

// ── TC-1.12 (AC-1.3): fail closed when no context is set ─────────────────────
it('returns zero rows with no tenant context (fail closed)', function () {
    $this->clearTenantContext();
    expect(DB::table('students')->count())->toBe(0);
    expect(DB::table('invoices')->count())->toBe(0);
    expect(DB::table('teachers')->count())->toBe(0);
});

// ── TC-1.14 (AC-1.6): Super Admin without entering an academy sees nothing ───
it('shows a Super Admin no tenant rows until they enter an academy', function () {
    $this->asSuperAdmin();
    expect(DB::table('students')->count())->toBe(0);
});

// ── TC-1.15 (AC-1.6): Super Admin entering academy A is scoped to A ──────────
it('scopes a Super Admin to the academy they enter', function () {
    $this->enterAcademyAsSuperAdmin($this->A);
    expect(DB::table('students')->count())->toBe(2);

    $this->enterAcademyAsSuperAdmin($this->B);
    expect(DB::table('students')->count())->toBe(1);
});

// ── TC-1.16 (AC-1.6): the audited super-admin academy list ───────────────────
it('lists all academies only via the audited super-admin path', function () {
    $this->asSuperAdmin();
    $json = DB::selectOne('select app.admin_list_academies() as a')->a;
    expect(json_decode($json, true))->toHaveCount(2);

    // A normal academy role is denied by the function body.
    $this->asAcademy($this->A);
    expect(fn () => DB::selectOne('select app.admin_list_academies() as a'))
        ->toThrow(QueryException::class);
});
