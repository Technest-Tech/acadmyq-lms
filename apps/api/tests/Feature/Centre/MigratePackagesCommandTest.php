<?php

declare(strict_types=1);

use App\Services\Ledger;
use App\Services\LessonPackages;
use App\Services\ModuleBilling;
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
 * `centre:migrate-packages` (docs/centre-profile/01-PRIVATE-SUBSCRIPTION-SPLIT.md, "Data move"): a
 * centre's lesson packages become centre_subscriptions, credits become lessons, and not one unit of
 * money moves — the new row only remembers which bill line is its.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: [
        'name' => 'Lingo Test Centre', 'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo',
        'plan_id' => DB::table('plans')->where('code', 'PRO')->value('id'),
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-mp@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Ms Sama']);
    $this->guardian = $this->createGuardian($this->academy, ['currency' => 'EGP']);
    $this->malika = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Malika', 'status' => 'REGULAR']);
    $this->hassan = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Hassan', 'status' => 'REGULAR']);
    $this->assignTeacher($this->academy, $this->malika, $this->teacher);
    $this->assignTeacher($this->academy, $this->hassan, $this->teacher);

    // A centre on receipts, still on the package engine (the state before the move).
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$this->academy]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    app(ModuleBilling::class)->setDisabledFeatures($this->academy, 'MANAGEMENT', [], ['centre', 'accounting']);
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
        $session = $this->createSession($this->academy, $student, $this->teacher, ['scheduled_at_utc' => $at, 'duration_minutes' => 40, 'status' => 'SCHEDULED']);
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
});

afterEach(fn () => Carbon::setTestNow());

it('moves every package and credit onto the new tables, finds each bill line, and moves no money', function () {
    // Malika: 4 × 60 paid in full, 2 taken. Hassan: 3 × 40 in minutes (an old block), unpaid, used up.
    $malika = ($this->open)($this->malika);
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/receipts', ['guardian_id' => $this->guardian, 'amount_minor' => 80000, 'currency' => 'EGP', 'method' => 'CASH', 'invoice_id' => $malika['invoice_id']])->assertCreated();
    ($this->attend)($this->malika, '2026-06-02 10:00:00+00');
    ($this->attend)($this->malika, '2026-06-04 10:00:00+00');
    $hassan = ($this->open)($this->hassan, ['label' => '2 hours', 'minutes_total' => 120, 'lesson_minutes' => null, 'price_minor' => 30000]);
    foreach (['2026-06-02 12:00:00+00', '2026-06-03 12:00:00+00', '2026-06-04 12:00:00+00'] as $at) {
        ($this->attend)($this->hassan, $at);
    }
    expect(($this->tenant)(fn () => DB::table('lesson_packages')->where('id', $hassan['package_id'])->value('status')))->toBe('COMPLETED');

    $sums = fn () => ($this->tenant)(fn () => [
        (int) DB::table('invoice_line_items')->sum('amount_minor'), (int) DB::table('receipt_allocations')->sum('amount_minor'),
        (int) DB::table('invoices')->count(), (int) DB::table('receipts')->count(), (int) DB::table('payout_line_items')->count(),
    ]);
    $before = $sums();
    expect($before[0])->toBe(110000)->and($before[1])->toBe(80000);

    // Dry run: nothing written.
    $this->artisan('centre:migrate-packages', ['academy' => 'Lingo Test Centre', '--dry-run' => true])->assertExitCode(0);
    expect(($this->tenant)(fn () => DB::table('centre_subscriptions')->count()))->toBe(0);

    $this->artisan('centre:migrate-packages', ['academy' => $this->academy, '--apply' => true])
        ->expectsOutputToContain('Packages mapped: 2')
        ->expectsOutputToContain('Credits mapped: 5')
        ->expectsOutputToContain('Unmapped lines (a bill but no line found): 0')
        ->assertExitCode(0);

    expect($sums())->toBe($before);
    $rows = ($this->tenant)(fn () => DB::table('centre_subscriptions')->orderBy('sequence_no')->get()->keyBy('legacy_package_id'));
    $m = $rows[$malika['package_id']];
    expect((int) $m->lessons_sold)->toBe(4)->and((int) $m->lesson_minutes)->toBe(60)->and((int) $m->price_minor)->toBe(80000)->and((int) $m->lesson_price_minor)->toBe(20000)
        ->and($m->status)->toBe('OPEN')->and($m->teacher_id)->toBe($this->teacher)->and($m->invoice_id)->toBe($malika['invoice_id'])
        ->and($m->invoice_line_id)->toBe(($this->tenant)(fn () => DB::table('invoice_line_items')->where('invoice_id', $malika['invoice_id'])->value('id')))
        ->and((string) $m->starts_on)->toBe('2026-06-01')->and((int) $m->sequence_no)->toBe(1);
    $h = $rows[$hassan['package_id']];
    expect((int) $h->lessons_sold)->toBe(3)->and((int) $h->lesson_minutes)->toBe(40)->and($h->status)->toBe('FINISHED')->and((int) $h->price_minor)->toBe(30000)
        ->and($h->invoice_line_id)->not->toBeNull();
    $lessons = ($this->tenant)(fn () => DB::table('centre_subscription_lessons')->get());
    expect($lessons)->toHaveCount(5)
        ->and($lessons->where('subscription_id', $m->id)->count())->toBe(2)
        ->and($lessons->where('subscription_id', $h->id)->count())->toBe(3)
        ->and($lessons->pluck('session_id')->unique()->count())->toBe(5)
        ->and((string) $lessons->where('subscription_id', $m->id)->sortBy('lesson_on')->first()->lesson_on)->toBe('2026-06-02');

    // Run again: nothing is moved twice.
    $this->artisan('centre:migrate-packages', ['academy' => $this->academy, '--apply' => true])
        ->expectsOutputToContain('Packages mapped: 0 (skipped, already moved: 2)')->assertExitCode(0);
    expect(($this->tenant)(fn () => DB::table('centre_subscriptions')->count()))->toBe(2)->and($sums())->toBe($before);

    // The moved rows read as subscriptions once the preset flips packages off.
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$this->academy]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    app(ModuleBilling::class)->setDisabledFeatures($this->academy, 'MANAGEMENT', ['packages'], ['centre', 'accounting']);
    $this->clearTenantContext();
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/subscriptions/summary')->assertOk()->assertJsonPath('open', 1)->assertJsonPath('finished_unrenewed', 1)->assertJsonPath('due_count', 1);
    $this->getJson("/api/subscriptions/{$m->id}")->assertOk()->assertJsonPath('subscription.lessons_used', 2)->assertJsonPath('subscription.invoice_paid_minor', 80000)->assertJsonPath('lessons.1.number', 2);
    // And the next lesson counts on the moved block.
    ($this->attend)($this->malika, '2026-06-05 10:00:00+00');
    expect(($this->tenant)(fn () => DB::table('centre_subscription_lessons')->where('subscription_id', $m->id)->count()))->toBe(3)
        ->and(($this->tenant)(fn () => (int) DB::table('lesson_packages')->where('id', $malika['package_id'])->value('minutes_consumed')))->toBe(120);
});

it('refuses an academy that is not a centre, and an unknown name', function () {
    $quran = $this->createAcademy(overrides: ['name' => 'Quran Test Academy']);
    $this->clearTenantContext();
    $this->artisan('centre:migrate-packages', ['academy' => $quran, '--apply' => true])->assertExitCode(1);
    $this->artisan('centre:migrate-packages', ['academy' => 'Nobody'])->assertExitCode(1);
    expect(($this->tenant)(fn () => DB::table('centre_subscriptions')->count()))->toBe(0);
});
