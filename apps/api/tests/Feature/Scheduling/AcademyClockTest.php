<?php

declare(strict_types=1);

use App\Services\ScheduleAnchor;
use App\Services\SessionGenerator;
use App\Support\CountryClocks;
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
 * One clock per academy, and a timetable that can follow the student's (Nov 2026).
 *
 * Egypt went back an hour on 30 Oct 2026. Two things broke around a generator that was right all
 * along: devices still on summer time showed every lesson an hour late and saved what they typed an
 * hour early, and students abroad (most of them) saw their lesson move at home because the timetable
 * was tied to Cairo. Winter here is Cairo +2 / Riyadh +3; Egypt goes forward again on 30 Apr 2027.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-11-17 08:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-clock@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Clock Teacher']);
    $this->student = $this->createStudent($this->academy, overrides: ['country' => 'SA', 'full_name' => 'Saudi Student']);
    $this->assignTeacher($this->academy, $this->student, $this->teacher);
});

afterEach(fn () => Carbon::setTestNow());

function utcOf(?object $row): string
{
    return Carbon::parse($row->scheduled_at_utc)->utc()->format('Y-m-d H:i');
}

// ── the device's clock decides nothing ──────────────────────────────────────

it('reads a lesson typed by hand on the academy clock, whatever zone the device sends', function () {
    Sanctum::actingAs($this->owner);
    // A PC in Egypt still on summer time (+3) reports itself as Riyadh.
    $id = $this->postJson('/api/sessions', [
        'student_id' => $this->student,
        'local_datetime' => '2026-11-20 17:00',
        'timezone' => 'Asia/Riyadh',
        'duration_minutes' => 30,
    ])->assertCreated()->json('sessionId');

    $this->asAcademy($this->academy);
    // 17:00 Cairo (+2), not 17:00 Riyadh (which would be 16:00 Cairo, an hour early).
    expect(utcOf(DB::table('sessions')->where('id', $id)->first()))->toBe('2026-11-20 15:00');
});

it('reads a rescheduled time on the academy clock, whatever zone the device sends', function () {
    $session = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-11-20 15:00:00+00', 'status' => 'SCHEDULED',
    ]);

    Sanctum::actingAs($this->owner);
    $successor = $this->postJson("/api/sessions/{$session}/reschedule", [
        'local_datetime' => '2026-11-21 19:30', 'timezone' => 'Asia/Riyadh',
    ])->assertCreated()->json('sessionId');

    $this->asAcademy($this->academy);
    expect(utcOf(DB::table('sessions')->where('id', $successor)->first()))->toBe('2026-11-21 17:30');
});

it('books a trial on the academy clock and files it under that clock', function () {
    Sanctum::actingAs($this->owner);
    $id = $this->postJson('/api/trials', [
        'teacher_id' => $this->teacher,
        'lead_name' => 'Lead',
        'lead_whatsapp' => '+201000000000',
        'local_datetime' => '2026-11-22 18:00',
        'timezone' => 'Asia/Riyadh',
        'duration_minutes' => 30,
    ])->assertCreated()->json('trialId');

    $this->asAcademy($this->academy);
    $trial = DB::table('trials')->where('id', $id)->first();
    expect(utcOf($trial))->toBe('2026-11-22 16:00')
        ->and($trial->timezone)->toBe('Africa/Cairo');
});

it('tells the panel which clock the academy runs on, and the server time', function () {
    Sanctum::actingAs($this->owner);
    $me = $this->getJson('/api/auth/me')->assertOk();

    expect($me->json('academy.timezone'))->toBe('Africa/Cairo')
        ->and(Carbon::parse($me->json('serverTime'))->equalTo(Carbon::now()))->toBeTrue();
});

// ── a timetable can follow the student's clock ──────────────────────────────

it('ties a timetable to the student\'s clock without moving a lesson, then follows that clock', function () {
    // Three weeks before Egypt goes forward (30 Apr 2027), so the window holds both sides of it.
    Carbon::setTestNow('2027-04-10 08:00:00');
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher, 'Africa/Cairo');
    $early = $this->addSlot($this->academy, $schedule, 0, '20:00:00'); // Sunday 20:00 Cairo
    $this->addSlot($this->academy, $schedule, 0, '21:00:00');          // an hour later: the move must not collide
    $late = $this->addSlot($this->academy, $schedule, 6, '23:30:00');  // Saturday 23:30 Cairo = Sunday 00:30 Riyadh

    $this->asAcademy($this->academy);
    $generator = app(SessionGenerator::class);
    [$from, $to] = SessionGenerator::defaultWindow();
    $generator->generateForSchedule($schedule, $from, $to);

    // One lesson already taught and marked.
    $marked = $this->createSession($this->academy, $this->student, $this->teacher, [
        'schedule_id' => $schedule, 'slot_id' => $early, 'occurrence_local_date' => '2027-04-04',
        'scheduled_at_utc' => '2027-04-04 18:00:00+00', 'status' => 'ATTENDED',
    ]);

    $this->asAcademy($this->academy);
    $beforeIds = DB::table('sessions')->where('schedule_id', $schedule)->orderBy('scheduled_at_utc')->pluck('scheduled_at_utc', 'id')
        ->map(fn ($at) => Carbon::parse($at)->utc()->format('Y-m-d H:i'))->all();
    // Before: Cairo-tied, so 20:00 Cairo is 18:00Z in April (+2) and 17:00Z in May (+3).
    expect(utcOf(DB::table('sessions')->where('slot_id', $early)->where('occurrence_local_date', '2027-04-18')->first()))->toBe('2027-04-18 18:00')
        ->and(utcOf(DB::table('sessions')->where('slot_id', $early)->where('occurrence_local_date', '2027-05-09')->first()))->toBe('2027-05-09 17:00');

    $result = app(ScheduleAnchor::class)->move($schedule, 'Asia/Riyadh');

    expect($result['moved'])->toBeTrue()
        ->and($result['slots'])->toBe([
            ['weekday' => 0, 'start_time_local' => '00:30'], // was Saturday 23:30 Cairo
            ['weekday' => 0, 'start_time_local' => '21:00'],
            ['weekday' => 0, 'start_time_local' => '22:00'],
        ])
        ->and(DB::table('schedules')->where('id', $schedule)->value('timezone'))->toBe('Asia/Riyadh');

    $after = DB::table('sessions')->where('schedule_id', $schedule)->get()->keyBy('id');

    // Same lessons, same ids. Up to the change every one is exactly where it was…
    expect($after->keys()->sort()->values()->all())->toBe(collect($beforeIds)->keys()->sort()->values()->all());
    foreach ($beforeIds as $id => $at) {
        if ($at < '2027-04-29 22:00') {
            expect(utcOf($after[$id]))->toBe($at);
        }
    }
    // …the marked one included, still on its slot…
    expect($after[$marked]->status)->toBe('ATTENDED')
        ->and($after[$marked]->slot_id)->toBe($early);
    // …and after it the lesson keeps the STUDENT's hour (21:00 Riyadh = 18:00Z), an hour later in Cairo.
    expect(utcOf(DB::table('sessions')->where('slot_id', $early)->where('occurrence_local_date', '2027-05-09')->first()))->toBe('2027-05-09 18:00');
    // A late-night lesson is filed under the day it falls on by the new clock.
    expect(DB::table('sessions')->where('slot_id', $late)->where('scheduled_at_utc', '2027-04-17 21:30:00+00')->value('occurrence_local_date'))->toBe('2027-04-18');

    // Running the nightly roll again changes nothing.
    expect($generator->generateForSchedule($schedule, $from, $to))->toBe(['created' => 0, 'removed' => 0]);
});

it('ties timetables to a clock from the panel, audited, and refuses a made-up zone', function () {
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher, 'Africa/Cairo');
    $this->addSlot($this->academy, $schedule, 2, '20:00:00');

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/clock/anchor', ['schedule_ids' => [$schedule], 'timezone' => 'Mars/Olympus'])->assertStatus(422);
    $this->postJson('/api/clock/anchor', ['schedule_ids' => [$schedule], 'timezone' => 'Asia/Riyadh'])
        ->assertOk()->assertJson(['moved' => 1, 'unchanged' => 0]);
    // Asking again is harmless.
    $this->postJson('/api/clock/anchor', ['schedule_ids' => [$schedule], 'timezone' => 'Asia/Riyadh'])
        ->assertOk()->assertJson(['moved' => 0, 'unchanged' => 1]);

    $this->asAcademy($this->academy);
    $slot = DB::table('schedule_slots')->where('schedule_id', $schedule)->first();
    expect(substr((string) $slot->start_time_local, 0, 5))->toBe('21:00')
        ->and(DB::table('audit_log')->where('action', 'schedule.reanchored')->where('entity_id', $schedule)->count())->toBe(1);

    // The timetable list gives the academy its own hour beside the student's.
    $row = collect($this->getJson('/api/timetables')->assertOk()->json('timetables'))->firstWhere('schedule_id', $schedule);
    expect($row['timezone'])->toBe('Asia/Riyadh')
        ->and($row['slots'][0]['start_time_local'])->toBe('21:00:00')
        ->and($row['slots'][0]['academy_time'])->toBe('20:00')
        ->and($row['slots'][0]['academy_weekday'])->toBe(2);
});

it('keeps a teacher from re-tying timetables', function () {
    $schedule = $this->createSchedule($this->academy, $this->student, $this->teacher, 'Africa/Cairo');
    $this->addSlot($this->academy, $schedule, 2, '20:00:00');
    $teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-clock@test.local']);

    Sanctum::actingAs($teacherUser);
    $this->postJson('/api/clock/anchor', ['schedule_ids' => [$schedule], 'timezone' => 'Asia/Riyadh'])->assertForbidden();
    $this->getJson('/api/clock/changes')->assertForbidden();
});

// ── warned before any country changes its time ──────────────────────────────

it('announces a coming clock change and counts the lessons it moves', function () {
    Carbon::setTestNow('2027-04-10 08:00:00');
    // On the academy clock: when Egypt goes forward, this Saudi student's lesson comes an hour EARLIER at home.
    $onCairo = $this->createSchedule($this->academy, $this->student, $this->teacher, 'Africa/Cairo');
    $this->addSlot($this->academy, $onCairo, 0, '20:00:00');
    // On his own clock: his hour holds, the academy sees it an hour LATER.
    $other = $this->createStudent($this->academy, overrides: ['country' => 'SA', 'full_name' => 'Tied Student']);
    $onRiyadh = $this->createSchedule($this->academy, $other, $this->teacher, 'Asia/Riyadh');
    $this->addSlot($this->academy, $onRiyadh, 1, '21:00:00');
    // At home in Egypt: nothing moves for anyone.
    $local = $this->createStudent($this->academy, overrides: ['country' => 'EG']);
    $home = $this->createSchedule($this->academy, $local, $this->teacher, 'Africa/Cairo');
    $this->addSlot($this->academy, $home, 3, '18:00:00');

    Sanctum::actingAs($this->owner);
    $res = $this->getJson('/api/clock/changes')->assertOk();

    $change = collect($res->json('changes'))->firstWhere('date', '2027-04-30');
    expect($change)->not->toBeNull()
        ->and($change['past'])->toBeFalse()
        ->and($change['places'][0])->toMatchArray(['country' => 'EG', 'shift_minutes' => 60, 'is_academy' => true])
        ->and($change['moving_for_student'])->toBe(1)
        ->and($change['student_shift_minutes'])->toBe(-60)
        ->and($change['moving_on_academy_clock'])->toBe(1)
        ->and($change['academy_shift_minutes'])->toBe(60);

    $saudi = collect($res->json('abroad'))->firstWhere('country', 'SA');
    expect($saudi['suggested'])->toBe('Asia/Riyadh')
        ->and($saudi['gap_minutes'])->toBe(60)
        ->and($saudi['on_own_clock'])->toBe(1)
        ->and(array_column($saudi['on_academy_clock'], 'schedule_id'))->toBe([$onCairo]);
});

it('knows the clocks of a country with several, and the rules of any zone', function () {
    expect(CountryClocks::usual('sa'))->toBe('Asia/Riyadh')
        ->and(CountryClocks::usual('OM'))->toBe('Asia/Muscat')
        ->and(array_column(CountryClocks::zones('CA'), 'timezone'))->toContain('America/Toronto', 'America/Vancouver')
        ->and(CountryClocks::usual('Egypt'))->toBeNull()
        ->and(CountryClocks::countryOf('America/Toronto'))->toBe('CA');

    // Canada goes forward on 14 Mar 2027; Saudi Arabia never changes.
    $year = [Carbon::parse('2027-01-01')->getTimestamp(), Carbon::parse('2027-06-30')->getTimestamp()];
    $toronto = CountryClocks::changes('America/Toronto', ...$year);
    expect($toronto)->toHaveCount(1)
        ->and($toronto[0]['shift_minutes'])->toBe(60)
        ->and(Carbon::createFromTimestamp($toronto[0]['at'], 'America/Toronto')->format('Y-m-d'))->toBe('2027-03-14')
        ->and(CountryClocks::changes('Asia/Riyadh', ...$year))->toBe([]);

    // Sunday 00:30 Riyadh is still Saturday 23:30 in Cairo (winter).
    expect(ScheduleAnchor::onClock(0, '00:30', 'Asia/Riyadh', 'Africa/Cairo', Carbon::parse('2026-11-17')))->toBe(['weekday' => 6, 'time' => '23:30']);
});
