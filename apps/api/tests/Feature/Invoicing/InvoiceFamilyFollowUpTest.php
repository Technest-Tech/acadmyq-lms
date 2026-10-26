<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

/**
 * Bills read as the family's: a custom bill can go to a guardian (every child under them), the
 * list names the parent even on a bill addressed to one child, with the children beside it — and a
 * hand-made bill still unpaid a day after it was raised is flagged for follow-up (list flag, filter
 * and the sidebar count). A package's own bill is chased by the due-packages page, never here.
 */
uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');

    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'plan_id' => DB::table('plans')->where('code', 'PRO')->value('id'),
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-family-'.uniqid().'@test.local']);
    $this->guardian = $this->createGuardian($this->academy, ['full_name' => 'Hassan Family']);
    $this->yusuf = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Yusuf Hassan']);
    $this->maryam = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Maryam Hassan']);
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

function familyQuickBill(array $payer, int $amount = 5000): string
{
    return test()->postJson('/api/invoices/quick', $payer + [
        'amount_minor' => $amount,
        'currency' => 'EGP',
        'description' => 'Books',
    ])->assertCreated()->json('id');
}

function familyListedRow(string $id, string $query = ''): ?array
{
    $rows = test()->getJson('/api/invoices?filter[kind]=MANUAL'.$query)->assertOk()->json('rows');

    return collect($rows)->firstWhere('id', $id);
}

it('bills a guardian, and the bill names every child under them', function () {
    Sanctum::actingAs($this->owner);

    $id = familyQuickBill(['guardian_id' => $this->guardian]);

    $this->asAcademy($this->academy);
    $inv = DB::table('invoices')->where('id', $id)->first();
    expect((string) $inv->guardian_id)->toBe($this->guardian)
        ->and($inv->student_id)->toBeNull()
        ->and($inv->kind)->toBe('MANUAL');

    $row = familyListedRow($id);
    expect($row['payer_type'])->toBe('GUARDIAN')
        ->and($row['guardian_name'])->toBe('Hassan Family')
        ->and($row['children'])->toBe(['Maryam Hassan', 'Yusuf Hassan'])
        ->and($row['created_at'])->not->toBeNull();

    // A family's bill is found by a child's name too.
    expect(familyListedRow($id, '&search=Maryam'))->not->toBeNull();

    $this->getJson("/api/invoices/{$id}")
        ->assertOk()
        ->assertJsonPath('invoice.guardian_name', 'Hassan Family')
        ->assertJsonPath('invoice.children', ['Maryam Hassan', 'Yusuf Hassan']);
});

it('names the parent on a bill addressed to one child, with that child beside it', function () {
    Sanctum::actingAs($this->owner);

    $id = familyQuickBill(['student_id' => $this->yusuf]);

    $row = familyListedRow($id);
    expect($row['payer_type'])->toBe('STUDENT')
        ->and($row['payer_name'])->toBe('Yusuf Hassan')
        ->and($row['guardian_name'])->toBe('Hassan Family')
        ->and($row['children'])->toBe(['Yusuf Hassan']);
});

it('keeps a hand-typed payer with no family', function () {
    Sanctum::actingAs($this->owner);

    $id = familyQuickBill(['payer_name' => 'Walk-in Visitor']);

    $row = familyListedRow($id);
    expect($row['guardian_name'])->toBeNull()
        ->and($row['payer_name'])->toBe('Walk-in Visitor')
        ->and($row['children'])->toBe([]);
});

it('flags a hand-made bill still unpaid a day after it was raised, until it is paid', function () {
    Sanctum::actingAs($this->owner);

    $id = familyQuickBill(['guardian_id' => $this->guardian]);

    Carbon::setTestNow('2026-06-12 11:00:00'); // 23h on — still within the day
    expect(familyListedRow($id)['needs_follow_up'])->toBeFalse();
    $this->getJson('/api/invoices/follow-up')->assertOk()->assertJson(['count' => 0, 'grace_hours' => 24]);

    Carbon::setTestNow('2026-06-12 13:00:00'); // 25h on
    expect(familyListedRow($id)['needs_follow_up'])->toBeTrue()
        ->and(familyListedRow($id, '&filter[follow_up]=1'))->not->toBeNull();
    $this->getJson('/api/invoices/follow-up')->assertOk()->assertJsonPath('count', 1);
    $this->getJson("/api/invoices/{$id}")->assertOk()->assertJsonPath('invoice.needs_follow_up', true);

    $this->postJson("/api/invoices/{$id}/mark-paid", ['payment_method' => 'CASH'])->assertOk();

    expect(familyListedRow($id)['needs_follow_up'])->toBeFalse()
        ->and(familyListedRow($id, '&filter[follow_up]=1'))->toBeNull();
    $this->getJson('/api/invoices/follow-up')->assertOk()->assertJsonPath('count', 0);
});

it('never flags a package bill — the due-packages page chases those', function () {
    Sanctum::actingAs($this->owner);

    $id = familyQuickBill(['student_id' => $this->yusuf]);
    $this->asAcademy($this->academy);
    DB::table('lesson_packages')->insert([
        'academy_id' => $this->academy,
        'student_id' => $this->yusuf,
        'label' => '8 hours',
        'minutes_total' => 480,
        'price_minor' => 5000,
        'currency' => 'EGP',
        'hourly_rate_minor' => 625,
        'status' => 'COMPLETED',
        'sequence_no' => 1,
        'starts_on' => '2026-06-01',
        'invoice_id' => $id,
    ]);
    $this->clearTenantContext();

    Carbon::setTestNow('2026-06-15 12:00:00');
    expect(familyListedRow($id)['needs_follow_up'])->toBeFalse();
    $this->getJson('/api/invoices/follow-up')->assertOk()->assertJsonPath('count', 0);
});

it('needs invoice.read to see the follow-up count', function () {
    $teacher = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-fu-'.uniqid().'@test.local']);
    $this->clearTenantContext();
    Sanctum::actingAs($teacher);

    $this->getJson('/api/invoices/follow-up')->assertForbidden();
});

it('lists each due package with its family, so the Due page can gather siblings', function () {
    Sanctum::actingAs($this->owner);

    $this->asAcademy($this->academy);
    foreach ([$this->yusuf, $this->maryam] as $student) {
        DB::table('lesson_packages')->insert([
            'academy_id' => $this->academy,
            'student_id' => $student,
            'label' => '8 hours',
            'minutes_total' => 480,
            'minutes_consumed' => 120,
            'price_minor' => 5000,
            'currency' => 'EGP',
            'hourly_rate_minor' => 625,
            'status' => 'COMPLETED',
            'sequence_no' => 1,
            'starts_on' => '2026-06-01',
        ]);
    }
    $this->clearTenantContext();

    $rows = collect($this->getJson('/api/packages?scope=due')->assertOk()->json('packages'));
    expect($rows)->toHaveCount(2)
        ->and($rows->pluck('guardian_id')->unique()->all())->toBe([$this->guardian])
        ->and($rows->pluck('guardian_name')->unique()->all())->toBe(['Hassan Family']);

    // The parent's name finds the family's packages.
    expect($this->getJson('/api/packages?q=Hassan Fam')->assertOk()->json('packages'))->toHaveCount(2);
});
