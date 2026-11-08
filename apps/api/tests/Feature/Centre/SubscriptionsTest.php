<?php

declare(strict_types=1);

use App\Services\Ledger;
use App\Services\LessonPackages;
use App\Services\ModuleBilling;
use App\Services\Whatsapp\GroupAlerts;
use App\Support\MoneyPolicy;
use Carbon\CarbonImmutable;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * The centre's private subscription off the package engine (docs/centre-profile/01-PRIVATE-SUBSCRIPTION-SPLIT.md):
 * a block of N lessons for one subject, one bill line, money that moves only when the desk acts,
 * lessons beyond the block flagged and taken by the next block sold.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'invoice_grouping' => 'PER_GUARDIAN',
        'plan_id' => DB::table('plans')->where('code', 'PRO')->value('id'),
    ], modules: ['MANAGEMENT', 'WHATSAPP']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-cs@test.local', 'full_name' => 'Nour Office']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Ms Sama']);
    $this->other = $this->createTeacher($this->academy, ['full_name' => 'Mr Adel']);
    $this->guardian = $this->createGuardian($this->academy, ['full_name' => 'Umm Hassan', 'currency' => 'EGP', 'whatsapp_phone' => '+201000000001']);
    $this->hassan = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Hassan', 'status' => 'REGULAR']);
    $this->assignTeacher($this->academy, $this->hassan, $this->teacher);
    $this->asAcademy($this->academy);
    DB::table('student_teacher_assignments')->where('student_id', $this->hassan)->update(['course' => 'English']);
    $this->clearTenantContext();

    csCentreOn($this->academy);

    /** Sell a block for Hassan with Ms Sama: 8 lessons × 100 EGP from 1 June. */
    $this->sell = function (array $extra = []) {
        Sanctum::actingAs($this->owner);

        return $this->postJson('/api/subscriptions', array_merge([
            'student_id' => $this->hassan, 'teacher_id' => $this->teacher, 'lessons_sold' => 8, 'lesson_price_minor' => 10000,
            'lesson_minutes' => 60, 'starts_on' => '2026-06-01',
        ], $extra));
    };

    /** Pay a bill in full in cash. */
    $this->pay = function (string $invoiceId, int $amount): void {
        Sanctum::actingAs($this->owner);
        $this->postJson('/api/receipts', [
            'guardian_id' => $this->guardian, 'amount_minor' => $amount, 'currency' => 'EGP', 'method' => 'CASH',
            'received_on' => '2026-06-11', 'invoice_id' => $invoiceId,
        ])->assertCreated();
    };

    /** Mark a lesson of Hassan attended; returns the session id. */
    $this->attend = function (string $at, ?string $teacher = null, ?string $student = null): string {
        $session = $this->createSession($this->academy, $student ?? $this->hassan, $teacher ?? $this->teacher, [
            'scheduled_at_utc' => $at, 'duration_minutes' => 60, 'status' => 'SCHEDULED',
        ]);
        Sanctum::actingAs($this->owner);
        $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();

        return $session;
    };

    $this->row = fn (string $table, string $id) => csTenant($this->academy, fn () => DB::table($table)->where('id', $id)->first());
    $this->sub = fn (string $id) => ($this->row)('centre_subscriptions', $id);
    $this->line = function (string $id) {
        $lineId = ($this->sub)($id)->invoice_line_id;

        return csTenant($this->academy, fn () => DB::table('invoice_line_items')->where('id', $lineId)->first());
    };
    /** A second subject with another teacher, beside the first (the helper closes the earlier link). */
    $this->alsoTeaches = function (string $studentId, string $teacherId, ?string $course = null): void {
        $this->asAcademy($this->academy);
        DB::table('student_teacher_assignments')->insert(['id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'student_id' => $studentId, 'teacher_id' => $teacherId, 'course' => $course, 'started_at' => now()]);
        $this->clearTenantContext();
    };
    $this->used = fn (string $id) => (int) csTenant($this->academy, fn () => DB::table('centre_subscription_lessons')->where('subscription_id', $id)->count());
    $this->outside = fn () => (int) csTenant($this->academy, fn () => DB::table('centre_subscription_lessons')->whereNull('subscription_id')->count());
    $this->balance = function (): array {
        Sanctum::actingAs($this->owner);
        $b = $this->getJson("/api/accounting/family/{$this->guardian}")->assertOk()->json('balance.0') ?? [];

        return ['due' => (int) ($b['due_minor'] ?? 0), 'credit' => (int) ($b['credit_minor'] ?? 0)];
    };
});

afterEach(fn () => Carbon::setTestNow());

/** A centre on receipts, off the package engine: the state after the data move (packages OFF). */
function csCentreOn(string $academyId, array $disabled = ['packages'], array $enabled = ['centre', 'accounting']): void
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    try {
        app(ModuleBilling::class)->setDisabledFeatures($academyId, 'MANAGEMENT', $disabled, $enabled);
        app(Ledger::class)->ensureReady($academyId);
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

function csTenant(string $academyId, callable $fn): mixed
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

// ── Sell ─────────────────────────────────────────────────────────────────────

it('sells a block of lessons: one bill line on the family, priced per lesson, no minutes anywhere', function () {
    $res = ($this->sell)()->assertCreated();
    $id = $res->json('subscription.id');
    $res->assertJsonPath('subscription.lessons_sold', 8)
        ->assertJsonPath('subscription.lessons_used', 0)
        ->assertJsonPath('subscription.lessons_left', 8)
        ->assertJsonPath('subscription.price_minor', 80000)
        ->assertJsonPath('subscription.lesson_price_minor', 10000)
        ->assertJsonPath('subscription.currency', 'EGP')
        ->assertJsonPath('subscription.status', 'OPEN')
        ->assertJsonPath('subscription.sequence_no', 1)
        ->assertJsonPath('subscription.course', 'English')
        ->assertJsonPath('subscription.teacher.full_name', 'Ms Sama')
        ->assertJsonPath('subscription.student.guardian_name', 'Umm Hassan')
        ->assertJsonPath('subscription.outstanding_minor', 80000)
        ->assertJsonPath('subscription.deletable', true)
        ->assertJsonPath('due_minor', 80000)
        ->assertJsonPath('warnings', []);

    $sub = ($this->sub)($id);
    expect($sub->label)->toBe('8 حصص — English');
    $invoice = ($this->row)('invoices', $sub->invoice_id);
    expect($invoice->guardian_id)->toBe($this->guardian)->and((int) $invoice->total_minor)->toBe(80000)->and($invoice->status)->toBe('OPEN');
    $line = ($this->line)($id);
    expect($line->invoice_id)->toBe($sub->invoice_id)->and((int) $line->amount_minor)->toBe(80000)
        ->and($line->description)->toBe('اشتراك: 8 حصص — English (English) — 8 حصص')
        ->and($line->student_id)->toBe($this->hassan);

    // One open block per subject.
    ($this->sell)()->assertStatus(422)->assertJsonValidationErrors(['student_id']);
    // Another subject with the other teacher opens alongside.
    ($this->sell)(['teacher_id' => $this->other, 'course' => 'Maths', 'new_subject' => true, 'lessons_sold' => 4])->assertCreated()
        ->assertJsonPath('subscription.course', 'Maths')->assertJsonPath('subscription.price_minor', 40000);
});

// ── Count / finish / outside ─────────────────────────────────────────────────

it('counts a lesson as one lesson whatever it ran, finishes on the last one, and flags the next lesson outside — never an hourly bill', function () {
    $id = ($this->sell)()->assertCreated()->json('subscription.id');

    for ($d = 1; $d <= 8; $d++) {
        ($this->attend)(sprintf('2026-06-%02d 10:00:00+00', $d));
    }
    expect(($this->used)($id))->toBe(8);
    $sub = ($this->sub)($id);
    expect($sub->status)->toBe('FINISHED')->and($sub->finished_at)->not->toBeNull();
    expect(csTenant($this->academy, fn () => DB::table('notifications')->where('type', 'SUBSCRIPTION_FINISHED')->where('subject_id', $id)->exists()))->toBeTrue();

    // The ninth lesson: a 95-minute one still counts one, outside any block — and no AUTO bill opens.
    $ninth = $this->createSession($this->academy, $this->hassan, $this->teacher, ['scheduled_at_utc' => '2026-06-09 10:00:00+00', 'duration_minutes' => 95, 'status' => 'SCHEDULED']);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$ninth}/attendance", ['status' => 'ATTENDED'])->assertOk();
    expect(($this->outside)())->toBe(1)
        ->and(csTenant($this->academy, fn () => DB::table('invoice_line_items')->whereNotNull('session_id')->count()))->toBe(0)
        ->and(csTenant($this->academy, fn () => DB::table('invoices')->where('kind', 'AUTO')->count()))->toBe(0)
        ->and(csTenant($this->academy, fn () => DB::table('notifications')->where('type', 'LESSON_OUTSIDE_SUBSCRIPTION')->where('subject_id', $this->hassan)->exists()))->toBeTrue();

    // The subscriptions page: the block is finished and unrenewed, the student is on the outside tab.
    $this->getJson('/api/subscriptions/summary')->assertOk()
        ->assertJsonPath('open', 0)->assertJsonPath('finished_unrenewed', 1)->assertJsonPath('outside_students', 1)->assertJsonPath('due_count', 1);
    $outside = $this->getJson('/api/subscriptions?view=outside')->assertOk();
    expect($outside->json('rows.0.id'))->toBe($id)->and($outside->json('rows.0.outside_count'))->toBe(1)
        ->and($outside->json('outside.0.count'))->toBe(1)->and($outside->json('outside.0.student.full_name'))->toBe('Hassan');

    // The next block sold starts on the first outside lesson by default and takes it.
    $next = ($this->sell)(['starts_on' => null])->assertCreated();
    $next->assertJsonPath('subscription.starts_on', '2026-06-09')->assertJsonPath('subscription.lessons_used', 1)->assertJsonPath('lessons_taken', 1);
    expect(($this->outside)())->toBe(0)
        ->and(csTenant($this->academy, fn () => DB::table('notifications')->where('type', 'LESSON_OUTSIDE_SUBSCRIPTION')->exists()))->toBeFalse();
    $this->getJson("/api/subscriptions?view=finished")->assertOk()->assertJsonPath('rows.0.renewed', true);
});

it('uncounts a lesson that is undone, and a finished block reopens — money untouched either way', function () {
    $id = ($this->sell)(['lessons_sold' => 2])->assertCreated()->json('subscription.id');
    ($this->pay)(($this->sub)($id)->invoice_id, 20000);
    ($this->attend)('2026-06-01 10:00:00+00');
    $second = ($this->attend)('2026-06-02 10:00:00+00');
    expect(($this->sub)($id)->status)->toBe('FINISHED');

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$second}/attendance/revert")->assertOk()->assertJsonPath('status', 'SCHEDULED');
    expect(($this->used)($id))->toBe(1)
        ->and(($this->sub)($id)->status)->toBe('OPEN')
        ->and((int) ($this->line)($id)->amount_minor)->toBe(20000)
        ->and(($this->balance)())->toBe(['due' => 0, 'credit' => 0]);

    // Undone again after it finished a second time: the same.
    $this->postJson("/api/sessions/{$second}/attendance", ['status' => 'ATTENDED'])->assertOk();
    expect(($this->sub)($id)->status)->toBe('FINISHED');
});

it('numbers a lesson on its block, and a lesson outside any block has no number', function () {
    $id = ($this->sell)(['lessons_sold' => 2])->assertCreated()->json('subscription.id');
    ($this->attend)('2026-06-01 10:00:00+00');
    $second = ($this->attend)('2026-06-02 10:00:00+00');
    $third = ($this->attend)('2026-06-03 10:00:00+00');

    Sanctum::actingAs($this->owner);
    $this->getJson("/api/sessions/{$second}")->assertOk()
        ->assertJsonPath('subscription.id', $id)->assertJsonPath('subscription.number', 2)->assertJsonPath('subscription.lessons_sold', 2);
    $this->getJson("/api/sessions/{$third}")->assertOk()->assertJsonPath('subscription', null);
    $this->getJson("/api/subscriptions/{$id}")->assertOk()
        ->assertJsonPath('lessons.0.number', 1)->assertJsonPath('lessons.1.number', 2)->assertJsonPath('lessons.1.session_id', $second);
});

it('draws each subject\'s lessons from its own block, and an untied block takes any lesson', function () {
    ($this->alsoTeaches)($this->hassan, $this->other, 'Maths');
    $english = ($this->sell)(['lessons_sold' => 2])->assertCreated()->json('subscription.id');
    $maths = ($this->sell)(['teacher_id' => $this->other, 'course' => 'Maths', 'lessons_sold' => 2])->assertCreated()->json('subscription.id');

    ($this->attend)('2026-06-01 10:00:00+00', $this->other);
    ($this->attend)('2026-06-02 10:00:00+00', $this->teacher);
    expect(($this->used)($english))->toBe(1)->and(($this->used)($maths))->toBe(1);

    // A student with one teacher may hold an untied block; one with two must choose.
    ($this->sell)(['teacher_id' => null])->assertStatus(422)->assertJsonValidationErrors(['teacher_id']);
    $nada = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Nada', 'status' => 'REGULAR']);
    $this->assignTeacher($this->academy, $nada, $this->teacher);
    $untied = ($this->sell)(['student_id' => $nada, 'teacher_id' => null, 'lessons_sold' => 3])->assertCreated()->assertJsonPath('subscription.teacher', null)->json('subscription.id');
    ($this->attend)('2026-06-03 10:00:00+00', $this->teacher, $nada);
    expect(($this->used)($untied))->toBe(1);
});

// Lingo 2026-11-05: two things with the same teacher, and the desk choosing which block a lesson counts on.
it('sells a second subject with the same teacher, and the desk moves a lesson between the blocks — no money moves', function () {
    $english = ($this->sell)(['lessons_sold' => 2])->assertCreated()->json('subscription.id');
    $talk = ($this->sell)(['course' => 'Conversation', 'lessons_sold' => 1])->assertCreated()->json('subscription.id');
    ($this->sell)(['course' => 'conversation '])->assertStatus(422)->assertJsonValidationErrors(['student_id']);
    $priceEnglish = (int) ($this->line)($english)->amount_minor;

    // An unnamed lesson goes to the oldest block of the teacher.
    $lesson = ($this->attend)('2026-06-02 10:00:00+00');
    expect(($this->used)($english))->toBe(1)->and(($this->used)($talk))->toBe(0);

    Sanctum::actingAs($this->owner);
    $this->getJson("/api/sessions/{$lesson}")->assertOk()
        ->assertJsonPath('subscription_choices.current', $english)
        ->assertJsonCount(2, 'subscription_choices.options')
        ->assertJsonPath('subscription_choices.options.1.id', $talk)
        ->assertJsonPath('subscription_choices.options.1.available', true);

    // Moved to the other block: it fills (1 of 1) and finishes; English has its seat back.
    $this->postJson("/api/subscriptions/lessons/{$lesson}/move", ['subscription_id' => $talk])->assertOk()
        ->assertJsonPath('subscription.id', $talk)->assertJsonPath('subscription_choices.current', $talk);
    expect(($this->used)($english))->toBe(0)->and(($this->used)($talk))->toBe(1)
        ->and(($this->sub)($talk)->status)->toBe('FINISHED')
        ->and((int) ($this->line)($english)->amount_minor)->toBe($priceEnglish);

    // Back out of it: the finished block reopens. Outside, then into English.
    $this->postJson("/api/subscriptions/lessons/{$lesson}/move", ['subscription_id' => null])->assertOk()->assertJsonPath('subscription', null);
    expect(($this->sub)($talk)->status)->toBe('OPEN')->and(($this->outside)())->toBe(1);
    $this->postJson("/api/subscriptions/lessons/{$lesson}/move", ['subscription_id' => $english])->assertOk();
    expect(($this->used)($english))->toBe(1)->and(($this->outside)())->toBe(0);

    // Refused: a full block, another student's, one starting after the lesson, a lesson not yet attended.
    $other = ($this->attend)('2026-06-03 10:00:00+00');
    $this->postJson("/api/subscriptions/lessons/{$other}/move", ['subscription_id' => $talk])->assertOk();
    $this->postJson("/api/subscriptions/lessons/{$lesson}/move", ['subscription_id' => $talk])->assertStatus(422)->assertJsonValidationErrors(['subscription_id']);
    $nada = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Nada', 'status' => 'REGULAR']);
    $this->assignTeacher($this->academy, $nada, $this->teacher);
    $nadas = ($this->sell)(['student_id' => $nada])->assertCreated()->json('subscription.id');
    $this->postJson("/api/subscriptions/lessons/{$lesson}/move", ['subscription_id' => $nadas])->assertStatus(422)->assertJsonValidationErrors(['subscription_id']);
    $late = ($this->sell)(['course' => 'Grammar', 'starts_on' => '2026-06-10'])->assertCreated()->json('subscription.id');
    $this->postJson("/api/subscriptions/lessons/{$lesson}/move", ['subscription_id' => $late])->assertStatus(422)->assertJsonValidationErrors(['subscription_id']);
    $unmarked = $this->createSession($this->academy, $this->hassan, $this->teacher, ['scheduled_at_utc' => '2026-06-04 10:00:00+00', 'duration_minutes' => 60, 'status' => 'SCHEDULED']);
    $this->postJson("/api/subscriptions/lessons/{$unmarked}/move", ['subscription_id' => $english])->assertStatus(422)->assertJsonValidationErrors(['session']);

    // A teacher reads where it counts but cannot move it.
    $teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'sama-move@test.local']);
    Sanctum::actingAs($teacherUser);
    $this->postJson("/api/subscriptions/lessons/{$lesson}/move", ['subscription_id' => null])->assertForbidden();
});

it('offers no choice on a lesson the centre engine never counted', function () {
    $s = $this->createSession($this->academy, $this->hassan, $this->teacher, ['scheduled_at_utc' => '2026-06-04 10:00:00+00', 'duration_minutes' => 60, 'status' => 'SCHEDULED']);
    Sanctum::actingAs($this->owner);
    $this->getJson("/api/sessions/{$s}")->assertOk()->assertJsonPath('subscription_choices', null);
});

// ── Edit ─────────────────────────────────────────────────────────────────────

it('edits a block in place: dearer leaves the difference due, cheaper gives the excess back as credit, a rename moves no money', function () {
    $id = ($this->sell)()->assertCreated()->json('subscription.id');
    $invoiceId = ($this->sub)($id)->invoice_id;
    ($this->pay)($invoiceId, 80000);
    $lineId = ($this->sub)($id)->invoice_line_id;

    Sanctum::actingAs($this->owner);
    // Rename: same money, new words.
    $this->patchJson("/api/subscriptions/{$id}", ['label' => 'Connect Plus'])->assertOk()
        ->assertJsonPath('credited_minor', 0)->assertJsonPath('due_minor', 0)->assertJsonPath('subscription.label', 'Connect Plus');
    expect(($this->line)($id)->description)->toBe('اشتراك: Connect Plus (English) — 8 حصص')->and((int) ($this->line)($id)->amount_minor)->toBe(80000);

    // A top-up: 8 → 10 lessons, the same line asks 1000 and 200 is due.
    $this->patchJson("/api/subscriptions/{$id}", ['lessons_sold' => 10])->assertOk()
        ->assertJsonPath('subscription.lessons_sold', 10)->assertJsonPath('subscription.price_minor', 100000)->assertJsonPath('due_minor', 20000)->assertJsonPath('credited_minor', 0);
    expect(($this->sub)($id)->invoice_line_id)->toBe($lineId)
        ->and((int) ($this->row)('invoices', $invoiceId)->total_minor)->toBe(100000)
        ->and(($this->balance)())->toBe(['due' => 20000, 'credit' => 0]);

    // Cheaper: 10 lessons at 70 — the 300 paid beyond it is the family's credit.
    $this->patchJson("/api/subscriptions/{$id}", ['lesson_price_minor' => 7000])->assertOk()
        ->assertJsonPath('subscription.price_minor', 70000)->assertJsonPath('credited_minor', 10000)->assertJsonPath('due_minor', 0);
    expect((int) ($this->line)($id)->amount_minor)->toBe(70000)->and(($this->balance)())->toBe(['due' => 0, 'credit' => 10000]);

    // Fewer lessons than counted is refused.
    ($this->attend)('2026-06-01 10:00:00+00');
    ($this->attend)('2026-06-02 10:00:00+00');
    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/subscriptions/{$id}", ['lessons_sold' => 1])->assertStatus(422)->assertJsonValidationErrors(['lessons_sold']);
});

it('moves a block to another subject with its lessons, and a later start date lets the earlier lessons go outside', function () {
    ($this->alsoTeaches)($this->hassan, $this->other, 'Maths');
    $id = ($this->sell)(['lessons_sold' => 4])->assertCreated()->json('subscription.id');
    ($this->attend)('2026-06-01 10:00:00+00');
    ($this->attend)('2026-06-03 10:00:00+00');

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/subscriptions/{$id}", ['starts_on' => '2026-06-02'])->assertOk()
        ->assertJsonPath('moved_lessons', 1)->assertJsonPath('subscription.lessons_used', 1);
    expect(($this->outside)())->toBe(1);
    // Back to the 1st: it takes the lesson again.
    $this->patchJson("/api/subscriptions/{$id}", ['starts_on' => '2026-06-01'])->assertOk()->assertJsonPath('subscription.lessons_used', 2);
    expect(($this->outside)())->toBe(0);

    // Moved to Maths with Mr Adel: its lessons go with it; an outside English lesson is not Maths' to take.
    $this->patchJson("/api/subscriptions/{$id}", ['teacher_id' => $this->other, 'course' => 'Maths'])->assertOk()
        ->assertJsonPath('subscription.teacher.full_name', 'Mr Adel')->assertJsonPath('subscription.course', 'Maths')->assertJsonPath('subscription.lessons_used', 2);
    ($this->attend)('2026-06-04 10:00:00+00', $this->teacher);
    expect(($this->outside)())->toBe(1)->and(($this->used)($id))->toBe(2);
    ($this->attend)('2026-06-05 10:00:00+00', $this->other);
    expect(($this->used)($id))->toBe(3);
});

it('reopens a finished block by selling more lessons, taking the lessons taught after it ran out', function () {
    $id = ($this->sell)(['lessons_sold' => 1])->assertCreated()->json('subscription.id');
    ($this->attend)('2026-06-01 10:00:00+00');
    ($this->attend)('2026-06-02 10:00:00+00');
    expect(($this->sub)($id)->status)->toBe('FINISHED')->and(($this->outside)())->toBe(1);

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/subscriptions/{$id}", ['lessons_sold' => 3])->assertOk()
        ->assertJsonPath('subscription.status', 'OPEN')->assertJsonPath('subscription.lessons_used', 2)->assertJsonPath('subscription.lessons_left', 1)->assertJsonPath('due_minor', 30000);
    expect(($this->outside)())->toBe(0);
});

// ── Close + settle / cancel ──────────────────────────────────────────────────

it('closes early and settles as credit: the line comes down to the lessons had, the rest is the family\'s credit', function () {
    $id = ($this->sell)()->assertCreated()->json('subscription.id');
    ($this->pay)(($this->sub)($id)->invoice_id, 80000);
    foreach ([1, 2, 3] as $d) {
        ($this->attend)(sprintf('2026-06-%02d 10:00:00+00', $d));
    }

    Sanctum::actingAs($this->owner);
    $this->getJson("/api/subscriptions/{$id}/settlement")->assertOk()
        ->assertJsonPath('paid_minor', 80000)->assertJsonPath('used_value_minor', 30000)->assertJsonPath('owed_back_minor', 50000)->assertJsonPath('can_refund', true);

    $this->postJson("/api/subscriptions/{$id}/close", ['reason' => 'Moved away', 'settlement' => 'CREDIT'])->assertOk()
        ->assertJsonPath('subscription.status', 'CLOSED')->assertJsonPath('subscription.closed_reason', 'Moved away')
        ->assertJsonPath('subscription.closed_by_name', 'Nour Office')
        ->assertJsonPath('subscription.settlement', 'CREDIT')->assertJsonPath('subscription.settlement_minor', 50000)
        ->assertJsonPath('settlement.amount_minor', 50000);
    expect((int) ($this->line)($id)->amount_minor)->toBe(30000)
        ->and(($this->line)($id)->description)->toContain('3 حصص used')
        ->and(($this->balance)())->toBe(['due' => 0, 'credit' => 50000]);

    // The credit pays the next block by itself.
    ($this->sell)(['lessons_sold' => 5])->assertCreated()->assertJsonPath('due_minor', 0);
    expect(($this->balance)())->toBe(['due' => 0, 'credit' => 0]);
});

it('pays the unused part back out of the treasury, or keeps it, and a block closed undecided waits on the family card', function () {
    Sanctum::actingAs($this->owner);
    $drawer = $this->postJson('/api/treasury/accounts', ['name' => 'Cash drawer', 'kind' => 'CASH', 'opening_balance_minor' => 50000, 'methods' => ['CASH']])->assertCreated()->json('id');
    $id = ($this->sell)()->assertCreated()->json('subscription.id');
    ($this->pay)(($this->sub)($id)->invoice_id, 80000);
    ($this->attend)('2026-06-01 10:00:00+00');

    // No account named: refused, and the block stays open.
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/subscriptions/{$id}/close", ['reason' => 'Left', 'settlement' => 'REFUND'])->assertStatus(422);
    expect(($this->sub)($id)->status)->toBe('OPEN');

    $res = $this->postJson("/api/subscriptions/{$id}/close", ['reason' => 'Left', 'settlement' => 'REFUND', 'refund' => ['method' => 'CASH', 'reference' => 'slip 12']])->assertOk();
    expect($res->json('settlement.amount_minor'))->toBe(70000)->and($res->json('settlement.expense_number'))->toStartWith('E-')
        ->and(($this->balance)())->toBe(['due' => 0, 'credit' => 0])
        ->and((int) collect($this->getJson('/api/treasury')->json('accounts'))->firstWhere('id', $drawer)['balance_minor'])->toBe(50000 + 80000 - 70000);

    // Kept: recorded, nothing moves.
    $kept = ($this->sell)(['lessons_sold' => 2])->assertCreated()->json('subscription.id');
    ($this->pay)(($this->sub)($kept)->invoice_id, 20000);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/subscriptions/{$kept}/close", ['reason' => 'Gone', 'settlement' => 'KEEP', 'settlement_note' => 'late cancellation'])->assertOk()
        ->assertJsonPath('subscription.settlement', 'KEEP')->assertJsonPath('settlement.amount_minor', 20000);
    expect((int) ($this->line)($kept)->amount_minor)->toBe(20000)->and(($this->balance)())->toBe(['due' => 0, 'credit' => 0])
        ->and(($this->sub)($kept)->settle_note)->toBe('late cancellation');

    // Undecided: PENDING on the family card, settled from there.
    $later = ($this->sell)(['lessons_sold' => 2])->assertCreated()->json('subscription.id');
    ($this->pay)(($this->sub)($later)->invoice_id, 20000);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/subscriptions/{$later}/close", ['reason' => 'Undecided'])->assertOk()->assertJsonPath('subscription.settlement', 'PENDING')->assertJsonPath('settlement', null);
    $waiting = $this->getJson("/api/accounting/family/{$this->guardian}")->assertOk()->json('unsettled');
    expect($waiting)->toHaveCount(1)->and($waiting[0])->toMatchArray(['kind' => 'SUBSCRIPTION', 'subscription_id' => $later, 'id' => $later, 'student_name' => 'Hassan', 'owed_back_minor' => 20000, 'used_minor' => 0, 'paid_minor' => 20000, 'currency' => 'EGP']);
    // The family card settles through the close door: an already closed block, an empty reason, the decision and a note.
    $this->postJson("/api/subscriptions/{$later}/close", ['reason' => '', 'settlement' => 'CREDIT', 'settlement_note' => 'agreed with the father'])->assertOk()
        ->assertJsonPath('settlement.amount_minor', 20000)->assertJsonPath('subscription.settlement', 'CREDIT');
    expect(($this->balance)())->toBe(['due' => 0, 'credit' => 20000])->and(($this->sub)($later)->settle_note)->toBe('agreed with the father');
    $this->postJson("/api/subscriptions/{$later}/close", ['reason' => '', 'settlement' => 'KEEP'])->assertStatus(422);
    // The credit pays the next block by itself, so closing that one unused waits on a decision too;
    // a block nobody paid for owes nothing back: no settlement at all.
    $next = ($this->sell)(['lessons_sold' => 2])->assertCreated()->assertJsonPath('due_minor', 0)->json('subscription.id');
    $this->postJson("/api/subscriptions/{$next}/close", ['reason' => 'Changed mind'])->assertOk()->assertJsonPath('subscription.settlement', 'PENDING');
    $unpaid = ($this->sell)(['lessons_sold' => 2])->assertCreated()->assertJsonPath('due_minor', 20000)->json('subscription.id');
    $this->postJson("/api/subscriptions/{$unpaid}/close", ['reason' => 'Never paid'])->assertOk()->assertJsonPath('subscription.settlement', null);

    // The refund taken back in the treasury: the money is the family's credit again, and the block says so.
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/expenses/'.($this->sub)($id)->settle_expense_id.'/void', ['reason' => 'Not handed over'])->assertOk();
    expect(($this->sub)($id)->settlement)->toBe('CREDIT');
});

it('cancels a block sold by mistake — nothing counted — voids its bill and gives receipts back as credit; otherwise refuses', function () {
    $id = ($this->sell)()->assertCreated()->json('subscription.id');
    $invoiceId = ($this->sub)($id)->invoice_id;
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/subscriptions/{$id}/cancel", ['note' => 'typo'])->assertOk()->assertJsonPath('credited_minor', 0);
    expect(($this->sub)($id)->status)->toBe('CANCELLED')->and(($this->row)('invoices', $invoiceId)->status)->toBe('VOID')
        ->and(($this->balance)())->toBe(['due' => 0, 'credit' => 0]);
    $this->getJson('/api/subscriptions?view=due')->assertOk()->assertJsonPath('meta.total', 0);

    // A lesson counted on it: end it instead.
    $used = ($this->sell)()->assertCreated()->json('subscription.id');
    ($this->attend)('2026-06-01 10:00:00+00');
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/subscriptions/{$used}/cancel")->assertStatus(422);
    $this->postJson("/api/subscriptions/{$used}/close", ['reason' => 'x'])->assertOk();

    // Paid through a receipt (the family paid it with the group fee by mistake): it still goes, as a
    // deleted group subscription does — the bill voids and the money is the family's again.
    $paid = ($this->sell)()->assertCreated()->json('subscription.id');
    $paidInvoice = ($this->sub)($paid)->invoice_id;
    ($this->pay)($paidInvoice, 10000);
    Sanctum::actingAs($this->owner);
    $this->getJson("/api/subscriptions/{$paid}")->assertOk()->assertJsonPath('subscription.deletable', true);
    $before = ($this->balance)();
    $this->postJson("/api/subscriptions/{$paid}/cancel")->assertOk()->assertJsonPath('credited_minor', 10000);
    expect(($this->sub)($paid)->status)->toBe('CANCELLED')
        ->and(($this->row)('invoices', $paidInvoice)->status)->toBe('VOID')
        ->and(($this->row)('invoices', $paidInvoice)->amount_paid_minor)->toBe(0)
        ->and(csTenant($this->academy, fn () => DB::table('receipt_allocations')->where('invoice_id', $paidInvoice)->count()))->toBe(0);
    // The cancelled bill's 80000 is gone from what is due; the 10000 paid toward it now pays the
    // other open block's bill (credit applies itself), so due drops by the whole bill.
    expect(($this->balance)())->toBe(['due' => $before['due'] - 80000 + 10000 - 10000, 'credit' => 0]);

    // Money that came in outside the receipts (a bill marked paid by hand): end and settle instead.
    $hand = ($this->sell)()->assertCreated()->json('subscription.id');
    $handInvoice = ($this->sub)($hand)->invoice_id;
    csTenant($this->academy, fn () => DB::table('invoices')->where('id', $handInvoice)->update(['amount_paid_minor' => 5000]));
    Sanctum::actingAs($this->owner);
    $this->getJson("/api/subscriptions/{$hand}")->assertOk()->assertJsonPath('subscription.deletable', false);
    $this->postJson("/api/subscriptions/{$hand}/cancel")->assertStatus(422);
    expect(($this->sub)($hand)->status)->toBe('OPEN');
});

// ── Pay first ────────────────────────────────────────────────────────────────

it('holds a sale while the last block of the subject is unpaid under pay-first, names the bill, and sells on override with a warning', function () {
    $this->asAcademy($this->academy);
    DB::table('guardians')->where('id', $this->guardian)->update(['renewal_policy' => 'PAY_FIRST']);
    $this->clearTenantContext();
    $first = ($this->sell)(['lessons_sold' => 1])->assertCreated();
    ($this->attend)('2026-06-01 10:00:00+00');

    $refused = ($this->sell)()->assertStatus(422)->assertJsonPath('code', 'PAY_FIRST')->assertJsonPath('pay_first', true);
    expect($refused->json('errors.unpaid_invoice_id.0'))->toBe($first->json('invoice_id'))
        ->and($refused->json('unpaid_invoice_id'))->toBe($first->json('invoice_id'))
        ->and($refused->json('errors.student_id.0'))->toContain('#1')->toContain('100.00 EGP');
    $this->getJson('/api/subscriptions?view=finished')->assertOk()->assertJsonPath('rows.0.renewal_held', true);

    $sold = ($this->sell)(['override_pay_first' => true])->assertCreated();
    expect($sold->json('warnings.0'))->toContain('100.00 EGP');
    expect(csTenant($this->academy, fn () => DB::table('notifications')->where('type', 'SUBSCRIPTION_UNPAID')->where('subject_id', $sold->json('subscription.id'))->exists()))->toBeTrue();

    // Paid: the next sale is free.
    ($this->pay)($first->json('invoice_id'), 10000);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/subscriptions/{$sold->json('subscription.id')}/cancel")->assertOk();
    ($this->sell)()->assertCreated();
});

// ── Views, reminders, notifications, alerts ──────────────────────────────────

it('lists the four views and the summary, and reads the picker', function () {
    $open = ($this->sell)()->assertCreated()->json('subscription.id');
    $nada = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Nada', 'status' => 'REGULAR']);
    $this->assignTeacher($this->academy, $nada, $this->other);
    $finished = ($this->sell)(['student_id' => $nada, 'teacher_id' => $this->other, 'lessons_sold' => 1, 'course' => 'Maths'])->assertCreated()->json('subscription.id');
    ($this->pay)(($this->sub)($finished)->invoice_id, 10000);
    ($this->attend)('2026-06-01 10:00:00+00', $this->other, $nada);
    ($this->attend)('2026-06-02 10:00:00+00', $this->other, $nada);

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/subscriptions?view=open')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('rows.0.id', $open)->assertJsonPath('summary.open', 1);
    $this->getJson('/api/subscriptions?view=due')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('rows.0.id', $open)->assertJsonPath('rows.0.outstanding_minor', 80000);
    $this->getJson('/api/subscriptions?view=finished')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('rows.0.id', $finished)->assertJsonPath('rows.0.outside_count', 1);
    $this->getJson('/api/subscriptions?view=outside')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('outside.0.student.full_name', 'Nada');
    $this->getJson('/api/subscriptions?q=nada')->assertOk()->assertJsonPath('meta.total', 1);
    $this->getJson("/api/subscriptions?student_id={$this->hassan}")->assertOk()->assertJsonPath('meta.total', 1);
    $this->getJson('/api/subscriptions/summary')->assertOk()
        ->assertJsonPath('open', 1)->assertJsonPath('finished_unrenewed', 1)->assertJsonPath('outside_students', 1)
        ->assertJsonPath('due_count', 1)->assertJsonPath('outstanding.0.minor', 80000)->assertJsonPath('ending', 0);

    $picks = collect($this->getJson('/api/subscriptions/students')->assertOk()->json('rows'))->keyBy('full_name');
    expect($picks['Hassan']['subjects'][0])->toMatchArray(['teacher_name' => 'Ms Sama', 'course' => 'English', 'open_subscription_id' => $open])
        ->and($picks['Nada']['subjects'][0]['open_subscription_id'])->toBeNull()
        ->and($picks['Nada']['outside_count'])->toBe(1);

    // A Quran academy gets nothing of this.
    $quran = $this->createAcademy(overrides: ['plan_id' => DB::table('plans')->where('code', 'PRO')->value('id')]);
    $qOwner = $this->makeUser($quran, 'ACADEMY_OWNER', ['email' => 'q-owner@test.local']);
    Sanctum::actingAs($qOwner);
    $this->getJson('/api/subscriptions')->assertStatus(402);
});

it('reminds the family about the bill or the finished block in lessons, through the WhatsApp deep link', function () {
    $id = ($this->sell)()->assertCreated()->json('subscription.id');
    Sanctum::actingAs($this->owner);
    $res = $this->postJson("/api/subscriptions/{$id}/remind", ['kind' => 'PAYMENT', 'locale' => 'ar'])->assertOk();
    expect($res->json('sent'))->toBeFalse()->and($res->json('preview'))->toContain('Hassan')->toContain('8 حصص')->toContain('800 EGP')->toContain('/i/')
        ->and($res->json('deeplink'))->toStartWith('https://wa.me/201000000001?text=')->and($res->json('reminders_sent'))->toBe(1);
    $this->postJson("/api/subscriptions/{$id}/remind", ['kind' => 'FINISHED'])->assertStatus(422);

    ($this->pay)(($this->sub)($id)->invoice_id, 80000);
    for ($d = 1; $d <= 8; $d++) {
        ($this->attend)(sprintf('2026-06-%02d 10:00:00+00', $d));
    }
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/subscriptions/{$id}/remind", ['kind' => 'PAYMENT'])->assertStatus(422);
    $en = $this->postJson("/api/subscriptions/{$id}/remind", ['kind' => 'FINISHED', 'locale' => 'en'])->assertOk();
    expect($en->json('preview'))->toContain('Subscription finished')->toContain('8 lessons')->toContain('Finished on: 11 June 2026');
});

it('files the alerts under SUBSCRIPTIONS on the notifications page, and relays them to the accounting WhatsApp group', function () {
    // The alerts carry the clock they were written at, and a group hears only recent ones: real time from here.
    Carbon::setTestNow();
    giveWhatsAppToken($this->academy, 'tok-cs');
    $this->sends = 0;
    Http::fake([
        '*/api/status' => fn () => Http::response(['status' => 'CONNECTED'], 200),
        '*/api/messages/*' => fn () => Http::response(['state' => 'sent'], 200),
        '*/api/send-message' => function () {
            $this->sends++;

            return Http::response(['data' => ['msgId' => 'wamid.'.$this->sends]], 200);
        },
    ]);
    $this->asAcademy($this->academy, 'SUPER_ADMIN');
    DB::table('whatsapp_groups')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'jid' => '120363012345678901@g.us', 'name' => 'Accounts', 'label' => 'Accounting',
        'language' => 'en', 'events' => json_encode(['SUBSCRIPTION_FINISHED', 'SUBSCRIPTION_UNPAID']),
        'event_since' => json_encode(array_fill_keys(['SUBSCRIPTION_FINISHED', 'SUBSCRIPTION_UNPAID'], CarbonImmutable::now()->subHour()->toIso8601String())),
        'settings' => json_encode([]), 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
    ]);
    $this->clearTenantContext();

    $id = ($this->sell)(['lessons_sold' => 1])->assertCreated()->json('subscription.id');
    ($this->attend)('2026-06-01 10:00:00+00');
    $next = ($this->sell)(['lessons_sold' => 2])->assertCreated()->json('subscription.id');

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/notifications/summary')->assertOk()->assertJsonPath('subscriptions', 2)->assertJsonPath('packages', 0);
    $alerts = collect($this->getJson('/api/notifications?category=SUBSCRIPTIONS')->assertOk()->json('notifications'))->keyBy('type');
    expect($alerts->keys()->sort()->values()->all())->toBe(['SUBSCRIPTION_FINISHED', 'SUBSCRIPTION_UNPAID'])
        ->and($alerts['SUBSCRIPTION_FINISHED']['data'])->toMatchArray(['student_id' => $this->hassan, 'student_name' => 'Hassan', 'subscription_id' => $id, 'lessons_sold' => 1])
        ->and($alerts['SUBSCRIPTION_UNPAID']['data'])->toMatchArray(['student_id' => $this->hassan, 'student_name' => 'Hassan', 'subscription_id' => $next, 'outstanding_minor' => 10000, 'currency' => 'EGP', 'invoice_id' => ($this->sub)($next)->invoice_id]);
    ($this->attend)('2026-06-02 10:00:00+00');
    ($this->attend)('2026-06-03 10:00:00+00');
    ($this->attend)('2026-06-04 10:00:00+00');
    Sanctum::actingAs($this->owner);
    $outside = collect($this->getJson('/api/notifications?category=SUBSCRIPTIONS')->json('notifications'))->firstWhere('type', 'LESSON_OUTSIDE_SUBSCRIPTION');
    expect($outside['data'])->toMatchArray(['student_id' => $this->hassan, 'student_name' => 'Hassan', 'outside_count' => 1, 'teacher_name' => 'Ms Sama']);
    // The alerts feed (no category) is the reports tab's: the subscriptions tab reads its own category,
    // so a centre that opted into lesson reports never sees a balance alert under a report heading.
    expect(collect($this->getJson('/api/notifications')->json('notifications'))->pluck('category')->unique()->all())->toBe([]);

    app(GroupAlerts::class)->run($this->academy);
    $texts = Http::recorded(fn (HttpRequest $r) => str_contains($r->url(), '/api/send-message'))->map(fn (array $pair) => $pair[0]->data()['text'])->all();
    // Both blocks have finished by now, so the heading is the plural one.
    expect(implode("\n", $texts))->toContain('Subscriptions finished')->toContain('Hassan')->toContain('1 lesson used up')->toContain('2 lessons used up')
        ->toContain('New subscription while an earlier one is unpaid')->toContain('100 EGP still owed');
});

// ── Readers ──────────────────────────────────────────────────────────────────

it('feeds the centre dashboard, the parent portal, the family card, the suspend dialog, the pay page and the export', function () {
    $id = ($this->sell)()->assertCreated()->json('subscription.id');
    ($this->attend)('2026-06-01 10:00:00+00');
    $this->asAcademy($this->academy);
    DB::table('guardians')->where('id', $this->guardian)->update(['pay_token' => str_repeat('f', 48)]);
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/dashboard/centre')->assertOk()
        ->assertJsonPath('subscriptions.open', 1)->assertJsonPath('subscriptions.ending', 0)->assertJsonPath('subscriptions.ending_soon', 0)
        ->assertJsonPath('subscriptions.finished_unrenewed', 0)->assertJsonPath('subscriptions.outside', 0);
    expect(collect($this->getJson('/api/dashboard/centre')->json('activity'))->pluck('type')->all())->toContain('subscription');

    $this->getJson("/api/guardians/{$this->guardian}/advance-dues")->assertOk()
        ->assertJsonPath('dues.0.kind', 'SUBSCRIPTION')->assertJsonPath('dues.0.remaining_minor', 80000);
    $this->getJson("/api/guardians/{$this->guardian}/removal-dues")->assertOk()->assertJsonPath('dues.0.amount_minor', 80000);

    $this->getJson("/api/accounting/family/{$this->guardian}")->assertOk()->assertJsonPath('balance.0.due_minor', 80000)->assertJsonPath('unsettled', [])
        ->assertJsonPath('charges.0.subscription_id', $id)->assertJsonPath('charges.0.source', 'PRIVATE');
    $this->getJson('/api/subscriptions?view=due')->assertOk()->assertJsonPath('rows.0.invoice_token', ($this->row)('invoices', ($this->sub)($id)->invoice_id)->public_token);

    $url = $this->postJson("/api/guardians/{$this->guardian}/portal")->assertOk()->json('url');
    $this->clearTenantContext();
    $portal = $this->getJson('/api/p/'.substr((string) $url, strrpos((string) $url, '/p/') + 3))->assertOk();
    expect($portal->json('children.0.subscriptions.0'))->toMatchArray(['teacher_name' => 'Ms Sama', 'course' => 'English', 'lessons_sold' => 8, 'lessons_used' => 1, 'lessons_left' => 7, 'status' => 'OPEN']);

    $this->clearTenantContext();
    $page = $this->getJson('/api/f/'.str_repeat('f', 48))->assertOk();
    expect($page->json('items.0'))->toMatchArray(['kind' => 'SUBSCRIPTION', 'child' => 'Hassan', 'due_minor' => 80000, 'lessons' => 1, 'lessons_sold' => 8])
        ->and($page->json('items.0.purpose_text.ar'))->toContain('8 حصص')->and($page->json('totals.0.amount_minor'))->toBe(80000);

    Sanctum::actingAs($this->owner);
    $sheet = $this->getJson('/api/academy/export/subscriptions')->assertOk()->json();
    $keys = array_column($sheet['columns'], 'key');
    $row = array_combine($keys, $sheet['rows'][0]);
    expect($row)->toMatchArray(['student' => 'Hassan', 'lessons_sold' => 8, 'lessons_used' => 1, 'course' => 'English', 'status' => 'OPEN']);

    // Letting the charge go from the family card ends the block where it stands.
    $lineId = ($this->sub)($id)->invoice_line_id;
    $this->postJson("/api/accounting/family/{$this->guardian}/charges/{$lineId}/cancel", ['reason' => 'left'])->assertOk();
    expect(($this->sub)($id)->status)->toBe('CLOSED')->and(($this->balance)())->toBe(['due' => 0, 'credit' => 0]);
});

it('sells a subscription with the student on POST /students, in the same unit — exclusive with a package', function () {
    Sanctum::actingAs($this->owner);
    $res = $this->postJson('/api/students', [
        'full_name' => 'Yahya', 'guardian_id' => $this->guardian, 'status' => 'REGULAR',
        'teachers' => [['teacher_id' => $this->teacher, 'course' => 'English']],
        'subscription' => ['teacher_id' => $this->teacher, 'course' => 'English', 'lessons_sold' => 4, 'lesson_price_minor' => 12500, 'lesson_minutes' => 45],
    ])->assertCreated();
    $sub = ($this->sub)($res->json('subscriptionId'));
    expect($sub->student_id)->toBe($res->json('studentId'))->and((int) $sub->price_minor)->toBe(50000)->and($sub->course)->toBe('English')->and($sub->status)->toBe('OPEN')
        ->and($res->json('subscriptionInvoiceId'))->toBe($sub->invoice_id);
    // The rest of the system sees a student on the block clock (REGULAR needs a billing row).
    expect(csTenant($this->academy, fn () => DB::table('subscriptions')->where('student_id', $res->json('studentId'))->where('status', 'ACTIVE')->value('price_basis')))->toBe('PER_PACKAGE');

    // The enrolment wizard's convert: sell to the trial student, then PATCH them REGULAR.
    $trial = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Trial Kid', 'status' => 'TRIAL']);
    ($this->alsoTeaches)($trial, $this->teacher, 'English');
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/subscriptions', ['student_id' => $trial, 'teacher_id' => $this->teacher, 'lessons_sold' => 4, 'lesson_price_minor' => 10000])->assertCreated();
    $this->patchJson("/api/students/{$trial}", ['status' => 'REGULAR'])->assertOk();
    expect(csTenant($this->academy, fn () => DB::table('students')->where('id', $trial)->value('status')))->toBe('REGULAR');

    // A refused sale rolls the student back with it.
    $before = csTenant($this->academy, fn () => DB::table('students')->count());
    $this->postJson('/api/students', [
        'full_name' => 'Ghost', 'guardian_id' => $this->guardian, 'status' => 'REGULAR',
        'subscription' => ['teacher_id' => $this->other, 'lessons_sold' => 4, 'lesson_price_minor' => 12500],
    ])->assertStatus(422);
    expect(csTenant($this->academy, fn () => DB::table('students')->count()))->toBe($before);

    // Monthly terms still travel under `subscription` (and `subscription_terms`) as before.
    $this->postJson('/api/students', [
        'full_name' => 'Monthly', 'guardian_id' => $this->guardian, 'status' => 'REGULAR',
        'subscription_terms' => ['plan_label' => 'Monthly', 'price_minor' => 50000, 'currency' => 'EGP', 'price_basis' => 'PER_HOUR', 'start_date' => '2026-06-01'],
    ])->assertCreated();
    expect(csTenant($this->academy, fn () => DB::table('subscriptions')->where('plan_label', 'Monthly')->value('price_basis')))->toBe('PER_HOUR');
});

it('leaves a monthly-billed centre student on the monthly path', function () {
    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'student_id' => $this->hassan,
        'plan_label' => 'Hourly', 'price_minor' => 6000, 'currency' => 'EGP', 'price_basis' => 'PER_HOUR', 'status' => 'ACTIVE', 'start_date' => '2026-01-01',
    ]);
    $this->clearTenantContext();
    $lesson = ($this->attend)('2026-06-01 10:00:00+00');
    expect(csTenant($this->academy, fn () => DB::table('invoice_line_items')->where('session_id', $lesson)->value('amount_minor')))->toBe(6000)
        ->and(($this->outside)())->toBe(0);
});

// ── The seam ─────────────────────────────────────────────────────────────────

it('keeps every other academy on the package engine: a Quran academy, and a centre whose packages are still on', function () {
    $quran = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'plan_id' => DB::table('plans')->where('code', 'PRO')->value('id')]);
    $qOwner = $this->makeUser($quran, 'ACADEMY_OWNER', ['email' => 'q2-owner@test.local']);
    $qTeacher = $this->createTeacher($quran);
    $qStudent = $this->createStudent($quran, null, ['full_name' => 'Quran Pupil', 'status' => 'REGULAR']);
    $this->asAcademy($quran);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $quran, 'student_id' => $qStudent,
        'plan_label' => 'Hours', 'price_minor' => 6000, 'currency' => 'EGP', 'price_basis' => 'PER_PACKAGE', 'status' => 'ACTIVE', 'start_date' => '2026-01-01',
    ]);
    $package = app(LessonPackages::class)->open([
        'student_id' => $qStudent, 'label' => '4 hours', 'minutes_total' => 240, 'price_minor' => 24000, 'currency' => 'EGP', 'starts_on' => '2026-06-01', 'auto_renew' => false,
    ], (string) $qOwner->id, 'ACADEMY_OWNER')['package_id'];
    $session = $this->createSession($quran, $qStudent, $qTeacher, ['scheduled_at_utc' => '2026-06-02 10:00:00+00', 'duration_minutes' => 60, 'status' => 'SCHEDULED']);
    $this->clearTenantContext();

    // The switches are read under the academy's own context (its modules are behind RLS).
    expect(csTenant($quran, fn () => MoneyPolicy::for($quran)))->toBeInstanceOf(App\Billing\PackageMoney::class)
        ->and(csTenant($this->academy, fn () => MoneyPolicy::for($this->academy)))->toBeInstanceOf(App\Billing\SubscriptionMoney::class);

    Sanctum::actingAs($qOwner);
    $this->postJson("/api/sessions/{$session}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $this->asAcademy($quran);
    expect((int) DB::table('lesson_packages')->where('id', $package)->value('minutes_consumed'))->toBe(60)
        ->and(DB::table('lesson_package_credits')->where('session_id', $session)->exists())->toBeTrue()
        ->and(DB::table('centre_subscription_lessons')->count())->toBe(0);
    $this->clearTenantContext();

    // A centre still on packages (before the data move) keeps consuming its blocks.
    csCentreOn($this->academy, [], ['centre', 'accounting']);
    expect(csTenant($this->academy, fn () => MoneyPolicy::for($this->academy)))->toBeInstanceOf(App\Billing\PackageMoney::class);
});
