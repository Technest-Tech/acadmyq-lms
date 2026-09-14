<?php

declare(strict_types=1);

use App\Services\Whatsapp\GroupAlerts;
use Carbon\CarbonImmutable;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * WhatsApp group alerts — the engine (App\Services\Whatsapp\GroupAlerts). Detection per alert type,
 * one message per (group, type), idempotency, delivery tracking and recovery. The gateway is faked.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-09-14 13:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['timezone' => 'Africa/Cairo'], modules: ['MANAGEMENT', 'WHATSAPP']);
    giveWhatsAppToken($this->academy, 'tok-A');
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Mona Teacher']);
    $this->omar = $this->createStudent($this->academy, overrides: ['full_name' => 'Omar Pupil']);
    $this->laila = $this->createStudent($this->academy, overrides: ['full_name' => 'Laila Pupil']);

    // One fake for the whole test, driven by $this->gateway — Http::fake() stubs accumulate and the
    // first match wins, so re-faking mid-test would silently keep the old answers.
    $this->gateway = ['status' => 'CONNECTED', 'send' => 200, 'state' => 'sent', 'lookup' => 200];
    $this->sends = 0;
    Http::fake([
        '*/api/status' => fn () => Http::response(['status' => $this->gateway['status']], 200),
        '*/api/messages/*' => fn () => $this->gateway['lookup'] === 200
            ? Http::response(['state' => $this->gateway['state']], 200)
            : Http::response(['message' => 'Route not found'], $this->gateway['lookup']),
        '*/api/send-message' => function () {
            $this->sends++;

            return $this->gateway['send'] === 200
                ? Http::response(['data' => ['msgId' => 'wamid.'.$this->sends]], 200)
                : Http::response(['error' => 'boom'], $this->gateway['send']);
        },
    ]);
});

afterEach(fn () => Carbon::setTestNow());

/** @return list<HttpRequest> */
function sentMessages(): array
{
    return Http::recorded(fn (HttpRequest $req) => str_contains($req->url(), '/api/send-message'))
        ->map(fn (array $pair) => $pair[0])
        ->values()
        ->all();
}

/** Link a group straight into the table (the controller path has its own tests). */
function linkTestGroup(string $academyId, array $events, array $settings = [], ?string $since = null, array $overrides = []): string
{
    $id = (string) Str::uuid();
    $since ??= CarbonImmutable::now()->subHour()->toIso8601String();
    test()->enterAcademyAsSuperAdmin($academyId);
    DB::table('whatsapp_groups')->insert(array_merge([
        'id' => $id,
        'academy_id' => $academyId,
        'jid' => '1203630'.random_int(10000000, 99999999).'@g.us',
        'name' => 'Staff group',
        'label' => 'Supervision',
        'language' => 'en',
        'events' => json_encode($events),
        'event_since' => json_encode(array_fill_keys($events, $since)),
        'settings' => json_encode($settings),
        'is_active' => true,
        'created_at' => $since,
        'updated_at' => $since,
    ], $overrides));
    test()->clearTenantContext();

    return $id;
}

function sweepGroups(string $academyId): array
{
    return app(GroupAlerts::class)->run($academyId);
}

/** @return Collection<int, object> */
function groupAlerts(string $academyId, ?string $type = null)
{
    test()->enterAcademyAsSuperAdmin($academyId);

    return DB::table('whatsapp_group_alerts')
        ->where('academy_id', $academyId)
        ->when($type !== null, fn ($q) => $q->where('event_type', $type))
        ->orderBy('due_at')
        ->get();
}

// ── Supervision ──────────────────────────────────────────────────────────────

it('announces lessons at their start time in one message to the group, once', function () {
    $group = linkTestGroup($this->academy, ['SESSION_STARTED']);

    $this->createSession($this->academy, $this->omar, $this->teacher, ['scheduled_at_utc' => '2026-09-14 13:00:00+00', 'status' => 'SCHEDULED']);
    $this->createSession($this->academy, $this->laila, $this->teacher, ['scheduled_at_utc' => '2026-09-14 12:58:00+00', 'status' => 'SCHEDULED']);
    // Not yet started, and one already marked: neither is "starting now".
    $this->createSession($this->academy, $this->omar, $this->teacher, ['scheduled_at_utc' => '2026-09-14 13:30:00+00', 'status' => 'SCHEDULED']);
    $this->createSession($this->academy, $this->laila, $this->teacher, ['scheduled_at_utc' => '2026-09-14 12:59:00+00', 'status' => 'ATTENDED']);

    sweepGroups($this->academy);
    sweepGroups($this->academy);

    $sent = sentMessages();
    expect($sent)->toHaveCount(1);

    $this->enterAcademyAsSuperAdmin($this->academy);
    $jid = DB::table('whatsapp_groups')->where('id', $group)->value('jid');
    $body = $sent[0]->data();
    expect($body['to'])->toBe($jid)
        ->and($body['text'])->toContain('Lessons starting now')
        ->and($body['text'])->toContain('Mona Teacher with Omar Pupil')
        ->and($body['text'])->toContain('Mona Teacher with Laila Pupil')
        // Africa/Cairo is UTC+3: a 13:00 UTC lesson reads 4:00 PM to the academy.
        ->and($body['text'])->toContain('4:00 PM');

    $rows = groupAlerts($this->academy, 'SESSION_STARTED');
    expect($rows)->toHaveCount(2)
        ->and($rows->pluck('status')->unique()->all())->toBe(['QUEUED'])
        ->and($rows->pluck('provider_message_id')->unique()->all())->toBe(['wamid.1']);
});

it('never reports what happened before the alert was switched on', function () {
    linkTestGroup($this->academy, ['SESSION_STARTED'], since: '2026-09-14T12:55:00+00:00');

    $this->createSession($this->academy, $this->omar, $this->teacher, ['scheduled_at_utc' => '2026-09-14 12:50:00+00', 'status' => 'SCHEDULED']);

    sweepGroups($this->academy);

    expect(sentMessages())->toBeEmpty();
    expect(groupAlerts($this->academy))->toHaveCount(0);
});

it('reminds the group about a lesson nobody marked N minutes after it started', function () {
    linkTestGroup($this->academy, ['SESSION_NOT_MARKED'], ['not_marked_after_minutes' => 10]);

    $late = $this->createSession($this->academy, $this->omar, $this->teacher, ['scheduled_at_utc' => '2026-09-14 12:45:00+00', 'status' => 'SCHEDULED']);
    // Only 5 minutes in — not yet.
    $this->createSession($this->academy, $this->laila, $this->teacher, ['scheduled_at_utc' => '2026-09-14 12:55:00+00', 'status' => 'SCHEDULED']);
    // The teacher asked to cancel it: that IS acting on the lesson.
    $requested = $this->createSession($this->academy, $this->laila, $this->teacher, ['scheduled_at_utc' => '2026-09-14 12:40:00+00', 'status' => 'SCHEDULED']);
    $this->asAcademy($this->academy);
    DB::table('session_cancellation_requests')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'session_id' => $requested,
        'teacher_id' => $this->teacher, 'cancel_type' => 'teacher', 'status' => 'PENDING',
    ]);

    sweepGroups($this->academy);

    $rows = groupAlerts($this->academy, 'SESSION_NOT_MARKED');
    expect($rows->pluck('subject_key')->all())->toBe([$late]);
    expect(sentMessages()[0]->data()['text'])
        ->toContain('Attendance not recorded yet')
        ->toContain('10 min after the start');
});

it('stays quiet about a lesson a supervisor is already following', function () {
    linkTestGroup($this->academy, ['SESSION_NOT_MARKED'], ['not_marked_after_minutes' => 10]);
    $followed = $this->createSession($this->academy, $this->omar, $this->teacher, ['scheduled_at_utc' => '2026-09-14 12:45:00+00', 'status' => 'SCHEDULED']);
    $alone = $this->createSession($this->academy, $this->laila, $this->teacher, ['scheduled_at_utc' => '2026-09-14 12:45:00+00', 'status' => 'SCHEDULED']);
    $supervisor = $this->makeUser($this->academy, 'SUPERVISOR');
    $this->asAcademy($this->academy);
    DB::table('session_follow_ups')->insert([
        'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'session_id' => $followed,
        'user_id' => $supervisor->id, 'followed_at' => '2026-09-14 12:47:00+00',
    ]);

    sweepGroups($this->academy);

    expect(groupAlerts($this->academy, 'SESSION_NOT_MARKED')->pluck('subject_key')->all())->toBe([$alone]);
});

it('drops a pending reminder once the lesson gets marked before it could go out', function () {
    $this->gateway['status'] = 'DISCONNECTED';
    linkTestGroup($this->academy, ['SESSION_NOT_MARKED'], ['not_marked_after_minutes' => 10]);
    $session = $this->createSession($this->academy, $this->omar, $this->teacher, ['scheduled_at_utc' => '2026-09-14 12:45:00+00', 'status' => 'SCHEDULED']);

    sweepGroups($this->academy);
    expect(groupAlerts($this->academy)->first()->status)->toBe('PENDING');
    expect(sentMessages())->toBeEmpty();

    $this->asAcademy($this->academy);
    DB::table('sessions')->where('id', $session)->update(['status' => 'ATTENDED']);

    $this->gateway['status'] = 'CONNECTED';
    sweepGroups($this->academy);

    $row = groupAlerts($this->academy)->first();
    expect($row->status)->toBe('SKIPPED')->and($row->error)->toBe('no_longer_true');
    expect(sentMessages())->toBeEmpty();
});

it('flags an attended lesson whose report is still missing N hours after it ended', function () {
    linkTestGroup($this->academy, ['REPORT_OVERDUE'], ['report_overdue_hours' => 2], since: '2026-09-14T11:00:00+00:00');

    // Ended 10:30, due 12:30 — overdue.
    $overdue = $this->createSession($this->academy, $this->omar, $this->teacher, ['scheduled_at_utc' => '2026-09-14 10:00:00+00', 'duration_minutes' => 30, 'status' => 'ATTENDED']);
    // Ended 11:30, due 13:30 — not yet.
    $this->createSession($this->academy, $this->laila, $this->teacher, ['scheduled_at_utc' => '2026-09-14 11:00:00+00', 'duration_minutes' => 30, 'status' => 'ATTENDED']);
    // Same timing, but the report is written.
    $reported = $this->createSession($this->academy, $this->laila, $this->teacher, ['scheduled_at_utc' => '2026-09-14 10:00:00+00', 'duration_minutes' => 30, 'status' => 'ATTENDED']);
    DB::table('session_reports')->insert(['id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'session_id' => $reported, 'values' => '{}']);
    // Never marked at all: that is the "not marked" alert's job, not this one.
    $this->createSession($this->academy, $this->omar, $this->teacher, ['scheduled_at_utc' => '2026-09-14 10:00:00+00', 'duration_minutes' => 30, 'status' => 'SCHEDULED']);

    sweepGroups($this->academy);

    expect(groupAlerts($this->academy, 'REPORT_OVERDUE')->pluck('subject_key')->all())->toBe([$overdue]);
    expect(sentMessages()[0]->data()['text'])
        ->toContain('Lesson report not written')
        ->toContain('2 h after the lesson ended')
        ->toContain('Mona Teacher with Omar Pupil');
});

it('writes the supervision message in Arabic for an Arabic group', function () {
    linkTestGroup($this->academy, ['SESSION_NOT_MARKED'], ['not_marked_after_minutes' => 5], overrides: ['language' => 'ar']);
    $this->createSession($this->academy, $this->omar, $this->teacher, ['scheduled_at_utc' => '2026-09-14 12:50:00+00', 'status' => 'SCHEDULED']);

    sweepGroups($this->academy);

    expect(sentMessages()[0]->data()['text'])
        ->toContain('لم يُسجَّل الحضور بعد')
        ->toContain('5 دقائق')
        ->toContain('3:50 م')
        ->toContain('المعلم Mona Teacher مع Omar Pupil');
});

// ── Accounting ───────────────────────────────────────────────────────────────

it('relays package running-low and package-ended alerts to the accounting group', function () {
    Carbon::setTestNow(); // notifications carry the database clock
    linkTestGroup($this->academy, ['PACKAGE_LOW', 'PACKAGE_ENDED'], since: CarbonImmutable::now()->subMinute()->toIso8601String(), overrides: ['label' => 'Accounting']);

    $this->asAcademy($this->academy);
    foreach ([
        ['PACKAGE_LOW', ['student_name' => 'Omar Pupil', 'label' => '10 hours', 'minutes_left' => 45]],
        ['PACKAGE_COMPLETED', ['student_name' => 'Laila Pupil', 'label' => '8 hours', 'reason' => 'EXHAUSTED', 'minutes_overdrawn' => 30]],
    ] as [$type, $data]) {
        DB::table('notifications')->insert([
            'id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'type' => $type, 'category' => 'PACKAGES',
            'audience_role' => 'ACADEMY_OWNER', 'subject_id' => (string) Str::uuid(), 'data' => json_encode($data),
        ]);
    }

    sweepGroups($this->academy);

    $texts = array_map(fn (HttpRequest $r) => $r->data()['text'], sentMessages());
    expect($texts)->toHaveCount(2);
    expect(implode("\n", $texts))
        ->toContain('Package running low')
        ->toContain('Omar Pupil — "10 hours": 45m left')
        ->toContain('Package ended')
        ->toContain('Laila Pupil — "8 hours" (used up) — 30m over');
});

it('reports every recorded payment — by hand and through a payment gateway', function () {
    Carbon::setTestNow(); // payment events carry the database clock
    linkTestGroup($this->academy, ['PAYMENT_RECEIVED'], since: CarbonImmutable::now()->subMinute()->toIso8601String());

    $guardian = $this->createGuardian($this->academy, ['full_name' => 'Hassan Family']);
    [$manual] = $this->createInvoice($this->academy, $guardian, ['total_minor' => 150000, 'subtotal_minor' => 150000, 'period_month' => 9]);
    [$paypal] = $this->createInvoice($this->academy, $guardian, ['total_minor' => 90000, 'subtotal_minor' => 90000, 'period_month' => 8, 'status' => 'CLOSED']);

    // A partial payment recorded by hand…
    $this->asAcademy($this->academy);
    DB::table('invoices')->where('id', $manual)->update(['status' => 'PARTIALLY_PAID', 'amount_paid_minor' => 50000, 'payment_method' => 'CASH']);
    // …and a gateway capture, which settles through a SECURITY DEFINER function with NO tenant context.
    $this->clearTenantContext();
    expect(DB::selectOne('select app.paypal_mark_invoice_paid(?, ?) as ok', [$paypal, 'ORDER-1'])->ok)->toBeTrue();

    sweepGroups($this->academy);

    $text = sentMessages()[0]->data()['text'];
    expect($text)
        ->toContain('Payments received')
        ->toContain('500 EGP — Hassan Family — invoice 9/2026 — cash (500 EGP of 1,500 EGP paid)')
        ->toContain('900 EGP — Hassan Family — invoice 8/2026 — online (paid in full)');
    expect(groupAlerts($this->academy, 'PAYMENT_RECEIVED'))->toHaveCount(2);
});

it('does not treat an invoice edit that moves no money as a payment', function () {
    [$invoice] = $this->createInvoice($this->academy, overrides: ['total_minor' => 1000, 'subtotal_minor' => 1000]);

    $this->asAcademy($this->academy);
    DB::table('invoices')->where('id', $invoice)->update(['status' => 'CLOSED']);

    expect(DB::table('invoice_payment_events')->where('invoice_id', $invoice)->exists())->toBeFalse();
});

// ── Delivery ────────────────────────────────────────────────────────────────

it('waits while the number is disconnected, then expires a start alert that is no longer news', function () {
    $this->gateway['status'] = 'DISCONNECTED';
    linkTestGroup($this->academy, ['SESSION_STARTED']);
    $this->createSession($this->academy, $this->omar, $this->teacher, ['scheduled_at_utc' => '2026-09-14 13:00:00+00', 'status' => 'SCHEDULED']);

    sweepGroups($this->academy);
    expect(groupAlerts($this->academy)->first()->status)->toBe('PENDING');

    Carbon::setTestNow('2026-09-14 13:25:00');
    $this->gateway['status'] = 'CONNECTED';
    sweepGroups($this->academy);

    expect(groupAlerts($this->academy)->first()->status)->toBe('EXPIRED');
    expect(sentMessages())->toBeEmpty();
});

it('backs off after a failed send and tries again later', function () {
    $this->gateway['send'] = 500;
    linkTestGroup($this->academy, ['SESSION_NOT_MARKED'], ['not_marked_after_minutes' => 10]);
    $this->createSession($this->academy, $this->omar, $this->teacher, ['scheduled_at_utc' => '2026-09-14 12:45:00+00', 'status' => 'SCHEDULED']);

    sweepGroups($this->academy);
    $row = groupAlerts($this->academy)->first();
    expect($row->status)->toBe('FAILED')->and((int) $row->attempts)->toBe(1);

    // Same minute: still backing off.
    sweepGroups($this->academy);
    expect(sentMessages())->toHaveCount(1);

    Carbon::setTestNow('2026-09-14 13:02:00');
    $this->gateway['send'] = 200;
    sweepGroups($this->academy);

    $row = groupAlerts($this->academy)->first();
    expect($row->status)->toBe('QUEUED')->and((int) $row->attempts)->toBe(2);

    // The failure and the success are both in the send log the activity feed reads.
    $this->enterAcademyAsSuperAdmin($this->academy);
    expect(DB::table('automation_send_log')->where('academy_id', $this->academy)->where('automation_type', 'GROUP_ALERT')
        ->orderBy('created_at')->pluck('status')->all())->toEqualCanonicalizing(['FAILED', 'SENT']);
});

it('asks the gateway about a message it never reported on, and resends one it lost', function () {
    $this->gateway['state'] = 'unknown';
    linkTestGroup($this->academy, ['SESSION_NOT_MARKED'], ['not_marked_after_minutes' => 10]);
    $this->createSession($this->academy, $this->omar, $this->teacher, ['scheduled_at_utc' => '2026-09-14 12:45:00+00', 'status' => 'SCHEDULED']);

    sweepGroups($this->academy);
    expect(groupAlerts($this->academy)->first()->status)->toBe('QUEUED');

    // Minutes later there has been no webhook, and the gateway (restarted) no longer knows the message.
    Carbon::setTestNow('2026-09-14 13:05:00');
    sweepGroups($this->academy);
    $row = groupAlerts($this->academy)->first();
    expect($row->status)->toBe('FAILED')->and($row->error)->toBe('lost_by_gateway');

    sweepGroups($this->academy);
    expect(groupAlerts($this->academy)->first()->status)->toBe('QUEUED');
    expect(sentMessages())->toHaveCount(2);
});

it('does not resend when the gateway cannot be asked', function () {
    // A gateway that predates the lookup route answers 404 — no information, so no resend.
    $this->gateway['lookup'] = 404;
    linkTestGroup($this->academy, ['SESSION_NOT_MARKED'], ['not_marked_after_minutes' => 10]);
    $this->createSession($this->academy, $this->omar, $this->teacher, ['scheduled_at_utc' => '2026-09-14 12:45:00+00', 'status' => 'SCHEDULED']);

    sweepGroups($this->academy);
    Carbon::setTestNow('2026-09-14 13:10:00');
    sweepGroups($this->academy);
    sweepGroups($this->academy);

    expect(groupAlerts($this->academy)->first()->status)->toBe('QUEUED');
    expect(sentMessages())->toHaveCount(1);
});

it('sends nothing for a client whose WhatsApp module is off', function () {
    $other = $this->createAcademy(overrides: ['timezone' => 'Africa/Cairo'], modules: ['MANAGEMENT']);
    giveWhatsAppToken($other, 'tok-B');
    $teacher = $this->createTeacher($other);
    $student = $this->createStudent($other);
    linkTestGroup($other, ['SESSION_STARTED']);
    $this->createSession($other, $student, $teacher, ['scheduled_at_utc' => '2026-09-14 13:00:00+00', 'status' => 'SCHEDULED']);

    sweepGroups($other);

    expect(sentMessages())->toBeEmpty();
    expect(groupAlerts($other))->toHaveCount(0);
});
