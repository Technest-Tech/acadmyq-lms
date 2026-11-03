<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * The absence alert (docs/centre-profile, Phase 2 §4): a centre's family hears on WhatsApp the moment
 * a group sheet marks their child ABSENT. Pinned here:
 *   - OFF by default, and a sheet saved with it off leaves no trace anywhere;
 *   - on, exactly one message per (lesson, child), only for ABSENT, logged as GROUP_ABSENCE;
 *   - re-saving the sheet never sends again; a Quran academy's switch does nothing;
 *   - the text is the platform's default, or the centre's own wording, with the facts poured in;
 *   - the Settings routes are a centre's (402 otherwise) and the owner's (settings.manage).
 */
beforeEach(function () {
    // Wednesday 17 June 2026, 12:00 Cairo.
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['name' => 'Lingo Centre', 'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo'], modules: ['MANAGEMENT', 'WHATSAPP']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-absence@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-absence@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona', 'user_id' => $this->teacherUser->getKey()]);

    $this->ummAdam = $this->createGuardian($this->academy, ['full_name' => 'Umm Adam', 'whatsapp_phone' => '+201001112223']);
    $this->adam = $this->createStudent($this->academy, $this->ummAdam, ['full_name' => 'Adam', 'status' => 'REGULAR']);
    $this->ummBassel = $this->createGuardian($this->academy, ['full_name' => 'Umm Bassel', 'whatsapp_phone' => '+201002223334']);
    $this->bassel = $this->createStudent($this->academy, $this->ummBassel, ['full_name' => 'Bassel', 'status' => 'REGULAR']);
    $this->ummCeline = $this->createGuardian($this->academy, ['full_name' => 'Umm Celine', 'whatsapp_phone' => '+201003334445']);
    $this->celine = $this->createStudent($this->academy, $this->ummCeline, ['full_name' => 'Celine', 'status' => 'REGULAR']);
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

function absenceAs(string $academyId, string $role, callable $fn): mixed
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', ?, true)", [$role]);
    try {
        return $fn();
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

/** Make the academy a centre (the opt-in switch on its MANAGEMENT module). */
function absenceCentreOn(string $academyId): void
{
    absenceAs($academyId, 'SUPER_ADMIN', fn () => DB::table('module_subscriptions')
        ->where('academy_id', $academyId)->where('module', 'MANAGEMENT')
        ->update(['overrides' => json_encode(['enabled' => ['centre']])]));
}

/** The centre's switch, as Settings would save it. */
function absenceSwitch(string $academyId, bool $on, ?string $message = null): void
{
    absenceAs($academyId, 'ACADEMY_OWNER', fn () => DB::table('academy_automation_settings')->updateOrInsert(
        ['academy_id' => $academyId],
        ['group_absence_alert_enabled' => $on, 'group_absence_alert_message' => $message, 'updated_at' => now()],
    ));
}

/** A group with the three students, running since 1 June; returns the lesson of Monday 15 June. */
function absenceLesson($test): object
{
    Sanctum::actingAs($test->owner);
    $groupId = $test->postJson('/api/groups', [
        'name' => 'English A1 — evening', 'level' => 'A1', 'teacher_id' => $test->teacher, 'start_date' => '2026-06-01',
        'slots' => [['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60]],
    ])->assertCreated()->json('group.id');
    $test->postJson("/api/groups/{$groupId}/members", ['student_ids' => [$test->adam, $test->bassel, $test->celine], 'joined_on' => '2026-06-01'])->assertCreated();

    return absenceAs($test->academy, 'ACADEMY_OWNER', fn () => DB::table('class_group_lessons')
        ->where('group_id', $groupId)->where('occurrence_local_date', '2026-06-15')->first());
}

function absenceLog($test)
{
    return absenceAs($test->academy, 'ACADEMY_OWNER', fn () => DB::table('automation_send_log')
        ->where('academy_id', $test->academy)->where('automation_type', 'GROUP_ABSENCE')->get());
}

it('does nothing at all while the switch is off', function () {
    absenceCentreOn($this->academy);
    giveWhatsAppToken($this->academy);
    Http::fake();
    $lesson = absenceLesson($this);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$lesson->id}/attendance", [
        'entries' => [['student_id' => $this->adam, 'status' => 'ABSENT']],
    ])->assertOk();

    Http::assertNothingSent();
    expect(absenceLog($this))->toHaveCount(0);
});

it('messages the family once, only for an absence, with the facts and a log line', function () {
    absenceCentreOn($this->academy);
    absenceSwitch($this->academy, true);
    giveWhatsAppToken($this->academy, 'token-centre');
    Http::fake(['*' => Http::response(['data' => ['msgId' => 'wamid.absent']], 200)]);
    $lesson = absenceLesson($this);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$lesson->id}/attendance", [
        'entries' => [
            ['student_id' => $this->adam, 'status' => 'ABSENT'],
            ['student_id' => $this->bassel, 'status' => 'LATE'],
            ['student_id' => $this->celine, 'status' => 'EXCUSED'],
        ],
    ])->assertOk();

    Http::assertSentCount(1);
    Http::assertSent(function ($req): bool {
        $text = (string) ($req->data()['text'] ?? '');

        return $req->hasHeader('Authorization', 'Bearer token-centre')
            && str_contains($req->url(), '/api/send-message')
            && ($req->data()['to'] ?? null) === '+201001112223'
            && str_contains($text, 'Lingo Centre')
            && str_contains($text, 'Adam')
            && str_contains($text, 'English A1 — evening')
            && str_contains($text, 'يونيو 2026')
            && str_contains($text, '5:00 م')
            && ! str_contains($text, '{{');
    });

    $log = absenceLog($this);
    expect($log)->toHaveCount(1);
    expect($log[0])->toMatchArray([
        'status' => 'SENT',
        'transport' => 'WASENDER',
        'recipient_kind' => 'GUARDIAN',
        'recipient_id' => $this->ummAdam,
        'recipient_phone' => '+201001112223',
        'template_key' => 'GROUP_ABSENCE',
        'ref_type' => 'class_group_lesson',
        'ref_id' => $lesson->id,
        'dedupe_key' => "group_absence:{$lesson->id}:{$this->adam}",
        'provider_message_id' => 'wamid.absent',
    ]);

    // The sheet is corrected and saved again: Adam is still absent, Bassel now too. One new message.
    $this->postJson("/api/group-lessons/{$lesson->id}/attendance", [
        'entries' => [
            ['student_id' => $this->adam, 'status' => 'ABSENT'],
            ['student_id' => $this->bassel, 'status' => 'ABSENT'],
        ],
    ])->assertOk();

    Http::assertSentCount(2);
    Http::assertSent(fn ($req): bool => ($req->data()['to'] ?? null) === '+201002223334' && str_contains((string) $req->data()['text'], 'Bassel'));
    expect(absenceLog($this))->toHaveCount(2);
});

it('sends the centre’s own wording when it wrote one', function () {
    absenceCentreOn($this->academy);
    absenceSwitch($this->academy, true, 'غاب {{student}} عن {{group}} اليوم {{date}} — {{academy}}');
    giveWhatsAppToken($this->academy);
    Http::fake(['*' => Http::response(['data' => ['msgId' => 'x']], 200)]);
    $lesson = absenceLesson($this);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$lesson->id}/attendance", [
        'entries' => [['student_id' => $this->adam, 'status' => 'ABSENT']],
    ])->assertOk();

    Http::assertSent(fn ($req): bool => ($req->data()['text'] ?? null) === 'غاب Adam عن English A1 — evening اليوم الاثنين 15 يونيو 2026 — Lingo Centre');
});

it('is a centre’s alone — a Quran academy’s switch sends nothing', function () {
    absenceSwitch($this->academy, true);
    giveWhatsAppToken($this->academy);
    Http::fake();
    $lesson = absenceLesson($this);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/group-lessons/{$lesson->id}/attendance", [
        'entries' => [['student_id' => $this->adam, 'status' => 'ABSENT']],
    ])->assertOk();

    Http::assertNothingSent();
    expect(absenceLog($this))->toHaveCount(0);
});

it('lets the owner read and set the switch and wording in Settings', function () {
    // Not a centre yet: the routes do not exist for it.
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/group-absence-alert')->assertStatus(402);

    absenceCentreOn($this->academy);
    Sanctum::actingAs($this->owner);
    $res = $this->getJson('/api/group-absence-alert')->assertOk();
    expect($res->json('enabled'))->toBeFalse();
    expect($res->json('message'))->toBeNull();
    expect($res->json('default_message'))->toContain('{{student}}')->toContain('{{group}}')->toContain('لم يحضر');
    expect($res->json('placeholders'))->toBe(['student', 'group', 'date', 'time', 'academy']);
    expect($res->json('sample'))->toContain('Lingo Centre')->not->toContain('{{');

    $saved = $this->putJson('/api/group-absence-alert', ['enabled' => true, 'message' => '  غاب {{student}}  '])->assertOk();
    expect($saved->json('enabled'))->toBeTrue();
    expect($saved->json('message'))->toBe('غاب {{student}}');
    expect($saved->json('sample'))->toBe('غاب آدم');

    // Clearing the wording goes back to the default; the switch stays as sent.
    $cleared = $this->putJson('/api/group-absence-alert', ['enabled' => false, 'message' => null])->assertOk();
    expect($cleared->json('enabled'))->toBeFalse();
    expect($cleared->json('message'))->toBeNull();

    $this->postJson('/api/group-absence-alert/preview', ['message' => '{{academy}}: {{time}}'])->assertOk()
        ->assertJsonPath('sample', 'Lingo Centre: 5:00 م');

    $this->asAcademy($this->academy);
    expect(DB::table('audit_log')->where('action', 'group_absence_alert.settings')->count())->toBe(2);

    // A teacher holds no settings.manage.
    Sanctum::actingAs($this->teacherUser);
    $this->getJson('/api/group-absence-alert')->assertForbidden();
    $this->putJson('/api/group-absence-alert', ['enabled' => true, 'message' => null])->assertForbidden();
});
