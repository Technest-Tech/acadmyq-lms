<?php

declare(strict_types=1);

use App\Services\Ledger;
use App\Services\LessonPackages;
use App\Services\ModuleBilling;
use App\Support\MoneyPolicy;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * What must hold once `centre:migrate-packages --apply` has run on a live centre: the old package rows
 * are history, nothing acts on them again, nothing reads a moved block twice, and every reader of
 * the private subscription knows the new table (docs/centre-profile/01-PRIVATE-SUBSCRIPTION-SPLIT.md).
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: [
        'name' => 'Moved Centre', 'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'invoice_grouping' => 'PER_GUARDIAN',
        'plan_id' => DB::table('plans')->where('code', 'PRO')->value('id'),
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-atm@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Ms Sama']);
    $this->guardian = $this->createGuardian($this->academy, ['currency' => 'EGP']);
    $this->malika = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Malika', 'status' => 'REGULAR']);
    $this->hassan = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Hassan', 'status' => 'REGULAR']);
    $this->assignTeacher($this->academy, $this->malika, $this->teacher);
    $this->assignTeacher($this->academy, $this->hassan, $this->teacher);

    // A live centre on receipts, still on the package engine.
    $this->switches = function (array $disabled, array $enabled = ['centre', 'accounting']): void {
        DB::statement("select set_config('app.current_academy_id', ?, true)", [$this->academy]);
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
        app(ModuleBilling::class)->setDisabledFeatures($this->academy, 'MANAGEMENT', $disabled, $enabled);
        $this->clearTenantContext();
    };
    ($this->switches)([]);
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$this->academy]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    app(Ledger::class)->ensureReady($this->academy);
    $this->clearTenantContext();

    $this->open = function (string $student, array $extra = []): array {
        $this->asAcademy($this->academy);
        $opened = app(LessonPackages::class)->open(array_merge([
            'student_id' => $student, 'label' => 'Private English', 'minutes_total' => 240, 'lesson_minutes' => 60,
            'price_minor' => 80000, 'currency' => 'EGP', 'starts_on' => '2026-06-01', 'auto_renew' => false, 'teacher_id' => $this->teacher,
        ], $extra), (string) $this->owner->id, 'ACADEMY_OWNER');
        $this->clearTenantContext();

        return $opened;
    };
    $this->attend = function (string $student, string $at): string {
        $session = $this->createSession($this->academy, $student, $this->teacher, ['scheduled_at_utc' => $at, 'duration_minutes' => 60, 'status' => 'SCHEDULED']);
        Sanctum::actingAs($this->owner);
        $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

        return $session;
    };
    $this->tenant = function (callable $fn) {
        $this->asAcademy($this->academy);
        try {
            return $fn();
        } finally {
            $this->clearTenantContext();
        }
    };
    $this->move = fn () => $this->artisan('centre:migrate-packages', ['academy' => 'Moved Centre', '--apply' => true])->assertExitCode(0);
    $this->package = fn (string $id) => ($this->tenant)(fn () => DB::table('lesson_packages')->where('id', $id)->first());
    $this->movedFrom = fn (string $packageId) => ($this->tenant)(fn () => DB::table('centre_subscriptions')->where('legacy_package_id', $packageId)->first());
});

it('ends the old engine in the same step: nothing changes on a dry run, and on --apply the row is history and lessons count on the subscription', function () {
    $opened = ($this->open)($this->malika, ['auto_renew' => true, 'expires_on' => '2026-08-01']);
    ($this->attend)($this->malika, '2026-06-02 10:00:00+00');

    $this->artisan('centre:migrate-packages', ['academy' => 'Moved Centre', '--dry-run' => true])
        ->expectsOutputToContain('A subscription has no expiry date')
        ->assertExitCode(0);
    expect(($this->package)($opened['package_id'])->status)->toBe('ACTIVE')
        ->and(($this->tenant)(fn () => MoneyPolicy::usesSubscriptions($this->academy)))->toBeFalse();

    ($this->move)();

    $old = ($this->package)($opened['package_id']);
    expect($old->status)->toBe('COMPLETED')
        ->and($old->closed_reason)->toBe('MOVED_TO_SUBSCRIPTION')
        ->and((bool) $old->auto_renew)->toBeFalse()
        ->and(($this->tenant)(fn () => MoneyPolicy::usesSubscriptions($this->academy)))->toBeTrue();
    // What the row was is kept, for whoever has to look back.
    $audit = ($this->tenant)(fn () => DB::table('audit_log')->where('action', 'lesson_package.moved')->where('entity_id', $opened['package_id'])->first());
    expect($audit)->not->toBeNull();

    $sub = ($this->movedFrom)($opened['package_id']);
    ($this->attend)($this->malika, '2026-06-05 10:00:00+00');
    expect(($this->tenant)(fn () => DB::table('centre_subscription_lessons')->where('subscription_id', $sub->id)->count()))->toBe(2)
        ->and((int) ($this->package)($opened['package_id'])->minutes_consumed)->toBe(60);

    // A second run moves nothing and changes nothing.
    $this->artisan('centre:migrate-packages', ['academy' => 'Moved Centre', '--apply' => true])
        ->expectsOutputToContain('Packages mapped: 0 (skipped, already moved: 1)')->assertExitCode(0);
});

it('refuses to sell a subscription while the centre still counts on packages, and sells once it has moved', function () {
    Sanctum::actingAs($this->owner);
    $sale = ['student_id' => $this->malika, 'teacher_id' => $this->teacher, 'lessons_sold' => 4, 'lesson_minutes' => 60, 'lesson_price_minor' => 20000, 'currency' => 'EGP', 'starts_on' => '2026-06-01'];

    $this->postJson('/api/subscriptions', $sale)->assertStatus(422)->assertJsonValidationErrors('subscription');
    expect(($this->tenant)(fn () => DB::table('centre_subscriptions')->count()))->toBe(0);

    ($this->move)();
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/subscriptions', $sale)->assertCreated();
});

it('lists a moved bill once on the family pay page, through a link the centre can still make', function () {
    ($this->open)($this->malika);
    ($this->move)();

    Sanctum::actingAs($this->owner);
    $url = $this->postJson("/api/subscriptions/family/{$this->guardian}/pay-link")->assertOk()->json('url');
    $page = $this->getJson('/api/f/'.Str::afterLast($url, '/'))->assertOk();

    expect($page->json('items'))->toHaveCount(1)
        ->and($page->json('items.0.kind'))->toBe('SUBSCRIPTION')
        ->and($page->json('totals.0.amount_minor'))->toBe(80000);
});

it('lists a settlement waiting on a moved block once on the family card', function () {
    $opened = ($this->open)($this->malika);
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/receipts', ['guardian_id' => $this->guardian, 'amount_minor' => 80000, 'currency' => 'EGP', 'method' => 'CASH'])->assertCreated();
    ($this->attend)($this->malika, '2026-06-02 10:00:00+00');
    $this->postJson("/api/packages/{$opened['package_id']}/close")->assertOk();
    expect(($this->package)($opened['package_id'])->settlement)->toBe('PENDING');

    ($this->move)();

    Sanctum::actingAs($this->owner);
    $unsettled = $this->getJson("/api/accounting/family/{$this->guardian}")->assertOk()->json('unsettled');
    expect($unsettled)->toHaveCount(1)
        ->and($unsettled[0]['kind'])->toBe('SUBSCRIPTION')
        ->and(($this->package)($opened['package_id'])->settlement)->toBeNull();
});

it('opens no old block and raises no bill when a receipt lands on a family with a renewal held at the move', function () {
    $opened = ($this->open)($this->malika);
    ($this->tenant)(fn () => DB::table('lesson_packages')->where('id', $opened['package_id'])->update([
        'status' => 'COMPLETED', 'closed_at' => now(), 'closed_reason' => 'EXHAUSTED', 'auto_renew' => true, 'renewal_held_at' => now(),
    ]));

    ($this->move)();
    $bills = ($this->tenant)(fn () => DB::table('invoices')->count());

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/receipts', ['guardian_id' => $this->guardian, 'amount_minor' => 80000, 'currency' => 'EGP', 'method' => 'CASH'])->assertCreated();

    expect(($this->tenant)(fn () => DB::table('lesson_packages')->count()))->toBe(1)
        ->and(($this->tenant)(fn () => DB::table('invoices')->count()))->toBe($bills)
        ->and(($this->package)($opened['package_id'])->renewal_held_at)->toBeNull();
});

it('ends the moved subscription with its charge, leaving no open block on a voided bill', function () {
    $opened = ($this->open)($this->malika);
    ($this->move)();
    $sub = ($this->movedFrom)($opened['package_id']);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/accounting/family/{$this->guardian}/charges/{$sub->invoice_line_id}/cancel")->assertOk();

    expect(($this->tenant)(fn () => DB::table('centre_subscriptions')->where('id', $sub->id)->value('status')))->toBe('CANCELLED')
        ->and(($this->tenant)(fn () => DB::table('invoices')->where('id', $sub->invoice_id)->value('status')))->toBe('VOID');
});

it('stops a leaving student\'s open subscriptions: voided if untouched, closed where it stands if a lesson was counted', function () {
    $taught = ($this->open)($this->malika);
    $untouched = ($this->open)($this->hassan);
    ($this->attend)($this->malika, '2026-06-02 10:00:00+00');
    ($this->move)();

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/students/{$this->malika}")->assertSuccessful();
    $this->deleteJson("/api/students/{$this->hassan}")->assertSuccessful();

    $status = fn (array $opened) => ($this->movedFrom)($opened['package_id'])->status;
    expect($status($taught))->toBe('CLOSED')
        ->and(($this->movedFrom)($taught['package_id'])->closed_reason)->toBe('STUDENT_REMOVED')
        ->and($status($untouched))->toBe('CANCELLED');
});

it('offers an open block in the discount picker, and a discount reaches a block sold after the move', function () {
    ($this->move)();
    Sanctum::actingAs($this->owner);
    $id = $this->postJson('/api/subscriptions', [
        'student_id' => $this->malika, 'teacher_id' => $this->teacher, 'course' => 'English', 'lessons_sold' => 4, 'lesson_minutes' => 60,
        'lesson_price_minor' => 20000, 'currency' => 'EGP', 'starts_on' => '2026-06-01',
    ])->assertCreated()->json('subscription.id');

    $children = collect($this->getJson("/api/accounting/family/{$this->guardian}")->assertOk()->json('children'))->keyBy('id');
    expect(collect($children[$this->malika]['private_subscriptions'])->pluck('teacher_id')->filter()->values()->all())->toBe([$this->teacher]);

    $this->postJson("/api/accounting/family/{$this->guardian}/discounts", [
        'kind' => 'PERCENT', 'value' => 10, 'label' => 'Sibling', 'apply_to_existing' => true,
    ])->assertCreated();

    $line = ($this->tenant)(fn () => DB::table('invoice_line_items')->where('id', DB::table('centre_subscriptions')->where('id', $id)->value('invoice_line_id'))->first());
    expect((int) $line->amount_minor)->toBe(72000)->and((int) $line->discount_minor)->toBe(8000);
});

it('keeps a subscription\'s bill off the forgotten-bills follow-up', function () {
    ($this->move)();
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/subscriptions', [
        'student_id' => $this->malika, 'teacher_id' => $this->teacher, 'lessons_sold' => 4, 'lesson_minutes' => 60, 'lesson_price_minor' => 20000, 'currency' => 'EGP', 'starts_on' => '2026-06-01',
    ])->assertCreated();

    Carbon::setTestNow('2026-06-15 12:00:00');
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/invoices/follow-up')->assertOk()->assertJsonPath('count', 0);
});

it('lets a moved lesson be undone and corrected: its old credit row blocks nothing', function () {
    // Sold in hours, so the old rule would call the closed block a blocker on a length correction.
    $opened = ($this->open)($this->malika, ['lesson_minutes' => null]);
    $session = ($this->attend)($this->malika, '2026-06-02 10:00:00+00');
    ($this->move)();
    $sub = ($this->movedFrom)($opened['package_id']);

    Sanctum::actingAs($this->owner);
    $preview = $this->getJson("/api/sessions/{$session}/duration-preview?duration_minutes=45")->assertOk();
    expect($preview->json('blockers') ?? [])->not->toContain('PACKAGE_CLOSED');

    $this->postJson("/api/sessions/{$session}/attendance/revert", ['reason' => 'Wrong day'])->assertOk();
    expect(($this->tenant)(fn () => DB::table('centre_subscription_lessons')->where('subscription_id', $sub->id)->count()))->toBe(0);
});

it('takes a moved block\'s bill along when a child moves to another family', function () {
    $opened = ($this->open)($this->malika);
    ($this->move)();
    $sub = ($this->movedFrom)($opened['package_id']);
    $other = $this->createGuardian($this->academy, ['currency' => 'EGP', 'full_name' => 'Other family']);

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/students/{$this->malika}", ['guardian_id' => $other])->assertOk();

    [$row, $line] = ($this->tenant)(fn () => [
        DB::table('centre_subscriptions')->where('id', $sub->id)->first(),
        DB::table('invoice_line_items')->where('id', $sub->invoice_line_id)->first(),
    ]);
    expect((string) $row->invoice_id)->toBe((string) $line->invoice_id)
        ->and(($this->tenant)(fn () => (string) DB::table('invoices')->where('id', $line->invoice_id)->value('guardian_id')))->toBe($other);
});

it('stops counting old package alerts on the bell once the centre has moved', function () {
    $opened = ($this->open)($this->malika);
    ($this->tenant)(fn () => DB::table('notifications')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'type' => 'PACKAGE_LOW', 'category' => 'PACKAGES',
        'audience_role' => 'ACADEMY_OWNER', 'subject_id' => $opened['package_id'], 'data' => '{}',
    ]));
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/notifications/summary')->assertOk()->assertJsonPath('packages', 1);

    ($this->move)();
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/notifications/summary')->assertOk()->assertJsonPath('packages', 0);
});

it('knows an open block\'s subject on the timetable', function () {
    $opened = ($this->open)($this->malika, ['course' => 'English']);
    ($this->tenant)(fn () => $this->createSchedule($this->academy, $this->malika, $this->teacher));
    ($this->move)();

    Sanctum::actingAs($this->owner);
    $this->getJson("/api/students/{$this->malika}/schedule?teacher_id={$this->teacher}")->assertOk()->assertJsonPath('subjects', ['English']);
    expect(($this->package)($opened['package_id'])->status)->toBe('COMPLETED');
});

it('keeps the Discounts & Awards page for a centre without the rubric; any other academy without the switch stays refused', function () {
    ($this->switches)(['teacher_quality', 'packages']);
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/quality/adjustments')->assertOk();
    $this->getJson('/api/quality/adjustments/summary?year=2026&month=6')->assertOk();
    $this->getJson('/api/quality/settings')->assertOk();
    $this->getJson('/api/quality/rubric')->assertStatus(402);

    ($this->switches)(['teacher_quality'], []);
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/quality/adjustments')->assertStatus(402);
});

it('refuses the same student at the same minute at a centre, and only at a centre', function () {
    $lesson = ['student_id' => $this->malika, 'teacher_id' => $this->teacher, 'scheduled_at_utc' => '2026-06-20T10:00:00Z', 'duration_minutes' => 60];
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/sessions', $lesson)->assertCreated();
    $this->postJson('/api/sessions', $lesson)->assertStatus(422)->assertJsonValidationErrors('scheduled_at_utc');
    // Another minute is another lesson.
    $this->postJson('/api/sessions', ['scheduled_at_utc' => '2026-06-20T12:00:00Z'] + $lesson)->assertCreated();

    ($this->switches)([], []);
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/sessions', $lesson)->assertCreated();
});
