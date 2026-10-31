<?php

declare(strict_types=1);

use App\Services\ModuleBilling;
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

/**
 * Structured lesson reports (`lesson_report`, opt-in): the academy's own form, filled by the teacher
 * or a supervisor, poured into the academy's own WhatsApp message (أكاديمية أنا مسلم, 2026-10-31).
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['name' => 'أكاديمية أنا مسلم', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-lr@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-lr@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'آية مصطفى', 'user_id' => $this->teacherUser->id]);
    $guardian = $this->createGuardian($this->academy, ['whatsapp_phone' => '+201001234567']);
    $this->student = $this->createStudent($this->academy, $guardian, ['full_name' => 'منار محمد']);
    // The academy's old default form — two of its fields are required.
    $this->seedQuranReportFields($this->academy);

    // Monday 1 June 2026, 18:00 Cairo, 30 minutes.
    $this->session = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-01 15:00:00+00', 'status' => 'ATTENDED',
    ]);
});

afterEach(fn () => Carbon::setTestNow());

function lrSwitchOn(string $academyId, bool $on = true): void
{
    test()->asAcademy($academyId, 'SUPER_ADMIN');
    app(ModuleBilling::class)->setDisabledFeatures($academyId, 'MANAGEMENT', [], $on ? ['lesson_report'] : []);
    test()->clearTenantContext();
}

it('is off until a Super Admin switches it on for the client', function () {
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/lesson-report')->assertStatus(402);

    lrSwitchOn($this->academy);
    $this->getJson('/api/lesson-report')->assertOk()
        ->assertJsonPath('facts', ['academy', 'teacher', 'student', 'day', 'date', 'attendance', 'duration'])
        ->assertJsonPath('presets.quran.name_en', 'Quran circle');
});

it('starts from the Quran circle template: its fields replace the old form, which is kept but switched off', function () {
    lrSwitchOn($this->academy);
    Sanctum::actingAs($this->owner);

    $res = $this->postJson('/api/lesson-report/presets/quran')->assertOk();

    $fields = collect($res->json('fields'))->keyBy('key');
    expect($fields['hifz_score']['max_value'])->toBe(10)
        ->and($fields['hifz_score']['section'])->toBe('التقييم')
        ->and($fields['next_hifz']['section'])->toBe('الواجب القادم')
        ->and($fields['hifz_score']['is_active'])->toBeTrue()
        // The old form is deactivated, never deleted.
        ->and($fields['surah_from']['is_active'])->toBeFalse();
    expect($res->json('message'))->toContain('{hifz_score}')->toContain('{religious_education}');
});

it('fills the academy\'s own message from what the teacher entered, dropping lines left empty', function () {
    lrSwitchOn($this->academy);
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/lesson-report/presets/quran')->assertOk();

    // The teacher fills the form; the old required fields no longer stand in the way.
    Sanctum::actingAs($this->teacherUser);
    $this->putJson("/api/sessions/{$this->session}/report", ['values' => [
        'hifz_score' => 9, 'recent_review_score' => 8, 'old_review_score' => 0, 'behaviour_score' => 10,
        'next_hifz' => 'المائدة من 61 إلى 81', 'reflection' => 'النبي عيسى عليه السلام رسول من عند الله',
    ]])->assertOk();

    Sanctum::actingAs($this->owner);
    $text = $this->postJson("/api/sessions/{$this->session}/report/whatsapp-sent")->assertOk()->json('message.text');

    expect($text)->toStartWith('*🌼أكاديمية أنا مسلم🌼*')
        ->toContain('🌺 المعلم : آية مصطفى')
        ->toContain('🌺 الطالب : منار محمد')
        ->toContain('✅️ درجة الحفظ: 9 / 10')
        ->toContain('✅️ درجة الماضي البعيد: 0 / 10')
        ->toContain('🌺 الحفظ الجديد: المائدة من 61 إلى 81')
        ->toContain('🗓 حلقة يوم: الاثنين')
        ->toContain('📝 الموافق: 01/06/2026')
        ->toContain('📋 الحضور: تم الحضور')
        ->toContain('⏱️ مدة الحلقة: 30')
        // Not filled this lesson → the line is gone, label and all.
        ->not->toContain('التربية الدينية')
        ->not->toContain('{')
        // The academy's message replaces the generic bilingual card.
        ->not->toContain('Session Report');
});

it('keeps a score inside its "out of"', function () {
    lrSwitchOn($this->academy);
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/lesson-report/presets/quran')->assertOk();

    $this->putJson("/api/sessions/{$this->session}/report", ['values' => ['hifz_score' => 11]])
        ->assertStatus(422)->assertJsonValidationErrors('values.hifz_score');
    $this->putJson("/api/sessions/{$this->session}/report", ['values' => ['hifz_score' => -1]])
        ->assertStatus(422);
    $this->putJson("/api/sessions/{$this->session}/report", ['values' => ['hifz_score' => 10]])->assertOk();
});

it('saves the message and previews it with stand-in values', function () {
    lrSwitchOn($this->academy);
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/lesson-report/presets/quran')->assertOk();

    $message = "الطالب: {student}\nالحفظ: {hifz_score}\n{typo}";
    $this->putJson('/api/lesson-report/message', ['message' => $message])->assertOk();
    $this->getJson('/api/lesson-report')->assertJsonPath('message', $message);

    $preview = $this->postJson('/api/lesson-report/preview', ['message' => $message])->assertOk()->json('text');
    // A typo stays visible rather than vanishing.
    expect($preview)->toBe("الطالب: منار محمد\nالحفظ: 9 / 10\n{typo}");
});

it('goes back to the generic message when the client is switched off again', function () {
    lrSwitchOn($this->academy);
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/lesson-report/presets/quran')->assertOk();
    $this->putJson("/api/sessions/{$this->session}/report", ['values' => ['hifz_score' => 9]])->assertOk();

    lrSwitchOn($this->academy, false);
    Sanctum::actingAs($this->owner);
    $text = $this->postJson("/api/sessions/{$this->session}/report/whatsapp-sent")->assertOk()->json('message.text');
    expect($text)->toContain('Session Report')->not->toContain('🌼');
});

it('lets the field editor set a field\'s section and its "out of"', function () {
    Sanctum::actingAs($this->owner);
    $id = $this->postJson("/api/academies/{$this->academy}/report-fields", [
        'key' => 'tajweed_score', 'label_ar' => 'درجة التجويد', 'label_en' => 'Tajweed',
        'field_type' => 'NUMBER', 'max_value' => 5, 'section' => 'التقييم',
    ])->assertCreated()->json('reportFieldId');

    $this->patchJson("/api/academies/{$this->academy}/report-fields/{$id}", ['max_value' => 20, 'section' => null])->assertOk();

    $this->asAcademy($this->academy);
    $row = DB::table('report_field_definitions')->where('id', $id)->first();
    expect((int) $row->max_value)->toBe(20)->and($row->section)->toBeNull();
});

it('forgets an answer the teacher cleared on the form', function () {
    lrSwitchOn($this->academy);
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/lesson-report/presets/quran')->assertOk();

    $this->putJson("/api/sessions/{$this->session}/report", ['values' => ['hifz_score' => 9, 'next_hifz' => 'المائدة']])->assertOk();
    $values = $this->putJson("/api/sessions/{$this->session}/report", ['values' => ['hifz_score' => null, 'next_hifz' => '']])
        ->assertOk()->json('values');

    expect($values)->not->toHaveKey('hifz_score')->not->toHaveKey('next_hifz');
});
