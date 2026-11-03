<?php

declare(strict_types=1);

use App\Services\ModuleBilling;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * The parent's page for a CENTRE (docs/centre-profile, Phase 2 §4): on top of the ordinary page,
 * each child's groups with their weekly slots, the sheet history with the child's own mark, the week
 * ahead, and the family's receipts account. Pinned here:
 *   - every block is keyed on a switch (`groups`, `accounting`), never on the profile;
 *   - an academy holding neither gets the page it always had — the same keys, nothing more;
 *   - a child's lessons are their groups' lessons on the dates they were in; nobody else's show.
 */
beforeEach(function () {
    // Wednesday 17 June 2026, 12:00 Cairo.
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['name' => 'Lingo Centre', 'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'invoice_grouping' => 'PER_GUARDIAN']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-centre-portal@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona']);

    $this->parent = $this->createGuardian($this->academy, ['full_name' => 'Umm Adam', 'whatsapp_phone' => '+201001112223']);
    $this->adam = $this->createStudent($this->academy, $this->parent, ['full_name' => 'Adam']);
    $this->sara = $this->createStudent($this->academy, $this->parent, ['full_name' => 'Sara']);

    $this->otherParent = $this->createGuardian($this->academy, ['full_name' => 'Other Family']);
    $this->dina = $this->createStudent($this->academy, $this->otherParent, ['full_name' => 'Dina']);
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

/** The centre's switches: `centre` + `accounting` are opt-in, `groups` is on for every client. */
function centrePortalSwitchOn(string $academyId): void
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    try {
        DB::table('module_subscriptions')->where('academy_id', $academyId)->where('module', 'MANAGEMENT')
            ->update(['overrides' => json_encode(['enabled' => ['centre', 'accounting']])]);
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

/** Write under the academy's own tenant context from a global helper (the trait's helpers are protected). */
function centrePortalAs(string $academyId, callable $fn): mixed
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

function centrePortalToken($test): string
{
    Sanctum::actingAs($test->owner);
    $url = $test->postJson("/api/guardians/{$test->parent}/portal")->assertOk()->json('url');
    foreach (['app.current_academy_id', 'app.current_role', 'app.current_user_id'] as $guc) {
        DB::statement('select set_config(?, \'\', true)', [$guc]);
    }

    return substr((string) $url, strrpos((string) $url, '/p/') + 3);
}

function centrePortalPage($test, string $token)
{
    foreach (['app.current_academy_id', 'app.current_role', 'app.current_user_id'] as $guc) {
        DB::statement('select set_config(?, \'\', true)', [$guc]);
    }

    return $test->getJson("/api/p/{$token}");
}

/** A group on Mondays and Wednesdays at 17:00 Cairo with the given members (student id → joined_on). */
function centrePortalGroup($test, string $name, array $members, array $over = []): string
{
    $id = (string) Str::uuid();
    centrePortalAs($test->academy, function () use ($test, $id, $name, $members, $over): void {
        DB::table('class_groups')->insert(array_merge(['id' => $id, 'academy_id' => $test->academy, 'name' => $name, 'level' => 'A1',
            'teacher_id' => $test->teacher, 'timezone' => 'Africa/Cairo', 'start_date' => '2026-05-01'], $over));
        foreach ([[1, '17:00:00'], [3, '17:00:00']] as [$weekday, $at]) {
            DB::table('class_group_slots')->insert(['id' => (string) Str::uuid(), 'academy_id' => $test->academy, 'group_id' => $id,
                'weekday' => $weekday, 'start_time_local' => $at, 'duration_minutes' => 60]);
        }
        foreach ($members as $studentId => $joinedOn) {
            DB::table('class_group_members')->insert(['id' => (string) Str::uuid(), 'academy_id' => $test->academy, 'group_id' => $id,
                'student_id' => $studentId, 'joined_on' => $joinedOn]);
        }
    });

    return $id;
}

/** One lesson of the group; `$marks` = student id → sheet status. */
function centrePortalLesson($test, string $groupId, string $date, string $status, array $marks = [], array $extra = []): string
{
    $id = (string) Str::uuid();
    centrePortalAs($test->academy, function () use ($test, $id, $groupId, $date, $status, $marks, $extra): void {
        DB::table('class_group_lessons')->insert(array_merge(['id' => $id, 'academy_id' => $test->academy, 'group_id' => $groupId,
            'teacher_id' => $test->teacher, 'occurrence_local_date' => $date, 'scheduled_at_utc' => $date.' 15:00:00+00',
            'duration_minutes' => 60, 'status' => $status], $extra));
        foreach ($marks as $studentId => $mark) {
            DB::table('class_group_attendance')->insert(['id' => (string) Str::uuid(), 'academy_id' => $test->academy, 'lesson_id' => $id,
                'group_id' => $groupId, 'student_id' => $studentId, 'status' => $mark, 'note' => 'Staff-only note']);
        }
    });

    return $id;
}

it('shows a centre family each child’s groups, timetable, sheets and the week ahead — theirs only', function () {
    centrePortalSwitchOn($this->academy);

    $english = centrePortalGroup($this, 'English A1', [$this->adam => '2026-06-01']);
    $maths = centrePortalGroup($this, 'Maths Juniors', [$this->sara => '2026-06-10']);
    $theirs = centrePortalGroup($this, 'Dina Only Group', [$this->dina => '2026-05-01']);

    // Adam: one before he joined, three sheets (present, absent with a topic, late), one this week,
    // one beyond the week. Sara: one sheet nobody marked her on. Dina: her own group's lessons.
    $beforeAdam = centrePortalLesson($this, $english, '2026-05-27', 'HELD', [$this->adam => 'PRESENT']);
    $present = centrePortalLesson($this, $english, '2026-06-01', 'HELD', [$this->adam => 'LATE']);
    $absent = centrePortalLesson($this, $english, '2026-06-10', 'HELD', [$this->adam => 'ABSENT'], ['topic' => 'Past simple', 'homework' => 'Page 12', 'notes' => 'Staff-only remark']);
    $late = centrePortalLesson($this, $english, '2026-06-15', 'HELD', [$this->adam => 'PRESENT']);
    $cancelled = centrePortalLesson($this, $english, '2026-06-08', 'CANCELLED');
    $thisWeek = centrePortalLesson($this, $english, '2026-06-22', 'SCHEDULED');
    $nextWeek = centrePortalLesson($this, $english, '2026-06-29', 'SCHEDULED');
    $saraUnmarked = centrePortalLesson($this, $maths, '2026-06-15', 'HELD');
    $saraSoon = centrePortalLesson($this, $maths, '2026-06-17', 'SCHEDULED');
    $dinas = centrePortalLesson($this, $theirs, '2026-06-18', 'SCHEDULED');
    centrePortalLesson($this, $theirs, '2026-06-15', 'HELD', [$this->dina => 'ABSENT']);

    $res = centrePortalPage($this, centrePortalToken($this))->assertOk();

    // Adam's card: the group with its slots, newest sheets first with his own mark, the week ahead.
    $adam = collect($res->json('children'))->firstWhere('id', $this->adam);
    expect($adam['groups'])->toHaveCount(1);
    expect($adam['groups'][0])->toMatchArray(['id' => $english, 'name' => 'English A1', 'level' => 'A1', 'teacher_name' => 'Miss Mona', 'teacher' => 'Miss Mona', 'joined_on' => '2026-06-01']);
    expect($adam['groups'][0]['slots'])->toBe([
        ['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60],
        ['weekday' => 3, 'start_time_local' => '17:00', 'duration_minutes' => 60],
    ]);

    expect(collect($adam['group_lessons']['upcoming'])->pluck('id')->all())->toBe([$thisWeek]);
    expect($adam['group_lessons']['upcoming'][0])->toMatchArray(['group_name' => 'English A1', 'starts_at' => '2026-06-22T15:00:00+00:00', 'duration_minutes' => 60, 'status' => 'SCHEDULED']);

    $recent = collect($adam['group_lessons']['recent']);
    expect($recent->pluck('id')->all())->toBe([$late, $absent, $present]);
    expect($recent->pluck('id')->all())->not->toContain($beforeAdam, $cancelled, $nextWeek, $saraUnmarked, $dinas);
    expect($recent[1])->toMatchArray(['attendance' => 'ABSENT', 'topic' => 'Past simple', 'homework' => 'Page 12']);
    expect($recent[0])->toMatchArray(['attendance' => 'PRESENT', 'topic' => null, 'homework' => null]);
    expect($adam['attendance_summary'])->toBe(['present' => 1, 'late' => 1, 'absent' => 1, 'excused' => 0, 'rate' => 67]);

    // Sara: the sheet that skipped her reads as no mark, and no rate yet.
    $sara = collect($res->json('children'))->firstWhere('id', $this->sara);
    expect($sara['groups'][0]['name'])->toBe('Maths Juniors');
    expect(collect($sara['group_lessons']['upcoming'])->pluck('id')->all())->toBe([$saraSoon]);
    expect($sara['group_lessons']['recent'])->toHaveCount(1)->and($sara['group_lessons']['recent'][0]['attendance'])->toBeNull();
    expect($sara['attendance_summary'])->toBe(['present' => 0, 'late' => 0, 'absent' => 0, 'excused' => 0, 'rate' => null]);

    // Nothing of the other family's, and nothing the staff wrote for themselves.
    $body = $res->getContent();
    foreach (['Dina', 'Dina Only Group', 'Other Family', 'Staff-only', $dinas] as $needle) {
        expect($body)->not->toContain($needle);
    }
});

it('shows the family where it stands on the receipts ledger', function () {
    centrePortalSwitchOn($this->academy);

    // May, closed: 500 charged, 200 received → 300 overdue. June, running: 400 charged, nothing yet.
    // One more receipt of 100 sits unallocated: the family's credit.
    // A closed bill refuses new lines (a trigger), so May is written open and closed after.
    [$may] = $this->createInvoice($this->academy, $this->parent, ['period_month' => 5, 'status' => 'OPEN', 'total_minor' => 50000, 'subtotal_minor' => 50000, 'amount_paid_minor' => 20000]);
    [$june] = $this->createInvoice($this->academy, $this->parent, ['period_month' => 6, 'status' => 'OPEN', 'total_minor' => 40000, 'subtotal_minor' => 40000]);
    $this->asAcademy($this->academy);
    $mayLine = (string) Str::uuid();
    DB::table('invoice_line_items')->insert(['id' => $mayLine, 'academy_id' => $this->academy, 'invoice_id' => $may,
        'student_id' => $this->adam, 'description' => 'English A1 — May', 'amount_minor' => 50000, 'currency' => 'EGP']);
    DB::table('invoice_line_items')->insert(['id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'invoice_id' => $june,
        'student_id' => $this->adam, 'description' => 'English A1 — June', 'amount_minor' => 40000, 'currency' => 'EGP']);
    DB::table('invoices')->where('id', $may)->update(['status' => 'CLOSED']);
    $receipt = fn (string $number, string $on, int $amount): string => tap((string) Str::uuid(), fn ($id) => DB::table('receipts')->insert([
        'id' => $id, 'academy_id' => $this->academy, 'number' => $number, 'guardian_id' => $this->parent, 'amount_minor' => $amount,
        'currency' => 'EGP', 'method' => 'INSTAPAY', 'received_on' => $on, 'public_token' => Str::random(40),
    ]));
    $paid = $receipt('R-000001', '2026-05-10', 20000);
    DB::table('receipt_allocations')->insert(['id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'receipt_id' => $paid,
        'invoice_line_id' => $mayLine, 'invoice_id' => $may, 'amount_minor' => 20000]);
    $receipt('R-000002', '2026-06-05', 10000);
    // A voided one and another family's never show.
    DB::table('receipts')->insert(['id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'number' => 'R-000003', 'guardian_id' => $this->parent,
        'amount_minor' => 99900, 'currency' => 'EGP', 'method' => 'CASH', 'received_on' => '2026-06-06', 'public_token' => Str::random(40), 'voided_at' => now(), 'void_reason' => 'typed twice']);
    DB::table('receipts')->insert(['id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'number' => 'R-000004', 'guardian_id' => $this->otherParent,
        'amount_minor' => 77700, 'currency' => 'EGP', 'method' => 'CASH', 'received_on' => '2026-06-07', 'public_token' => Str::random(40)]);
    $this->clearTenantContext();

    $res = centrePortalPage($this, centrePortalToken($this))->assertOk();

    $account = $res->json('family_account');
    expect($account)->toMatchArray(['currency' => 'EGP', 'due_minor' => 70000, 'overdue_minor' => 30000, 'credit_minor' => 10000, 'pay_url' => null]);
    expect(collect($account['recent_receipts'])->pluck('number')->all())->toBe(['R-000002', 'R-000001']);
    expect($account['recent_receipts'][1])->toMatchArray(['received_on' => '2026-05-10', 'amount_minor' => 20000, 'method' => 'INSTAPAY', 'currency' => 'EGP']);
    expect($res->getContent())->not->toContain('R-000003')->not->toContain('R-000004')->not->toContain('99900')->not->toContain('77700');
});

it('offers the card-payment page only when it can take a payment', function () {
    centrePortalSwitchOn($this->academy);
    $this->asAcademy($this->academy);
    DB::table('guardians')->where('id', $this->parent)->update(['pay_token' => str_repeat('p', 48)]);
    $this->clearTenantContext();

    // A pay link exists but the academy takes no cards: no button.
    expect(centrePortalPage($this, centrePortalToken($this))->json('family_account.pay_url'))->toBeNull();

    $this->asAcademy($this->academy);
    DB::table('academy_payment_settings')->insert(['id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'method' => 'XPAY', 'is_active' => true, 'config' => '{}']);
    [$bill] = $this->createInvoice($this->academy, $this->parent, ['period_month' => 6, 'status' => 'OPEN', 'total_minor' => 30000, 'subtotal_minor' => 30000]);
    $this->asAcademy($this->academy);
    DB::table('lesson_packages')->insert(['id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'student_id' => $this->adam, 'invoice_id' => $bill,
        'label' => '8 lessons', 'minutes_total' => 480, 'minutes_consumed' => 0, 'price_minor' => 30000, 'currency' => 'EGP', 'hourly_rate_minor' => 3750,
        'bill_timing' => 'ON_START', 'status' => 'ACTIVE', 'sequence_no' => 1, 'starts_on' => '2026-06-01']);
    $this->clearTenantContext();

    expect(centrePortalPage($this, centrePortalToken($this))->json('family_account.pay_url'))->toEndWith('/f/'.str_repeat('p', 48));
});

it('keeps a Quran family’s page exactly as it was — the same keys, nothing more', function () {
    // A Quran academy: no centre, no accounting, and groups switched off by the Super Admin.
    $this->asAcademy($this->academy, 'SUPER_ADMIN');
    app(ModuleBilling::class)->setDisabledFeatures($this->academy, 'MANAGEMENT', ['groups']);
    $this->clearTenantContext();

    $this->createInvoice($this->academy, $this->parent, ['period_month' => 5, 'status' => 'CLOSED', 'total_minor' => 60000, 'subtotal_minor' => 60000]);

    $res = centrePortalPage($this, centrePortalToken($this))->assertOk();

    expect(array_keys($res->json()))->toBe(['academy', 'guardian', 'children', 'upcoming', 'recent', 'progress_reports', 'invoices', 'balance']);
    expect(array_keys($res->json('children.0')))->toBe(['id', 'name', 'teachers', 'groups', 'packages', 'month', 'next_lesson']);
    expect($res->json('children.0.groups'))->toBe([]);
    expect($res->json('balance'))->toBe([['currency' => 'EGP', 'due_minor' => 60000]]);
});

it('adds the group blocks for a plain groups academy and the account only with receipts', function () {
    // `groups` alone (every client's default): the group blocks come, the ledger card does not.
    centrePortalGroup($this, 'Tajweed Juniors', [$this->sara => '2026-06-10']);

    $res = centrePortalPage($this, centrePortalToken($this))->assertOk();

    expect($res->json())->not->toHaveKey('family_account');
    $sara = collect($res->json('children'))->firstWhere('id', $this->sara);
    expect($sara)->toHaveKeys(['groups', 'group_lessons', 'attendance_summary']);
    // The chip the page already draws still finds its name.
    expect($sara['groups'][0])->toMatchArray(['name' => 'Tajweed Juniors', 'teacher' => 'Miss Mona']);
});
