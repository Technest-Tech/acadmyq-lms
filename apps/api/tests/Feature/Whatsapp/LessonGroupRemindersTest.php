<?php

declare(strict_types=1);

use App\Jobs\LessonReminderJob;
use App\Services\ModuleBilling;
use App\Services\Whatsapp\GroupAlerts;
use App\Services\Whatsapp\WhatsAppSender;
use App\Support\FeatureCatalog;
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
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * Lesson reminders in WhatsApp groups: the Super Admin switches the feature on, the academy assigns
 * a group to a student and a teacher, and every lesson is announced there ahead of time and at its
 * start. The gateway is faked; the clock is frozen at 13:00 UTC (15:00 in Cairo).
 */
beforeEach(function () {
    Carbon::setTestNow('2026-11-03 13:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['timezone' => 'Africa/Cairo'], modules: ['MANAGEMENT', 'WHATSAPP']);
    giveWhatsAppToken($this->academy, 'tok-R');
    switchReminders($this->academy, true);

    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Mona Teacher']);
    $this->omar = $this->createStudent($this->academy, overrides: ['full_name' => 'Omar Pupil']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-rem@test.local']);

    $this->gateway = [
        'admin_state' => 'connected',
        'status' => 'CONNECTED',
        'send' => 200,
        'queue' => ['queueDepth' => 0, 'sentToday' => 0, 'dailyCap' => 500],
        'groups' => [
            ['id' => '111-1@g.us', 'subject' => 'Omar family', 'size' => 4, 'announce' => false, 'isAdmin' => false, 'canSend' => true],
            ['id' => '222-2@g.us', 'subject' => 'Mona teacher', 'size' => 3, 'announce' => false, 'isAdmin' => true, 'canSend' => true],
            ['id' => '333-3@g.us', 'subject' => 'Announcements', 'size' => 9, 'announce' => true, 'isAdmin' => false, 'canSend' => false],
        ],
    ];
    $this->sends = 0;
    Http::fake([
        '*/sessions/*/status' => fn () => Http::response(['state' => $this->gateway['admin_state'], 'phoneJid' => '201001234567@s.whatsapp.net'], 200),
        '*/api/status' => fn () => Http::response(['status' => $this->gateway['status'], ...$this->gateway['queue']], 200),
        '*/api/groups' => fn () => Http::response(['groups' => $this->gateway['groups']], 200),
        '*/api/messages/*' => fn () => Http::response(['state' => 'queued'], 200),
        '*/api/send-message' => function () {
            $this->sends++;

            return $this->gateway['send'] === 200
                ? Http::response(['data' => ['msgId' => 'wamid.'.$this->sends]], 200)
                : Http::response(['error' => 'boom'], $this->gateway['send']);
        },
    ]);
});

afterEach(fn () => Carbon::setTestNow());

function switchReminders(string $academyId, bool $on, bool $launched = true): void
{
    test()->enterAcademyAsSuperAdmin($academyId);
    app(ModuleBilling::class)->setDisabledFeatures($academyId, 'WHATSAPP', [], $on ? ['whatsapp.group_reminders'] : []);
    // The academy presses "launch" on its WhatsApp page; the engine tests start from there.
    reminderSettings($academyId, ['lesson_reminders_live' => $on && $launched]);
    test()->clearTenantContext();
}

/** Write the academy's reminder choices straight to the table (the routes have their own tests). */
function reminderSettings(string $academyId, array $fields): void
{
    test()->enterAcademyAsSuperAdmin($academyId);
    $updated = DB::table('academy_automation_settings')->where('academy_id', $academyId)->update($fields);
    if ($updated === 0) {
        DB::table('academy_automation_settings')->insert($fields + ['academy_id' => $academyId]);
    }
    test()->clearTenantContext();
}

/** Assign a group straight in the tables (the route has its own tests below). */
function assignReminderGroup(string $academyId, string $table, string $personId, string $jid, array $overrides = []): string
{
    test()->enterAcademyAsSuperAdmin($academyId);
    $id = DB::table('whatsapp_groups')->where('academy_id', $academyId)->where('jid', $jid)->value('id');
    if ($id === null) {
        $id = (string) Str::uuid();
        DB::table('whatsapp_groups')->insert(array_merge([
            'id' => $id,
            'academy_id' => $academyId,
            'jid' => $jid,
            'name' => 'Group '.$jid,
            'language' => 'en',
            'kind' => 'LESSON',
        ], $overrides));
    }
    DB::table($table)->where('id', $personId)->update(['whatsapp_group_id' => $id]);
    test()->clearTenantContext();

    return (string) $id;
}

function reminderLesson(string $academyId, string $studentId, string $teacherId, string $startsAt, array $overrides = []): string
{
    test()->enterAcademyAsSuperAdmin($academyId);
    $id = (string) Str::uuid();
    DB::table('sessions')->insert(array_merge([
        'id' => $id,
        'academy_id' => $academyId,
        'student_id' => $studentId,
        'teacher_id' => $teacherId,
        'occurrence_local_date' => substr($startsAt, 0, 10),
        'scheduled_at_utc' => $startsAt,
        'duration_minutes' => 60,
        'status' => 'SCHEDULED',
    ], $overrides));
    test()->clearTenantContext();

    return $id;
}

/** A running class with these students on its roster and one lesson at $startsAt. */
function reminderClass(string $academyId, string $teacherId, array $studentIds, string $startsAt, array $overrides = []): string
{
    test()->enterAcademyAsSuperAdmin($academyId);
    $class = (string) Str::uuid();
    DB::table('class_groups')->insert(array_merge([
        'id' => $class,
        'academy_id' => $academyId,
        'name' => 'English A',
        'teacher_id' => $teacherId,
        'timezone' => 'Africa/Cairo',
        'start_date' => '2026-10-01',
    ], $overrides));
    foreach ($studentIds as $student) {
        DB::table('class_group_members')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $academyId,
            'group_id' => $class,
            'student_id' => $student,
            'joined_on' => '2026-10-01',
            'status' => 'ACTIVE',
        ]);
    }
    DB::table('class_group_lessons')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $academyId,
        'group_id' => $class,
        'teacher_id' => $teacherId,
        'occurrence_local_date' => substr($startsAt, 0, 10),
        'scheduled_at_utc' => $startsAt,
        'duration_minutes' => 60,
        'status' => 'SCHEDULED',
    ]);
    test()->clearTenantContext();

    return $class;
}

function reminderSweep(string $academyId, string $at): void
{
    app(GroupAlerts::class)->runForAcademy($academyId, CarbonImmutable::parse($at));
}

/** @return list<array{to: string, text: string}> */
function reminderSends(): array
{
    return Http::recorded(fn (HttpRequest $req) => str_contains($req->url(), '/api/send-message'))
        ->map(fn (array $pair) => ['to' => (string) $pair[0]['to'], 'text' => (string) $pair[0]['text']])
        ->values()
        ->all();
}

/** @return list<object> */
function reminderRows(string $academyId): array
{
    test()->enterAcademyAsSuperAdmin($academyId);
    $rows = DB::table('whatsapp_group_alerts')->where('academy_id', $academyId)->orderBy('created_at')->get()->all();
    test()->clearTenantContext();

    return $rows;
}

// ── The engine ───────────────────────────────────────────────────────────────

it('reminds the student and the teacher group ahead of a lesson, then again at its start', function () {
    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    assignReminderGroup($this->academy, 'teachers', $this->teacher, '222-2@g.us');
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:30:00+00');

    // Too early: the lesson is 31 minutes out with the default 30-minute lead.
    reminderSweep($this->academy, '2026-11-03 12:59:00+00');
    expect(reminderSends())->toHaveCount(0);

    reminderSweep($this->academy, '2026-11-03 13:00:30+00');
    $sends = reminderSends();
    expect($sends)->toHaveCount(2)
        ->and(array_column($sends, 'to'))->toEqualCanonicalizing(['111-1@g.us', '222-2@g.us'])
        ->and($sends[0]['text'])->toContain('Lesson reminder')
        ->and($sends[0]['text'])->toContain('3:30 PM')
        ->and($sends[0]['text'])->toContain('Mona Teacher with Omar Pupil')
        ->and($sends[0]['text'])->toContain('in 30 min');

    // Nothing new in between: each stage goes out once.
    reminderSweep($this->academy, '2026-11-03 13:15:00+00');
    expect(reminderSends())->toHaveCount(2);

    reminderSweep($this->academy, '2026-11-03 13:30:20+00');
    $sends = reminderSends();
    expect($sends)->toHaveCount(4)
        ->and($sends[2]['text'])->toContain('Lesson starting now');

    reminderSweep($this->academy, '2026-11-03 13:31:00+00');
    expect(reminderSends())->toHaveCount(4);
});

it('sends one message when the student and the teacher share a group', function () {
    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    assignReminderGroup($this->academy, 'teachers', $this->teacher, '111-1@g.us');
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:20:00+00');

    reminderSweep($this->academy, '2026-11-03 13:00:00+00');

    expect(reminderSends())->toHaveCount(1);
});

it('sends nothing unless a Super Admin switched the feature on', function () {
    switchReminders($this->academy, false);
    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:20:00+00');

    reminderSweep($this->academy, '2026-11-03 13:00:00+00');

    expect(reminderSends())->toHaveCount(0)
        ->and(reminderRows($this->academy))->toHaveCount(0);
});

it('stays quiet for a lesson that is cancelled, hidden or awaiting a cancellation decision', function () {
    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:10:00+00', ['status' => 'CANCELLED_BY_TEACHER']);
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:12:00+00', ['hidden_at' => '2026-11-03 10:00:00+00']);
    $pending = reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:14:00+00');
    $this->enterAcademyAsSuperAdmin($this->academy);
    DB::table('session_cancellation_requests')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'session_id' => $pending,
        'teacher_id' => $this->teacher,
        'requested_by_user_id' => $this->owner->id,
        'cancel_type' => 'teacher',
        'status' => 'PENDING',
        'request_type' => 'CANCEL',
        'reason' => 'x',
    ]);
    $this->clearTenantContext();

    reminderSweep($this->academy, '2026-11-03 13:00:00+00');

    expect(reminderSends())->toHaveCount(0);
});

it('drops a reminder still waiting when its lesson is cancelled', function () {
    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    $lesson = reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:20:00+00');

    $this->gateway['status'] = 'DISCONNECTED';
    reminderSweep($this->academy, '2026-11-03 13:00:00+00');
    expect(reminderRows($this->academy)[0]->status)->toBe('PENDING');

    $this->enterAcademyAsSuperAdmin($this->academy);
    DB::table('sessions')->where('id', $lesson)->update(['status' => 'CANCELLED_BY_TEACHER']);
    $this->clearTenantContext();
    $this->gateway['status'] = 'CONNECTED';
    reminderSweep($this->academy, '2026-11-03 13:01:00+00');

    expect(reminderSends())->toHaveCount(0)
        ->and(reminderRows($this->academy)[0]->status)->toBe('SKIPPED');
});

it('reminds again at the new time when a lesson is moved', function () {
    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    $lesson = reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:20:00+00');

    reminderSweep($this->academy, '2026-11-03 13:00:00+00');
    expect(reminderSends())->toHaveCount(1);

    $this->enterAcademyAsSuperAdmin($this->academy);
    DB::table('sessions')->where('id', $lesson)->update(['scheduled_at_utc' => '2026-11-03 15:00:00+00']);
    $this->clearTenantContext();

    reminderSweep($this->academy, '2026-11-03 14:35:00+00');

    $sends = reminderSends();
    expect($sends)->toHaveCount(2)
        ->and($sends[1]['text'])->toContain('5:00 PM');
});

it('does not flood the group when the number reconnects after the lessons have gone', function () {
    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:20:00+00');

    // Down for the reminder ahead and for the start.
    $this->gateway['status'] = 'DISCONNECTED';
    reminderSweep($this->academy, '2026-11-03 13:00:00+00');
    reminderSweep($this->academy, '2026-11-03 13:20:30+00');

    $this->gateway['status'] = 'CONNECTED';
    reminderSweep($this->academy, '2026-11-03 13:45:00+00');

    expect(reminderSends())->toHaveCount(0)
        ->and(array_column(reminderRows($this->academy), 'status'))->each->toBe('EXPIRED');
});

it('keeps the gateway queue shallow, and the "starting now" goes first', function () {
    $this->gateway['queue']['queueDepth'] = 8; // room for two more
    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:15:00+00');
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:16:00+00');
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:17:00+00');
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 12:59:30+00');

    reminderSweep($this->academy, '2026-11-03 13:00:00+00');

    $rows = collect(reminderRows($this->academy));
    expect($rows)->toHaveCount(4)
        ->and($rows->where('status', 'QUEUED'))->toHaveCount(2)
        ->and($rows->where('status', 'PENDING'))->toHaveCount(2)
        ->and($rows->firstWhere('event_type', 'LESSON_STARTING')->status)->toBe('QUEUED');
});

it('holds reminders back near the daily cap so bills and reports still go out', function () {
    $this->gateway['queue'] = ['queueDepth' => 0, 'sentToday' => 450, 'dailyCap' => 500];
    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:15:00+00');

    reminderSweep($this->academy, '2026-11-03 13:00:00+00');

    expect(reminderSends())->toHaveCount(0)
        ->and(reminderRows($this->academy)[0]->status)->toBe('PENDING');
});

it('still sends a small batch through a gateway that does not report its queue', function () {
    $this->gateway['queue'] = [];
    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:15:00+00');

    reminderSweep($this->academy, '2026-11-03 13:00:00+00');

    expect(reminderSends())->toHaveCount(1);
});

it('retries a failed send, and only while the reminder is still owed', function () {
    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:20:00+00');

    $this->gateway['send'] = 500;
    reminderSweep($this->academy, '2026-11-03 13:00:00+00');
    expect(reminderRows($this->academy)[0]->status)->toBe('FAILED');

    $this->gateway['send'] = 200;
    reminderSweep($this->academy, '2026-11-03 13:02:00+00');
    expect(reminderRows($this->academy)[0]->status)->toBe('QUEUED');
});

it('uses the lead the academy chose, and can drop either stage', function () {
    $this->enterAcademyAsSuperAdmin($this->academy);
    DB::table('academy_automation_settings')->where('academy_id', $this->academy)
        ->update(['lesson_reminder_lead_minutes' => 60, 'lesson_reminder_at_start' => false]);
    $this->clearTenantContext();
    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:50:00+00');

    reminderSweep($this->academy, '2026-11-03 13:00:00+00');
    expect(reminderSends())->toHaveCount(1);

    reminderSweep($this->academy, '2026-11-03 13:50:30+00');
    expect(reminderSends())->toHaveCount(1);
});

it('writes the message in Arabic by default', function () {
    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us', ['language' => 'ar']);
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:30:00+00');

    reminderSweep($this->academy, '2026-11-03 13:00:00+00');

    expect(reminderSends()[0]['text'])->toContain('تذكير بموعد الحصة')
        ->and(reminderSends()[0]['text'])->toContain('3:30 م')
        ->and(reminderSends()[0]['text'])->toContain('بعد 30 دقيقة');
});

it('announces a free trial to the teacher group, and never prints the prospect number', function () {
    assignReminderGroup($this->academy, 'teachers', $this->teacher, '222-2@g.us');
    $this->enterAcademyAsSuperAdmin($this->academy);
    DB::table('trials')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'teacher_id' => $this->teacher,
        'lead_name' => 'Prospect Sara',
        'lead_whatsapp' => '+201000000009',
        'timezone' => 'Africa/Cairo',
        'scheduled_at_utc' => '2026-11-03 13:15:00+00',
        'duration_minutes' => 30,
        'status' => 'SCHEDULED',
    ]);
    $this->clearTenantContext();

    reminderSweep($this->academy, '2026-11-03 13:00:00+00');

    $sends = reminderSends();
    expect($sends)->toHaveCount(1)
        ->and($sends[0]['text'])->toContain('Trial: Mona Teacher with Prospect Sara')
        ->and($sends[0]['text'])->not->toContain('+201000000009');
});

it('announces a group-class lesson to its teacher and to the students on its roster only', function () {
    $left = $this->createStudent($this->academy, overrides: ['full_name' => 'Left Pupil']);
    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    assignReminderGroup($this->academy, 'students', $left, '444-4@g.us');
    assignReminderGroup($this->academy, 'teachers', $this->teacher, '222-2@g.us');

    $this->enterAcademyAsSuperAdmin($this->academy);
    $class = (string) Str::uuid();
    DB::table('class_groups')->insert([
        'id' => $class,
        'academy_id' => $this->academy,
        'name' => 'English A',
        'teacher_id' => $this->teacher,
        'timezone' => 'Africa/Cairo',
        'start_date' => '2026-10-01',
    ]);
    foreach ([[$this->omar, '2026-10-01', null], [$left, '2026-10-01', '2026-11-01']] as [$student, $joined, $leftOn]) {
        DB::table('class_group_members')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $this->academy,
            'group_id' => $class,
            'student_id' => $student,
            'joined_on' => $joined,
            'left_on' => $leftOn,
            'status' => $leftOn === null ? 'ACTIVE' : 'LEFT',
        ]);
    }
    DB::table('class_group_lessons')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'group_id' => $class,
        'teacher_id' => $this->teacher,
        'occurrence_local_date' => '2026-11-03',
        'scheduled_at_utc' => '2026-11-03 13:15:00+00',
        'duration_minutes' => 60,
        'status' => 'SCHEDULED',
    ]);
    $this->clearTenantContext();

    reminderSweep($this->academy, '2026-11-03 13:00:00+00');

    $sends = reminderSends();
    expect(array_column($sends, 'to'))->toEqualCanonicalizing(['111-1@g.us', '222-2@g.us'])
        ->and($sends[0]['text'])->toContain('group English A');
});

// ── The WhatsApp page: launch, channel, audience ─────────────────────────────

it('sends nothing until the academy launches the reminders', function () {
    switchReminders($this->academy, true, launched: false);
    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    assignReminderGroup($this->academy, 'teachers', $this->teacher, '222-2@g.us');
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:20:00+00');

    reminderSweep($this->academy, '2026-11-03 13:00:00+00');

    expect(reminderSends())->toHaveCount(0)
        ->and(reminderRows($this->academy))->toHaveCount(0);
});

it('messages the family and the teacher privately when the academy chooses private', function () {
    reminderSettings($this->academy, ['lesson_reminder_channel' => 'PRIVATE', 'lesson_reminder_language' => 'en']);
    $this->enterAcademyAsSuperAdmin($this->academy);
    $guardian = DB::table('students')->where('id', $this->omar)->value('guardian_id');
    DB::table('guardians')->where('id', $guardian)->update(['whatsapp_phone' => '+201000000001']);
    DB::table('teachers')->where('id', $this->teacher)->update(['phone' => '+201000000002']);
    $this->clearTenantContext();
    // A group assigned to them is not used: private was chosen.
    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:20:00+00');

    reminderSweep($this->academy, '2026-11-03 13:00:00+00');

    $sends = reminderSends();
    expect(array_column($sends, 'to'))->toEqualCanonicalizing(['+201000000001', '+201000000002'])
        ->and($sends[0]['text'])->toContain('Mona Teacher with Omar Pupil')
        ->and($sends[0]['text'])->toContain('in 20 min');

    $rows = collect(reminderRows($this->academy));
    expect($rows->pluck('group_id')->filter())->toBeEmpty()
        ->and($rows->pluck('recipient_kind')->all())->toEqualCanonicalizing(['GUARDIAN', 'TEACHER'])
        ->and($rows->pluck('status')->unique()->all())->toBe(['QUEUED']);

    // …and again when it starts, once.
    reminderSweep($this->academy, '2026-11-03 13:20:10+00');
    reminderSweep($this->academy, '2026-11-03 13:21:00+00');
    expect(reminderSends())->toHaveCount(4);

    $this->enterAcademyAsSuperAdmin($this->academy);
    expect(DB::table('automation_send_log')->where('automation_type', 'TYPE2_LESSON')->count())->toBe(4);
});

it('reaches only the audience the academy chose, in groups and in private', function () {
    reminderSettings($this->academy, ['lesson_reminder_channel' => 'BOTH', 'lesson_reminder_audience' => 'TEACHERS']);
    $this->enterAcademyAsSuperAdmin($this->academy);
    DB::table('teachers')->where('id', $this->teacher)->update(['phone' => '+201000000002']);
    $this->clearTenantContext();
    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    assignReminderGroup($this->academy, 'teachers', $this->teacher, '222-2@g.us');
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:20:00+00');

    reminderSweep($this->academy, '2026-11-03 13:00:00+00');

    expect(array_column(reminderSends(), 'to'))->toEqualCanonicalizing(['222-2@g.us', '+201000000002']);
});

it('sends a parent of two children in the same class one private message', function () {
    reminderSettings($this->academy, ['lesson_reminder_channel' => 'PRIVATE', 'lesson_reminder_audience' => 'STUDENTS', 'lesson_reminder_language' => 'en']);
    $family = $this->createGuardian($this->academy, ['whatsapp_phone' => '+201000000009']);
    $sara = $this->createStudent($this->academy, $family, ['full_name' => 'Sara Pupil']);
    $adam = $this->createStudent($this->academy, $family, ['full_name' => 'Adam Pupil']);
    reminderClass($this->academy, $this->teacher, [$sara, $adam], '2026-11-03 13:15:00+00');

    reminderSweep($this->academy, '2026-11-03 13:00:00+00');

    $sends = reminderSends();
    expect($sends)->toHaveCount(1)
        ->and($sends[0]['to'])->toBe('+201000000009')
        ->and($sends[0]['text'])->toContain('group English A');
});

it('announces a class lesson in the class\'s own WhatsApp group', function () {
    $sara = $this->createStudent($this->academy, overrides: ['full_name' => 'Sara Pupil']);
    $class = reminderClass($this->academy, $this->teacher, [$sara], '2026-11-03 13:15:00+00');
    $this->enterAcademyAsSuperAdmin($this->academy);
    $group = (string) Str::uuid();
    DB::table('whatsapp_groups')->insert(['id' => $group, 'academy_id' => $this->academy, 'jid' => '555-5@g.us', 'name' => 'English A', 'language' => 'en', 'kind' => 'LESSON']);
    DB::table('class_groups')->where('id', $class)->update(['whatsapp_group_id' => $group]);
    $this->clearTenantContext();

    reminderSweep($this->academy, '2026-11-03 13:00:00+00');

    expect(array_column(reminderSends(), 'to'))->toBe(['555-5@g.us']);
});

it('leaves the old hourly private reminders to academies without the WhatsApp page', function () {
    reminderSettings($this->academy, ['type2_lessons_enabled' => true, 'type2_recipients' => 'BOTH']);
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:20:00+00');

    $sent = (new LessonReminderJob($this->academy))->handle(app(WhatsAppSender::class));

    expect($sent[$this->academy])->toBe(0)
        ->and(reminderSends())->toHaveCount(0);
});

// ── The academy's screen ─────────────────────────────────────────────────────

it('answers 402 until the feature is switched on', function () {
    switchReminders($this->academy, false);
    Sanctum::actingAs($this->owner);

    $this->getJson('/api/lesson-reminders')->assertStatus(402);
    $this->putJson("/api/lesson-reminders/assignments/student/{$this->omar}", ['jid' => '111-1@g.us'])->assertStatus(402);
});

it('assigns a group the number can post in, and clears it', function () {
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/lesson-reminders/assignments/student/{$this->omar}", ['jid' => '111-1@g.us'])
        ->assertOk()
        ->assertJsonPath('person.group.jid', '111-1@g.us')
        ->assertJsonPath('person.group.name', 'Omar family');

    $this->getJson("/api/lesson-reminders/assignments/student/{$this->omar}")
        ->assertOk()
        ->assertJsonPath('person.group.name', 'Omar family');

    $this->putJson("/api/lesson-reminders/assignments/student/{$this->omar}", ['jid' => null])
        ->assertOk()
        ->assertJsonPath('person.group', null);
});

it('refuses a group the number has left, or where only admins may post', function () {
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/lesson-reminders/assignments/teacher/{$this->teacher}", ['jid' => '999-9@g.us'])
        ->assertStatus(422)
        ->assertJsonPath('error', 'not_a_member');

    $this->putJson("/api/lesson-reminders/assignments/teacher/{$this->teacher}", ['jid' => '333-3@g.us'])
        ->assertStatus(422)
        ->assertJsonPath('error', 'admins_only');
});

it('explains when the number is not connected', function () {
    $this->enterAcademyAsSuperAdmin($this->academy);
    DB::table('academy_automation_settings')->where('academy_id', $this->academy)->update(['wasender_token' => null]);
    $this->clearTenantContext();
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/lesson-reminders/assignments/student/{$this->omar}", ['jid' => '111-1@g.us'])
        ->assertStatus(409)
        ->assertJsonPath('error', 'not_connected');
});

it('lists people with their groups, and filters the ones still without one', function () {
    $laila = $this->createStudent($this->academy, overrides: ['full_name' => 'Laila Pupil']);
    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    Sanctum::actingAs($this->owner);

    $all = $this->getJson('/api/lesson-reminders/assignments?kind=student')->assertOk();
    expect($all->json('total'))->toBe(2);

    $open = $this->getJson('/api/lesson-reminders/assignments?kind=student&filter[assigned]=no')->assertOk();
    expect($open->json('total'))->toBe(1)
        ->and($open->json('rows.0.id'))->toBe($laila);
});

it('lists the number\'s groups and how many people use each', function () {
    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    Sanctum::actingAs($this->owner);

    $groups = collect($this->getJson('/api/lesson-reminders/groups')->assertOk()->json('groups'))->keyBy('jid');

    expect($groups['111-1@g.us']['assigned_students'])->toBe(1)
        ->and($groups['333-3@g.us']['can_send'])->toBeFalse();
});

it('saves the timing, and moves the assigned groups to the chosen language', function () {
    $group = assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us', ['language' => 'ar']);
    Sanctum::actingAs($this->owner);

    $this->putJson('/api/lesson-reminders/settings', ['lead_minutes' => 60, 'at_start' => false, 'language' => 'en'])
        ->assertOk()
        ->assertJsonPath('settings.lead_minutes', 60);
    $this->putJson('/api/lesson-reminders/settings', ['lead_minutes' => 37, 'at_start' => false, 'language' => 'en'])
        ->assertStatus(422);

    $this->getJson('/api/lesson-reminders')->assertOk()->assertJsonPath('settings.at_start', false);

    $this->clearTenantContext();
    $this->enterAcademyAsSuperAdmin($this->academy);
    expect(DB::table('whatsapp_groups')->where('id', $group)->value('language'))->toBe('en');
});

it('reports how the last day went and what the next one will take', function () {
    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    assignReminderGroup($this->academy, 'teachers', $this->teacher, '222-2@g.us');
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:20:00+00');
    reminderSweep($this->academy, '2026-11-03 13:00:00+00');
    Sanctum::actingAs($this->owner);

    $res = $this->getJson('/api/lesson-reminders')->assertOk();

    expect($res->json('capacity.daily_cap'))->toBe(500)
        ->and($res->json('capacity.expected_next_day'))->toBe(4) // one lesson × two groups × two stages
        ->and($res->json('assigned.students'))->toBe(['assigned' => 1, 'total' => 1])
        ->and($res->json('last_day.waiting'))->toBe(2);
});

it('launches only with the number linked and someone to reach, and stops', function () {
    switchReminders($this->academy, true, launched: false);
    Sanctum::actingAs($this->owner);

    // Groups, but none assigned yet.
    $this->postJson('/api/lesson-reminders/launch')->assertStatus(422)->assertJsonPath('error', 'nobody_to_remind');

    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    $this->gateway['admin_state'] = 'disconnected';
    $this->postJson('/api/lesson-reminders/launch')->assertStatus(409)->assertJsonPath('error', 'not_connected');

    $this->gateway['admin_state'] = 'connected';
    $this->postJson('/api/lesson-reminders/launch')->assertOk()
        ->assertJsonPath('settings.live', true)
        ->assertJsonPath('settings.channel', 'GROUPS');

    // Launched: the next lesson is announced; stopping drops what is still waiting.
    $this->gateway['status'] = 'DISCONNECTED';
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:20:00+00');
    reminderSweep($this->academy, '2026-11-03 13:00:00+00');
    expect(collect(reminderRows($this->academy))->pluck('status')->all())->toBe(['PENDING']);

    $this->postJson('/api/lesson-reminders/stop')->assertOk()->assertJsonPath('settings.live', false);
    $row = reminderRows($this->academy)[0];
    expect($row->status)->toBe('SKIPPED')->and($row->error)->toBe('alert_turned_off');

    $this->gateway['status'] = 'CONNECTED';
    reminderSweep($this->academy, '2026-11-03 13:01:00+00');
    expect(reminderSends())->toHaveCount(0);
});

it('launches private reminders on the numbers on file alone', function () {
    switchReminders($this->academy, true, launched: false);
    Sanctum::actingAs($this->owner);
    $this->putJson('/api/lesson-reminders/settings', [
        'lead_minutes' => 30, 'at_start' => true, 'language' => 'ar', 'channel' => 'PRIVATE', 'audience' => 'STUDENTS',
    ])->assertOk()->assertJsonPath('settings.channel', 'PRIVATE')->assertJsonPath('settings.audience', 'STUDENTS');

    $this->postJson('/api/lesson-reminders/launch')->assertOk()->assertJsonPath('settings.live', true);
});

it('drops private reminders still waiting when the academy goes back to groups only', function () {
    reminderSettings($this->academy, ['lesson_reminder_channel' => 'PRIVATE']);
    $this->gateway['status'] = 'DISCONNECTED';
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:20:00+00');
    reminderSweep($this->academy, '2026-11-03 13:00:00+00');
    expect(collect(reminderRows($this->academy))->pluck('status')->unique()->all())->toBe(['PENDING']);
    Sanctum::actingAs($this->owner);

    $this->putJson('/api/lesson-reminders/settings', ['lead_minutes' => 30, 'at_start' => true, 'language' => 'ar', 'channel' => 'GROUPS'])
        ->assertOk();

    // No group is linked, so the sweep never comes back for them: the save itself retires them.
    expect(collect(reminderRows($this->academy))->pluck('status')->unique()->all())->toBe(['SKIPPED']);
});

it('keeps the launch to whoever runs the settings, and refuses an unknown channel', function () {
    $front = $this->makeUser($this->academy, 'CUSTOMER_SERVICE', ['email' => 'front-launch@test.local']);
    Sanctum::actingAs($front);
    $this->postJson('/api/lesson-reminders/launch')->assertForbidden();
    $this->postJson('/api/lesson-reminders/stop')->assertForbidden();

    Sanctum::actingAs($this->owner);
    $this->putJson('/api/lesson-reminders/settings', ['lead_minutes' => 30, 'at_start' => true, 'language' => 'ar', 'channel' => 'SMS'])
        ->assertStatus(422);
});

it('counts who has a number for private messages', function () {
    $this->enterAcademyAsSuperAdmin($this->academy);
    // The demo teacher has no number on file; the student's family has one.
    DB::table('teachers')->where('id', $this->teacher)->update(['phone' => null]);
    $this->clearTenantContext();
    Sanctum::actingAs($this->owner);

    $res = $this->getJson('/api/lesson-reminders')->assertOk();

    expect($res->json('phones.students'))->toBe(['with_phone' => 1, 'total' => 1])
        ->and($res->json('phones.teachers'))->toBe(['with_phone' => 0, 'total' => 1])
        ->and($res->json('whatsapp.state'))->toBe('connected');
});

it('assigns a WhatsApp group to a class, and lists the classes', function () {
    $class = reminderClass($this->academy, $this->teacher, [$this->omar], '2026-11-04 13:15:00+00');
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/lesson-reminders/assignments/class/{$class}", ['jid' => '111-1@g.us'])
        ->assertOk()
        ->assertJsonPath('person.name', 'English A')
        ->assertJsonPath('person.group.jid', '111-1@g.us');

    $list = $this->getJson('/api/lesson-reminders/assignments?kind=class')->assertOk();
    expect($list->json('total'))->toBe(1)
        ->and($list->json('rows.0.group.name'))->toBe('Omar family');

    $groups = collect($this->getJson('/api/lesson-reminders/groups')->assertOk()->json('groups'))->keyBy('jid');
    expect($groups['111-1@g.us']['assigned_classes'])->toBe(1);
    $this->getJson('/api/lesson-reminders')->assertOk()->assertJsonPath('assigned.classes', ['assigned' => 1, 'total' => 1]);
});

it('names the person a private reminder went to in the log', function () {
    reminderSettings($this->academy, ['lesson_reminder_channel' => 'PRIVATE', 'lesson_reminder_audience' => 'STUDENTS']);
    reminderLesson($this->academy, $this->omar, $this->teacher, '2026-11-03 13:20:00+00');
    reminderSweep($this->academy, '2026-11-03 13:00:00+00');
    Sanctum::actingAs($this->owner);

    $this->getJson('/api/lesson-reminders/log')->assertOk()
        ->assertJsonPath('rows.0.channel', 'PRIVATE')
        ->assertJsonPath('rows.0.group_name', 'Omar Pupil')
        ->assertJsonPath('rows.0.recipient_kind', 'GUARDIAN');
});

it('sends a test into a group, through the real delivery path', function () {
    $group = assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/lesson-reminders/groups/{$group}/test")->assertOk()->assertJsonPath('ok', true);

    expect(reminderSends()[0]['to'])->toBe('111-1@g.us')
        ->and(reminderSends()[0]['text'])->toContain('lesson reminders');
});

it('lets a role that edits students assign, but not change the timing', function () {
    $front = $this->makeUser($this->academy, 'CUSTOMER_SERVICE', ['email' => 'front-rem@test.local']);
    Sanctum::actingAs($front);

    $this->putJson("/api/lesson-reminders/assignments/student/{$this->omar}", ['jid' => '111-1@g.us'])->assertOk();
    $this->putJson("/api/lesson-reminders/assignments/teacher/{$this->teacher}", ['jid' => '111-1@g.us'])->assertForbidden();
    $this->putJson('/api/lesson-reminders/settings', ['lead_minutes' => 60, 'at_start' => true, 'language' => 'ar'])->assertForbidden();
});

it('keeps a teacher out of the assignments', function () {
    $user = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-rem@test.local']);
    Sanctum::actingAs($user);

    $this->getJson('/api/lesson-reminders/assignments?kind=student')->assertForbidden();
    $this->putJson("/api/lesson-reminders/assignments/student/{$this->omar}", ['jid' => '111-1@g.us'])->assertForbidden();
});

it('never reaches another academy\'s student', function () {
    $other = $this->createAcademy(overrides: ['timezone' => 'Africa/Cairo'], modules: ['MANAGEMENT', 'WHATSAPP']);
    $theirs = $this->createStudent($other, overrides: ['full_name' => 'Their Pupil']);
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/lesson-reminders/assignments/student/{$theirs}", ['jid' => '111-1@g.us'])->assertNotFound();
});

// ── Living with the Super Admin's staff groups ───────────────────────────────

it('keeps assignment-only groups off the Super Admin panel', function () {
    assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    Sanctum::actingAs($this->makeUser(null, 'SUPER_ADMIN', ['email' => 'sa-rem@test.local']));

    $this->getJson("/api/admin/academies/{$this->academy}/whatsapp/groups")
        ->assertOk()
        ->assertJsonCount(0, 'groups');
});

it('lets a Super Admin link an assigned group for staff alerts without losing the assignment', function () {
    $group = assignReminderGroup($this->academy, 'students', $this->omar, '111-1@g.us');
    Sanctum::actingAs($this->makeUser(null, 'SUPER_ADMIN', ['email' => 'sa-rem2@test.local']));

    $this->postJson("/api/admin/academies/{$this->academy}/whatsapp/groups", [
        'jid' => '111-1@g.us',
        'events' => ['SESSION_STARTED'],
    ])->assertCreated()->assertJsonPath('group.id', $group);

    // Unlinking it from staff alerts leaves the student's reminders alone.
    $this->deleteJson("/api/admin/academies/{$this->academy}/whatsapp/groups/{$group}")->assertOk();

    $this->clearTenantContext();
    $this->enterAcademyAsSuperAdmin($this->academy);
    expect(DB::table('students')->where('id', $this->omar)->value('whatsapp_group_id'))->toBe($group)
        ->and(DB::table('whatsapp_groups')->where('id', $group)->value('kind'))->toBe('LESSON');
});

it('offers the switch on the Super Admin feature list, off by default', function () {
    $catalog = FeatureCatalog::class;

    expect($catalog::capabilitiesOfModule('WHATSAPP'))->toContain('whatsapp.group_reminders')
        ->and($catalog::OPT_IN_CAPABILITIES)->toContain('whatsapp.group_reminders');
});
