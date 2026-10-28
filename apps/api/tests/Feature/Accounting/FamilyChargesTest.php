<?php

declare(strict_types=1);

use App\Services\Invoicing;
use App\Services\ModuleBilling;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * A child's charges follow them to the family they move to (App\Services\FamilyCharges). Lingo,
 * 2026-10-28: two «آيات محسن»; the child was moved onto one to delete the other, and the emptied
 * parent kept owing everything. Pinned here:
 *   - what is still owed moves; what was paid stays with the family that paid it (and its receipt);
 *   - a running month joins the new family's bill for that month; a closed bill shared with
 *     siblings cannot be split and is reported as stuck;
 *   - a child moved before this existed shows on the old family's page and is carried on demand;
 *   - an academy on the classic "mark paid" gets the same move.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'invoice_grouping' => 'PER_GUARDIAN']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-family-charges@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona', 'session_rate_minor' => 6000, 'currency' => 'EGP']);
    // The duplicate: the same mother entered twice.
    $this->first = $this->createGuardian($this->academy, ['full_name' => 'آيات محسن', 'whatsapp_phone' => '+201001112201']);
    $this->second = $this->createGuardian($this->academy, ['full_name' => 'آيات محسن', 'whatsapp_phone' => '+201001112202']);
    $this->omar = $this->createStudent($this->academy, $this->first, ['full_name' => 'Omar', 'status' => 'REGULAR']);
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

function fcOn(string $academyId): void
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    try {
        app(ModuleBilling::class)->setDisabledFeatures($academyId, 'MANAGEMENT', [], ['accounting']);
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

function fcTenant(string $academyId, callable $fn): mixed
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'ACADEMY_OWNER', true)");
    try {
        return $fn();
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

/** A monthly group from May: each member owes 450 for May and 450 for June. */
function fcGroup($test, array $studentIds): string
{
    Sanctum::actingAs($test->owner);

    return $test->postJson('/api/groups', [
        'name' => 'English A1', 'teacher_id' => $test->teacher, 'start_date' => '2026-05-01',
        'slots' => [['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60]],
        'billing_mode' => 'MONTHLY', 'price_minor' => 45000, 'currency' => 'EGP',
        'student_ids' => $studentIds,
    ])->assertCreated()->json('group.id');
}

/** Close a family's bill for a month, as the 2nd of the next month does. */
function fcClose($test, string $guardianId, int $month): void
{
    fcTenant($test->academy, function () use ($test, $guardianId, $month) {
        $id = DB::table('invoices')->where('guardian_id', $guardianId)->where('period_month', $month)->where('kind', 'AUTO')->value('id');
        app(Invoicing::class)->closeInvoice((string) $id, $test->academy, (string) $test->owner->id, 'ACADEMY_OWNER');
    });
}

function fcDue($test, string $guardianId): int
{
    return (int) collect($test->getJson("/api/accounting/family/{$guardianId}")->assertOk()->json('balance'))->sum('due_minor');
}

it('moves what a child still owes with them, and leaves what was paid with the family that paid it', function () {
    fcOn($this->academy);
    fcGroup($this, [$this->omar]);
    fcClose($this, $this->first, 5);
    // May is paid by the first record; June is not.
    $this->postJson('/api/receipts', ['guardian_id' => $this->first, 'amount_minor' => 45000, 'method' => 'CASH'])->assertCreated();
    expect(fcDue($this, $this->first))->toBe(45000);

    $res = $this->patchJson("/api/students/{$this->omar}", ['guardian_id' => $this->second])->assertOk();
    expect($res->json('charges'))->toMatchArray(['lines' => 1, 'invoices' => 1, 'stuck' => 0, 'amounts' => [['currency' => 'EGP', 'amount_minor' => 45000]]]);

    // The emptied record owes nothing; the one Omar is in now owes his June.
    expect(fcDue($this, $this->first))->toBe(0)
        ->and(fcDue($this, $this->second))->toBe(45000)
        ->and($this->getJson("/api/guardians/{$this->first}")->json('moved_away'))->toBe([]);
    fcTenant($this->academy, function () {
        expect(DB::table('invoices')->where('period_month', 5)->value('guardian_id'))->toBe($this->first)
            ->and(DB::table('invoices')->where('period_month', 6)->value('guardian_id'))->toBe($this->second)
            ->and(DB::table('receipts')->value('guardian_id'))->toBe($this->first)
            ->and(DB::table('audit_log')->where('action', 'student.charges_moved')->exists())->toBeTrue();
    });
});

it('joins the new family’s running month, and reports a closed bill shared with siblings it cannot split', function () {
    fcOn($this->academy);
    $sister = fcTenant($this->academy, fn () => $this->createStudent($this->academy, $this->first, ['full_name' => 'Mariam', 'status' => 'REGULAR']));
    $cousin = fcTenant($this->academy, fn () => $this->createStudent($this->academy, $this->second, ['full_name' => 'Yusuf', 'status' => 'REGULAR']));
    $this->clearTenantContext();
    fcGroup($this, [$this->omar, $sister, $cousin]);
    fcClose($this, $this->first, 5);
    fcClose($this, $this->second, 5);

    $res = $this->patchJson("/api/students/{$this->omar}", ['guardian_id' => $this->second])->assertOk();
    expect($res->json('charges'))->toMatchArray(['lines' => 1, 'stuck' => 1]);

    fcTenant($this->academy, function () {
        // June: one bill per family and month — Omar's line joined the second family's.
        $june = DB::table('invoices')->where('period_month', 6)->where('kind', 'AUTO')->pluck('total_minor', 'guardian_id');
        expect((int) $june[$this->second])->toBe(90000)->and((int) $june[$this->first])->toBe(45000);
    });
    // His May sits on a closed bill with his sister's: it stays, and the page says so.
    $stray = $this->getJson("/api/guardians/{$this->first}")->assertOk()->json('moved_away');
    expect($stray)->toHaveCount(1)
        ->and($stray[0])->toMatchArray(['student_id' => $this->omar, 'guardian_id' => $this->second, 'movable' => false, 'amounts' => [['currency' => 'EGP', 'amount_minor' => 45000]]]);
});

it('carries, on demand, the charges of a child moved before charges followed', function () {
    fcOn($this->academy);
    fcGroup($this, [$this->omar]);
    fcClose($this, $this->first, 5);
    // The move as it used to be: the child alone.
    fcTenant($this->academy, fn () => DB::table('students')->where('id', $this->omar)->update(['guardian_id' => $this->second]));

    $stray = $this->getJson("/api/guardians/{$this->first}")->assertOk()->json('moved_away');
    expect($stray[0])->toMatchArray(['student_name' => 'Omar', 'guardian_name' => 'آيات محسن', 'movable' => true, 'amounts' => [['currency' => 'EGP', 'amount_minor' => 90000]]]);

    $res = $this->postJson("/api/students/{$this->omar}/carry-charges", ['from_guardian_id' => $this->first])->assertOk();
    expect($res->json('charges'))->toMatchArray(['lines' => 2, 'invoices' => 2, 'stuck' => 0]);
    expect(fcDue($this, $this->first))->toBe(0)
        ->and(fcDue($this, $this->second))->toBe(90000)
        ->and($this->getJson("/api/guardians/{$this->first}")->json('moved_away'))->toBe([]);
    // Nothing left to carry: a second call is a no-op.
    expect($this->postJson("/api/students/{$this->omar}/carry-charges")->assertOk()->json('charges.lines'))->toBe(0);
});

it('moves an unpaid bill on the classic “mark paid” too, and never a paid one', function () {
    fcGroup($this, [$this->omar]);
    fcClose($this, $this->first, 5);
    fcTenant($this->academy, fn () => DB::table('invoices')->where('guardian_id', $this->first)->where('period_month', 5)
        ->update(['status' => 'PAID', 'amount_paid_minor' => 45000, 'paid_at' => now()]));

    $res = $this->patchJson("/api/students/{$this->omar}", ['guardian_id' => $this->second])->assertOk();
    expect($res->json('charges'))->toMatchArray(['lines' => 1, 'stuck' => 0]);
    fcTenant($this->academy, function () {
        expect(DB::table('invoices')->where('period_month', 5)->value('guardian_id'))->toBe($this->first)
            ->and(DB::table('invoices')->where('period_month', 6)->value('guardian_id'))->toBe($this->second);
    });
    // Money is invoice.read's: the front desk reads the family, not what it owes.
    // (Omar back with the first record, the old way: his June on the second is now a stray.)
    fcTenant($this->academy, fn () => DB::table('students')->where('id', $this->omar)->update(['guardian_id' => $this->first]));
    expect($this->getJson("/api/guardians/{$this->second}")->json('moved_away'))->toHaveCount(1);
    Sanctum::actingAs($this->makeUser($this->academy, 'CUSTOMER_SERVICE', ['email' => 'desk-family-charges@test.local']));
    expect($this->getJson("/api/guardians/{$this->second}")->assertOk()->json('moved_away'))->toBe([]);
});
