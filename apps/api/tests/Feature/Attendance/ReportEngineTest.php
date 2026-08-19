<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesReportFields;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesReportFields::class);

beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-rep@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Rep Teacher']);
    $this->student = $this->createStudent($this->academy);
    $this->fields = $this->seedQuranReportFields($this->academy);

    $this->session = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-01 15:00:00+00', 'status' => 'ATTENDED',
    ]);

    $this->reportValues = function (string $sessionId): array {
        $this->asAcademy($this->academy);
        $raw = DB::table('session_reports')->where('session_id', $sessionId)->value('values');

        return $raw !== null ? (json_decode($raw, true) ?: []) : [];
    };
});

afterEach(fn () => Carbon::setTestNow());

it('renders the Qur\'an academy fields by type in sort order, bilingually', function () {
    // TC-6.14 — surah-from/to (TEXT req), tajweed (SELECT 3 opts), next assignment (TEXT), notes (TEXTAREA)
    Sanctum::actingAs($this->owner);

    $body = $this->getJson("/api/sessions/{$this->session}")->assertOk()->json();
    $fields = collect($body['reportFields']);

    expect($fields->pluck('key')->all())->toBe(['surah_from', 'surah_to', 'tajweed_rating', 'next_assignment', 'notes']);

    $surahFrom = $fields->firstWhere('key', 'surah_from');
    expect($surahFrom['field_type'])->toBe('TEXT')
        ->and($surahFrom['is_required'])->toBeTrue()
        ->and($surahFrom['label_ar'])->toBe('من سورة / آية')
        ->and($surahFrom['label_en'])->toBe('From surah / ayah');

    $tajweed = $fields->firstWhere('key', 'tajweed_rating');
    expect($tajweed['field_type'])->toBe('SELECT')
        ->and($tajweed['options'])->toBe(['ممتاز', 'جيد جداً', 'جيد']);

    expect($fields->firstWhere('key', 'notes')['field_type'])->toBe('TEXTAREA');
});

it('rejects a report missing a required field with a field-level message; nothing saved', function () {
    // TC-6.15
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/sessions/{$this->session}/report", ['values' => ['surah_to' => 'Al-Baqarah 5']])
        ->assertStatus(422)
        ->assertJsonValidationErrors('values.surah_from');

    $this->asAcademy($this->academy);
    expect(DB::table('session_reports')->where('session_id', $this->session)->exists())->toBeFalse();
});

it('rejects an out-of-range SELECT and a non-numeric NUMBER', function () {
    // TC-6.16
    $this->seedReportFields($this->academy, [
        ['key' => 'memorized_pages', 'label_ar' => 'صفحات', 'label_en' => 'Pages', 'field_type' => 'NUMBER', 'sort_order' => 9],
    ]);
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/sessions/{$this->session}/report", [
        'values' => ['surah_from' => 'A', 'surah_to' => 'B', 'tajweed_rating' => 'NOT_AN_OPTION'],
    ])->assertStatus(422)->assertJsonValidationErrors('values.tajweed_rating');

    $this->putJson("/api/sessions/{$this->session}/report", [
        'values' => ['surah_from' => 'A', 'surah_to' => 'B', 'memorized_pages' => 'twelve'],
    ])->assertStatus(422)->assertJsonValidationErrors('values.memorized_pages');
});

it('saves a valid report keyed by field key, capturing filled_by and filled_at', function () {
    // TC-6.17 — AC-6.6 / AC-6.7
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/sessions/{$this->session}/report", ['values' => [
        'surah_from' => 'آل عمران 85', 'surah_to' => 'آل عمران 92', 'tajweed_rating' => 'ممتاز', 'notes' => 'ما شاء الله',
    ]])->assertOk();

    expect(($this->reportValues)($this->session))->toEqualCanonicalizing([
        'surah_from' => 'آل عمران 85', 'surah_to' => 'آل عمران 92', 'tajweed_rating' => 'ممتاز', 'notes' => 'ما شاء الله',
    ]);

    $this->asAcademy($this->academy);
    $report = DB::table('session_reports')->where('session_id', $this->session)->first();
    expect($report->filled_by_user_id)->toBe($this->owner->id)->and($report->filled_at)->not->toBeNull();
});

it('persists the free-text report body and the trial flag (reserved keys)', function () {
    // Free-text reporting UI: report_text + is_free_trial aren't academy field definitions,
    // so they must survive the validator and round-trip through GET /sessions/{id}.
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/sessions/{$this->session}/report", ['values' => [
        'report_text' => '<p>Great session</p>', 'is_free_trial' => true,
    ]])->assertOk();

    expect(($this->reportValues)($this->session))->toMatchArray([
        'report_text' => '<p>Great session</p>',
        'is_free_trial' => true,
    ]);

    $values = $this->getJson("/api/sessions/{$this->session}")->assertOk()->json('report.values');
    expect($values['report_text'])->toBe('<p>Great session</p>')
        ->and($values['is_free_trial'])->toBeTrue();
});

it('clears the trial flag when a later save marks it not free', function () {
    // Switching FREE → ATTENDED sends is_free_trial=false; the stored flag must flip, not linger.
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/sessions/{$this->session}/report", ['values' => [
        'report_text' => 'note', 'is_free_trial' => true,
    ]])->assertOk();

    $this->putJson("/api/sessions/{$this->session}/report", ['values' => [
        'report_text' => 'note', 'is_free_trial' => false,
    ]])->assertOk();

    expect(($this->reportValues)($this->session)['is_free_trial'])->toBeFalse();
});

it('keeps the trial flag through a text-only edit that omits it', function () {
    // Editing notes without re-choosing an outcome omits is_free_trial — the flag must persist.
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/sessions/{$this->session}/report", ['values' => [
        'report_text' => 'first', 'is_free_trial' => true,
    ]])->assertOk();

    $this->putJson("/api/sessions/{$this->session}/report", ['values' => [
        'report_text' => 'second',
    ]])->assertOk();

    $values = ($this->reportValues)($this->session);
    expect($values['report_text'])->toBe('second')
        ->and($values['is_free_trial'])->toBeTrue();
});

it('hides a deactivated field for new entry but renders it read-only where a value exists', function () {
    // TC-6.18 — deactivate-not-delete (AC-6.6)
    Sanctum::actingAs($this->owner);
    $this->putJson("/api/sessions/{$this->session}/report", ['values' => [
        'surah_from' => 'A', 'surah_to' => 'B', 'notes' => 'kept',
    ]])->assertOk();

    // Deactivate the notes field (Sprint 3 contract).
    $this->asAcademy($this->academy);
    DB::table('report_field_definitions')->where('id', $this->fields['notes'])->update(['is_active' => false]);

    $body = $this->getJson("/api/sessions/{$this->session}")->assertOk()->json();
    $activeKeys = collect($body['reportFields'])->pluck('key');
    $inactiveKeys = collect($body['inactiveReportFields'])->pluck('key');

    expect($activeKeys)->not->toContain('notes')           // hidden for new entry
        ->and($inactiveKeys)->toContain('notes');          // still shown (read-only) — it has a value
    expect($body['report']['values']['notes'])->toBe('kept');
});

it('preserves a deactivated field\'s historical value through a later edit', function () {
    // TC-6.18 (cont.) — editing must not wipe the inactive field's stored value
    Sanctum::actingAs($this->owner);
    $this->putJson("/api/sessions/{$this->session}/report", ['values' => [
        'surah_from' => 'A', 'surah_to' => 'B', 'notes' => 'original note',
    ]])->assertOk();

    $this->asAcademy($this->academy);
    DB::table('report_field_definitions')->where('id', $this->fields['notes'])->update(['is_active' => false]);

    Sanctum::actingAs($this->owner);
    $this->putJson("/api/sessions/{$this->session}/report", ['values' => [
        'surah_from' => 'A2', 'surah_to' => 'B2',
    ]])->assertOk();

    expect(($this->reportValues)($this->session))->toMatchArray([
        'surah_from' => 'A2', 'surah_to' => 'B2', 'notes' => 'original note',
    ]);
});

it('renders a newly added field as empty on an existing report without corruption', function () {
    // TC-6.19
    Sanctum::actingAs($this->owner);
    $this->putJson("/api/sessions/{$this->session}/report", ['values' => [
        'surah_from' => 'A', 'surah_to' => 'B',
    ]])->assertOk();

    // Add a brand-new field after the report already exists.
    $this->seedReportFields($this->academy, [
        ['key' => 'homework_done', 'label_ar' => 'الواجب', 'label_en' => 'Homework done', 'field_type' => 'SELECT', 'options' => ['yes', 'no'], 'sort_order' => 20],
    ]);

    Sanctum::actingAs($this->owner);
    $body = $this->getJson("/api/sessions/{$this->session}")->assertOk()->json();

    expect(collect($body['reportFields'])->pluck('key'))->toContain('homework_done');
    // Old report simply lacks the new key — no corruption of existing values.
    expect($body['report']['values'])->not->toHaveKey('homework_done')
        ->and($body['report']['values'])->toMatchArray(['surah_from' => 'A', 'surah_to' => 'B']);
});

it('renders a different academy type\'s fields with no code change', function () {
    // TC-6.20 — generalization (LANGUAGES-style fields)
    $langAcademy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $langOwner = $this->makeUser($langAcademy, 'ACADEMY_OWNER', ['email' => 'owner-lang@test.local']);
    $teacher = $this->createTeacher($langAcademy);
    $student = $this->createStudent($langAcademy);
    $this->seedReportFields($langAcademy, [
        ['key' => 'unit', 'label_ar' => 'الوحدة', 'label_en' => 'Unit', 'field_type' => 'TEXT', 'is_required' => true, 'sort_order' => 0],
        ['key' => 'speaking', 'label_ar' => 'المحادثة', 'label_en' => 'Speaking', 'field_type' => 'RATING', 'options' => ['1', '2', '3', '4', '5'], 'sort_order' => 1],
    ]);
    $session = $this->createSession($langAcademy, $student, $teacher, ['scheduled_at_utc' => '2026-06-01 15:00:00+00', 'status' => 'ATTENDED']);

    Sanctum::actingAs($langOwner);
    $body = $this->getJson("/api/sessions/{$session}")->assertOk()->json();
    expect(collect($body['reportFields'])->pluck('key')->all())->toBe(['unit', 'speaking']);

    $this->putJson("/api/sessions/{$session}/report", ['values' => ['unit' => 'Unit 3', 'speaking' => '4']])->assertOk();
});

it('lists the per-student report archive, paginated, own-academy only', function () {
    // TC-6.28 — AC-6.11
    Sanctum::actingAs($this->owner);
    $this->putJson("/api/sessions/{$this->session}/report", ['values' => ['surah_from' => 'A', 'surah_to' => 'B']])->assertOk();

    // A second past session for the same student.
    $older = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-05-20 15:00:00+00', 'status' => 'ATTENDED',
    ]);

    $body = $this->getJson("/api/students/{$this->student}/reports?pageSize=10")->assertOk()->json();

    expect($body['total'])->toBe(2)
        ->and($body['page'])->toBe(1)
        ->and(collect($body['reports'])->pluck('id'))->toContain($this->session, $older);

    // Newest first (defaultSort -date): the June session precedes the May one.
    expect($body['reports'][0]['id'])->toBe($this->session);
    // The reported session carries its decoded values; the unreported one is null.
    $reported = collect($body['reports'])->firstWhere('id', $this->session);
    expect($reported['report_values'])->toMatchArray(['surah_from' => 'A', 'surah_to' => 'B']);
});

// ── The guardian-facing "Lesson #N" the report card prints ──
it('numbers a session by the student\'s delivered lessons, skipping cancellations', function () {
    Sanctum::actingAs($this->owner);

    // The one seeded in beforeEach is this student's first DELIVERED lesson.
    expect($this->getJson("/api/sessions/{$this->session}")->assertOk()->json('session.session_number'))->toBe(1);

    // A cancellation between them takes no number — nothing was delivered.
    $cancelled = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-02 15:00:00+00', 'status' => 'CANCELLED_BY_STUDENT',
    ]);
    expect($this->getJson("/api/sessions/{$cancelled}")->assertOk()->json('session.session_number'))->toBeNull();

    // A free lesson was still delivered, so the sequence a parent sees never skips.
    $free = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-03 15:00:00+00', 'status' => 'FREE',
    ]);
    expect($this->getJson("/api/sessions/{$free}")->assertOk()->json('session.session_number'))->toBe(2);

    // A session still awaiting its outcome has no number yet.
    $scheduled = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-04 15:00:00+00', 'status' => 'SCHEDULED',
    ]);
    expect($this->getJson("/api/sessions/{$scheduled}")->assertOk()->json('session.session_number'))->toBeNull();

    // Another student's lessons are counted separately.
    $other = $this->createStudent($this->academy);
    $otherFirst = $this->createSession($this->academy, $other, $this->teacher, [
        'scheduled_at_utc' => '2026-06-05 15:00:00+00', 'status' => 'ATTENDED',
    ]);
    expect($this->getJson("/api/sessions/{$otherFirst}")->assertOk()->json('session.session_number'))->toBe(1);
});
