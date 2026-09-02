<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;

uses(RefreshDatabase::class);

/** Canonical tenant-scoped tables: academy_id + the identical standard policy (§7.2). */
const TENANT_TABLES = [
    'users', 'user_roles', 'teachers', 'guardians', 'students',
    'student_teacher_assignments', 'subscriptions', 'report_field_definitions',
    'schedules', 'schedule_slots', 'sessions', 'session_reports',
    'invoices', 'invoice_line_items', 'payouts', 'payout_line_items',
];

// ── TC-1.1 (AC-1.1): schema matches the expected table list ──────────────────
it('creates every expected domain table', function () {
    $expected = array_merge(TENANT_TABLES, [
        'plans', 'add_ons', 'academy_types', 'permissions', 'role_permissions',
        'academies', 'audit_log',
    ]);
    $present = DB::table('pg_tables')->where('schemaname', 'public')->pluck('tablename')->all();

    foreach ($expected as $table) {
        expect($present)->toContain($table);
    }
});

// ── TC-1.3 (AC-1.2): RLS enabled AND forced on every tenant-scoped table ──────
it('enables and forces RLS on every tenant-scoped table', function () {
    foreach (array_merge(TENANT_TABLES, ['academies', 'audit_log']) as $table) {
        $rel = DB::selectOne(
            'select relrowsecurity, relforcerowsecurity from pg_class where relname = ?',
            [$table]
        );
        expect($rel->relrowsecurity)->toBeTrue("RLS not enabled on {$table}");
        expect($rel->relforcerowsecurity)->toBeTrue("RLS not forced on {$table}");
    }
});

// ── TC-1.13 (AC-1.2/1.3): the standard policy (qual AND with_check) on each ───
// Parameterized over ALL tenant tables — a future table without it fails CI (§12 risk).
it('has a tenant_isolation policy with both USING and WITH CHECK', function (string $table) {
    $policy = DB::selectOne(
        "select qual, with_check from pg_policies where tablename = ? and policyname = 'tenant_isolation'",
        [$table]
    );
    expect($policy)->not->toBeNull("missing tenant_isolation policy on {$table}");
    expect($policy->qual)->toContain('current_academy_id');
    expect($policy->with_check)->toContain('current_academy_id');
})->with(TENANT_TABLES);

// ── TC-9.11/9.12 (AC-9.7): the policy-coverage gate is DYNAMIC ────────────────
// Discover every public table that carries an academy_id column and assert each has the
// standard tenant_isolation policy (both using + with check). This catches anything any
// Sprint added — academy_addons (Sprint 9) and any future table — without editing a list.
// audit_log is the one deliberate exception: it is append-only (insert + scoped-select
// policies, no tenant_isolation), so it is asserted separately below.
function tenantScopedTables(): array
{
    return collect(DB::select(
        "select c.relname as t
         from information_schema.columns col
         join pg_class c on c.relname = col.table_name
         where col.table_schema = 'public' and col.column_name = 'academy_id'
           and c.relkind = 'r'
         group by c.relname"
    ))->pluck('t')->reject(fn ($t) => $t === 'audit_log')->values()->all();
}

it('covers every academy_id-bearing table with the standard tenant_isolation policy', function () {
    $uncovered = [];
    foreach (tenantScopedTables() as $table) {
        $policy = DB::selectOne(
            "select qual, with_check from pg_policies where tablename = ? and policyname = 'tenant_isolation'",
            [$table]
        );
        if ($policy === null
            || ! str_contains((string) $policy->qual, 'current_academy_id')
            || ! str_contains((string) $policy->with_check, 'current_academy_id')) {
            $uncovered[] = $table;
        }
    }

    expect($uncovered)->toBe([], 'tenant tables missing the standard policy: '.implode(', ', $uncovered));
    // Sanity: the newly-added Sprint-9 table is among those discovered + covered.
    expect(tenantScopedTables())->toContain('academy_addons');
});

it('fails the coverage gate when a tenant table is added without the standard policy (TC-9.12)', function () {
    // A throwaway tenant table with academy_id but NO policy — proves the gate actually bites.
    DB::statement('create table _throwaway_tenant (id uuid primary key, academy_id uuid not null)');

    try {
        $missing = collect(tenantScopedTables())->filter(function (string $table): bool {
            $p = DB::selectOne(
                "select 1 from pg_policies where tablename = ? and policyname = 'tenant_isolation'",
                [$table]
            );

            return $p === null;
        })->values()->all();

        expect($missing)->toContain('_throwaway_tenant');
    } finally {
        DB::statement('drop table if exists _throwaway_tenant');
    }
});

it('keeps audit_log append-only: insert + tenant-scoped select, no tenant_isolation policy', function () {
    $names = DB::table('pg_policies')->where('tablename', 'audit_log')->pluck('policyname')->all();
    expect($names)->toContain('audit_insert');
    expect($names)->toContain('audit_select');
    expect($names)->not->toContain('tenant_isolation'); // never a write-back policy (R-AUD-1)
});

// ── TC-1.4 (AC-1.14): each enum has exactly the documented labels ─────────────
it('defines each enum type with exactly the documented labels', function (string $type, array $labels) {
    $actual = DB::table('pg_enum as e')
        ->join('pg_type as t', 't.oid', '=', 'e.enumtypid')
        ->where('t.typname', $type)
        ->orderBy('e.enumsortorder')
        ->pluck('e.enumlabel')
        ->all();
    expect($actual)->toBe($labels);
})->with([
    ['session_status', ['SCHEDULED', 'ATTENDED', 'FREE', 'ABSENT_UNEXCUSED', 'ABSENT_EXCUSED', 'CANCELLED_BY_TEACHER', 'CANCELLED_BY_STUDENT', 'RESCHEDULED']],
    ['invoice_status', ['OPEN', 'CLOSED', 'PAID', 'PARTIALLY_PAID', 'VOID']],
    ['payment_method', ['CASH', 'BANK_TRANSFER', 'GATEWAY', 'OTHER']],
    ['academy_status', ['ACTIVE', 'SUSPENDED', 'TRIAL']],
    ['subscription_status', ['ACTIVE', 'PAUSED', 'ENDED']],
    ['report_field_type', ['TEXT', 'TEXTAREA', 'NUMBER', 'SELECT', 'RATING']],
    ['app_role', ['SUPER_ADMIN', 'ACADEMY_OWNER', 'TEACHER', 'STAFF', 'SUPERVISOR']],
    ['invoice_grouping', ['PER_GUARDIAN', 'PER_STUDENT']],
]);

// ── TC-1.5 (AC-1.10): money is integer minor units; no float/numeric money ───
it('stores no monetary column as float or numeric', function () {
    $offenders = DB::select(
        "select table_name, column_name, data_type
         from information_schema.columns
         where table_schema = 'public'
           and data_type in ('real','double precision','numeric')"
    );
    expect($offenders)->toBe([]);
});

it('stores every *_minor column as bigint', function () {
    $minorCols = DB::select(
        "select table_name, column_name, data_type
         from information_schema.columns
         where table_schema = 'public' and column_name like '%_minor'"
    );
    expect($minorCols)->not->toBe([]);
    foreach ($minorCols as $col) {
        expect($col->data_type)->toBe('bigint', "{$col->table_name}.{$col->column_name} is {$col->data_type}");
    }
});

// ── TC-1.6 (AC-1.13): calendar indexes on sessions ───────────────────────────
it('has the teacher and student calendar indexes on sessions', function () {
    $defs = DB::table('pg_indexes')->where('tablename', 'sessions')->pluck('indexdef')->implode("\n");
    expect($defs)->toContain('academy_id, teacher_id, scheduled_at_utc');
    expect($defs)->toContain('academy_id, student_id, scheduled_at_utc');
});
