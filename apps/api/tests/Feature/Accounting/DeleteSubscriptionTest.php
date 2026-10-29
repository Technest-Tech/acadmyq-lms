<?php

declare(strict_types=1);

use App\Services\Invoicing;
use App\Services\ModuleBilling;
use App\Support\Audit;
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
 * Deleting a subscription opened by mistake takes its charge with it (a curriculum centre,
 * 2026-10-29: "when I delete a group or a private subscription, its due stays"):
 *   - a group membership that began mid-month: its month's charge is dated the 1st, before the
 *     join — it used to be left behind;
 *   - an unused private subscription whose bill already closed with its month: voided too (a
 *     centre's only; every other academy keeps the open-bill-only rule).
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'invoice_grouping' => 'PER_GUARDIAN']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-delete-subs@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona', 'session_rate_minor' => 6000, 'currency' => 'EGP']);
    $this->parent = $this->createGuardian($this->academy, ['full_name' => 'Adam’s mother']);
    $this->adam = $this->createStudent($this->academy, $this->parent, ['full_name' => 'Adam', 'status' => 'REGULAR']);
    $this->clearTenantContext();

    dsFeatures($this->academy, ['accounting', 'centre']);
    Sanctum::actingAs($this->owner);
});

afterEach(fn () => Carbon::setTestNow());

function dsFeatures(string $academyId, array $optIns): void
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    try {
        app(ModuleBilling::class)->setDisabledFeatures($academyId, 'MANAGEMENT', [], $optIns);
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

function dsTenant(string $academyId, callable $fn): mixed
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

function dsDue($test): array
{
    $b = $test->getJson("/api/accounting/family/{$test->parent}")->assertOk()->json('balance.0') ?? [];

    return ['due' => (int) ($b['due_minor'] ?? 0), 'credit' => (int) ($b['credit_minor'] ?? 0)];
}

/** A monthly group from May (Mondays), Adam joining on `$joinedOn`. */
function dsJoin($test, string $joinedOn): string
{
    $group = $test->postJson('/api/groups', [
        'name' => 'English A1', 'teacher_id' => $test->teacher, 'start_date' => '2026-05-01',
        'slots' => [['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60]],
        'billing_mode' => 'MONTHLY', 'price_minor' => 45000, 'currency' => 'EGP',
    ])->assertCreated()->json('group.id');
    $test->postJson("/api/groups/{$group}/members", ['student_ids' => [$test->adam], 'joined_on' => $joinedOn])->assertSuccessful();

    return $group;
}

it('takes the month off the family when a group subscription begun mid-month is deleted — and what was paid back as credit', function () {
    $group = dsJoin($this, '2026-06-10');
    $owed = dsDue($this)['due'];
    expect($owed)->toBeGreaterThan(0);
    // Part of it paid: the rest of the delete gives that back.
    $this->postJson('/api/receipts', ['guardian_id' => $this->parent, 'amount_minor' => 10000, 'method' => 'CASH'])->assertCreated();

    $this->postJson("/api/groups/{$group}/members/{$this->adam}/undo")->assertOk()->assertJsonPath('credited_minor', 10000);
    expect(dsDue($this))->toBe(['due' => 0, 'credit' => 10000])
        ->and(dsTenant($this->academy, fn () => DB::table('invoice_line_items')->where('class_group_id', $group)->count()))->toBe(0);
});

it('refuses to delete a subscription whose joining month sits on a closed bill — end it instead', function () {
    $group = dsJoin($this, '2026-05-11');
    dsTenant($this->academy, function () {
        $may = DB::table('invoices')->where('guardian_id', $this->parent)->where('period_month', 5)->value('id');
        app(Invoicing::class)->closeInvoice((string) $may, $this->academy, (string) $this->owner->id, 'ACADEMY_OWNER');
    });

    $this->postJson("/api/groups/{$group}/members/{$this->adam}/undo")->assertStatus(422);
    expect(dsTenant($this->academy, fn () => DB::table('class_group_members')->where('group_id', $group)->count()))->toBe(1);
});

it('voids an unused private subscription’s bill on delete even once its month closed — a centre’s only', function () {
    $open = fn () => $this->postJson('/api/packages', [
        'student_id' => $this->adam, 'label' => 'English', 'hours' => 8, 'price_minor' => 160000, 'currency' => 'EGP', 'starts_on' => '2026-05-20',
    ])->assertCreated()->json();
    $closeBill = fn (string $invoiceId) => dsTenant($this->academy, fn () => app(Invoicing::class)->closeInvoice($invoiceId, $this->academy, (string) $this->owner->id, 'ACADEMY_OWNER'));

    $pkg = $open();
    $closeBill($pkg['invoice_id']);
    expect(dsDue($this)['due'])->toBe(160000);
    $this->postJson("/api/packages/{$pkg['id']}/cancel")->assertOk();
    expect(dsTenant($this->academy, fn () => DB::table('invoices')->where('id', $pkg['invoice_id'])->value('status')))->toBe('VOID')
        ->and(dsDue($this)['due'])->toBe(0);

    // An academy that is not a centre keeps the rule it always had: only an open bill is voided.
    dsFeatures($this->academy, ['accounting']);
    $other = $open();
    $closeBill($other['invoice_id']);
    $this->postJson("/api/packages/{$other['id']}/cancel")->assertOk();
    expect(dsTenant($this->academy, fn () => DB::table('invoices')->where('id', $other['invoice_id'])->value('status')))->toBe('CLOSED');
});

it('clears, once, the dues deletes left behind before — listing first, a centre only', function () {
    // As deleting used to leave them: the membership gone, its month still billed…
    $group = dsJoin($this, '2026-06-10');
    $line = dsTenant($this->academy, fn () => DB::table('invoice_line_items')->where('class_group_id', $group)->first());
    dsTenant($this->academy, function () use ($group) {
        DB::table('class_group_members')->where('group_id', $group)->delete();
        Audit::log('class_group.member_undone', 'class_group', $group, $this->academy, null, 'ACADEMY_OWNER', before: ['student_id' => $this->adam]);
    });
    // …and a subscription cancelled unused with its closed bill still owed.
    $pkg = $this->postJson('/api/packages', ['student_id' => $this->adam, 'label' => 'English', 'hours' => 8, 'price_minor' => 160000, 'currency' => 'EGP', 'starts_on' => '2026-05-20'])
        ->assertCreated()->json();
    dsTenant($this->academy, function () use ($pkg) {
        app(Invoicing::class)->closeInvoice($pkg['invoice_id'], $this->academy, (string) $this->owner->id, 'ACADEMY_OWNER');
        DB::table('lesson_packages')->where('id', $pkg['id'])->update(['status' => 'CANCELLED', 'closed_at' => now(), 'closed_reason' => 'CANCELLED']);
    });
    $owed = dsDue($this)['due'];
    expect($owed)->toBe(160000 + (int) $line->amount_minor);

    $this->artisan('subscriptions:clear-deleted-dues', ['--academy' => $this->academy])
        ->expectsOutputToContain('Adam · English A1')
        ->expectsOutputToContain('Listed only')
        ->assertSuccessful();
    expect(dsDue($this)['due'])->toBe($owed);

    $this->artisan('subscriptions:clear-deleted-dues', ['--academy' => $this->academy, '--apply' => true])->assertSuccessful();
    expect(dsDue($this)['due'])->toBe(0)
        ->and(dsTenant($this->academy, fn () => DB::table('invoices')->where('id', $pkg['invoice_id'])->value('status')))->toBe('VOID');
});
