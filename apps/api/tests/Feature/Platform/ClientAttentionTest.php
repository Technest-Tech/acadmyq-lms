<?php

declare(strict_types=1);

use App\Support\ClientAttention;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

// Super Admin → System health → "needs attention": the clients the platform owner should step in
// for, each with the named reason — instead of finding out when the client complains.

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/** A client with nothing wrong: holds management, signed in today, lessons flowing. */
function attentionRow(array $over = []): array
{
    return array_merge([
        'id' => 'a1',
        'name' => 'Bright Steps',
        'client_type' => 'MANAGEMENT',
        'status' => 'ACTIVE',
        'created_at' => '2026-01-01T00:00:00+00:00',
        'modules' => ['MANAGEMENT', 'WHATSAPP'],
        'trial_end' => null,
        'last_login_at' => '2026-11-15T08:00:00+00:00',
        'overdue_lessons' => 0,
        'oldest_overdue_end' => null,
        'active_schedules' => 12,
        'lessons_last_14d' => 80,
        'lessons_next_7d' => 40,
        'wa_status' => 'CONNECTED',
        'wa_linked' => true,
        'reminders_live' => true,
        'wa_sent_24h' => 30,
        'wa_failed_24h' => 0,
    ], $over);
}

function attentionCodes(array $over = [], ?array $account = null): array
{
    $items = ClientAttention::items(attentionRow($over), $account, Carbon::parse('2026-11-15T12:00:00+00:00'));

    return collect($items)->mapWithKeys(fn (array $i) => [$i['code'] => $i['severity']])->all();
}

it('has nothing to say about a client that is fine', function () {
    expect(attentionCodes())->toBe([]);
});

it('tells a dropped number from one that was never linked', function () {
    // Dropped while reminders are live: lessons are going unannounced right now.
    expect(attentionCodes(['wa_status' => 'LOGGED_OUT']))->toBe(['whatsapp_disconnected' => 'CRIT']);
    // Dropped, but nothing depends on it yet.
    expect(attentionCodes(['wa_status' => 'LOGGED_OUT', 'reminders_live' => false]))->toBe(['whatsapp_disconnected' => 'WARN']);
    // Never linked and nothing launched: the client simply has not set WhatsApp up.
    expect(attentionCodes(['wa_status' => null, 'wa_linked' => false, 'reminders_live' => false]))->toBe([]);
    // A QR on screen is a pairing in progress, not a drop.
    expect(attentionCodes(['wa_status' => 'QR', 'reminders_live' => false]))->toBe([]);
});

it('flags sends that mostly fail, and worse when none get through', function () {
    expect(attentionCodes(['wa_failed_24h' => 3, 'wa_sent_24h' => 0]))->toBe([]);
    expect(attentionCodes(['wa_failed_24h' => 8, 'wa_sent_24h' => 40]))->toBe([]);
    expect(attentionCodes(['wa_failed_24h' => 8, 'wa_sent_24h' => 5]))->toBe(['whatsapp_failing' => 'WARN']);
    expect(attentionCodes(['wa_failed_24h' => 8, 'wa_sent_24h' => 0]))->toBe(['whatsapp_failing' => 'CRIT']);
});

it('flags unmarked lessons once they are days old, not on a busy day', function () {
    expect(attentionCodes(['overdue_lessons' => 6, 'oldest_overdue_end' => '2026-11-14T10:00:00+00:00']))->toBe([]);
    expect(attentionCodes(['overdue_lessons' => 6, 'oldest_overdue_end' => '2026-11-10T10:00:00+00:00']))->toBe(['overdue_lessons' => 'WARN']);
    expect(attentionCodes(['overdue_lessons' => 6, 'oldest_overdue_end' => '2026-10-20T10:00:00+00:00']))->toBe(['overdue_lessons' => 'CRIT']);
    expect(attentionCodes(['overdue_lessons' => 60, 'oldest_overdue_end' => '2026-11-10T10:00:00+00:00']))->toBe(['overdue_lessons' => 'CRIT']);
});

it('notices a timetable that stopped producing lessons', function () {
    expect(attentionCodes(['lessons_next_7d' => 0]))->toBe(['lessons_stopped' => 'CRIT']);
    // A client that adds each lesson by hand (no timetables) or has not started yet is not broken.
    expect(attentionCodes(['lessons_next_7d' => 0, 'active_schedules' => 0]))->toBe([]);
    expect(attentionCodes(['lessons_next_7d' => 0, 'lessons_last_14d' => 0]))->toBe([]);
});

it('carries the money and the trial clock', function () {
    expect(attentionCodes([], ['has_overdue' => true, 'overdue' => ['EGP' => 99900]]))->toBe(['bills_overdue' => 'CRIT']);
    expect(attentionCodes([], ['has_overdue' => false, 'overdue' => []]))->toBe([]);
    expect(attentionCodes(['trial_end' => '2026-11-17T12:00:00+00:00']))->toBe(['trial_ending' => 'WARN']);
    expect(attentionCodes(['trial_end' => '2026-11-25T12:00:00+00:00']))->toBe([]);
    expect(attentionCodes(['trial_end' => '2026-11-13T12:00:00+00:00']))->toBe(['trial_ended' => 'CRIT']);
});

it('calls a client inactive after two silent weeks, and a new one only after three days', function () {
    expect(attentionCodes(['last_login_at' => '2026-10-25T08:00:00+00:00']))->toBe(['inactive' => 'WARN']);
    expect(attentionCodes(['last_login_at' => null, 'created_at' => '2026-11-14T08:00:00+00:00']))->toBe([]);
    expect(attentionCodes(['last_login_at' => null]))->toBe(['never_signed_in' => 'WARN']);
    // A WhatsApp-only client has no login to use.
    expect(attentionCodes(['last_login_at' => null, 'modules' => ['WHATSAPP']]))->toBe([]);
});

it('lists the worst client first and leaves out the healthy and the suspended', function () {
    $inbox = ClientAttention::inbox([
        attentionRow(['id' => 'ok', 'name' => 'Fine']),
        attentionRow(['id' => 'warn', 'name' => 'Drifting', 'last_login_at' => '2026-10-01T08:00:00+00:00']),
        attentionRow(['id' => 'crit', 'name' => 'Broken', 'wa_status' => 'LOGGED_OUT', 'last_login_at' => '2026-10-01T08:00:00+00:00']),
        attentionRow(['id' => 'off', 'name' => 'Switched off', 'status' => 'SUSPENDED', 'wa_status' => 'LOGGED_OUT']),
    ], [], Carbon::parse('2026-11-15T12:00:00+00:00'));

    expect(array_column($inbox['clients'], 'id'))->toBe(['crit', 'warn'])
        ->and($inbox['counts'])->toBe(['clients' => 2, 'crit' => 1, 'warn' => 1])
        ->and($inbox['clients'][0]['severity'])->toBe('CRIT')
        // Within a client, the worst reason leads.
        ->and(array_column($inbox['clients'][0]['items'], 'code'))->toBe(['whatsapp_disconnected', 'inactive']);
});

describe('GET /api/admin/system/attention', function () {
    beforeEach(function () {
        $this->seed(DemoAcademySeeder::class);
        $this->clearTenantContext();
        $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
        $this->asSuperAdmin();
    });

    it('reads the facts for every client in one go', function () {
        // Lessons nobody marked, the oldest five days back; one hidden and one of a removed
        // student, which the academy's own overdue tab does not count either.
        $late = $this->createAcademy(overrides: ['name' => 'Late Markers']);
        $student = $this->createStudent($late);
        $gone = $this->createStudent($late, overrides: ['deleted_at' => now()]);
        $teacher = $this->createTeacher($late);
        $this->createSession($late, $student, $teacher, ['status' => 'SCHEDULED', 'scheduled_at_utc' => now()->subDays(5)]);
        $this->createSession($late, $student, $teacher, ['status' => 'SCHEDULED', 'scheduled_at_utc' => now()->subDays(4)]);
        $this->createSession($late, $student, $teacher, ['status' => 'SCHEDULED', 'scheduled_at_utc' => now()->subDays(9), 'hidden_at' => now()]);
        $this->createSession($late, $gone, $teacher, ['status' => 'SCHEDULED', 'scheduled_at_utc' => now()->subDays(20)]);
        // A lesson that ended an hour ago is inside the grace: not late yet.
        $this->createSession($late, $student, $teacher, ['status' => 'SCHEDULED', 'scheduled_at_utc' => now()->subHours(2)]);

        // A number that dropped while its reminders are live.
        $dropped = $this->createAcademy(overrides: ['name' => 'Dropped Number']);
        $this->asAcademy($dropped);
        DB::table('academy_automation_settings')->insert([
            'academy_id' => $dropped,
            'wasender_session_status' => 'LOGGED_OUT',
            'lesson_reminders_live' => true,
        ]);

        // Nothing wrong, and one switched off on purpose.
        $this->createAcademy(overrides: ['name' => 'All Good']);
        $suspended = $this->createAcademy(overrides: ['name' => 'Suspended', 'status' => 'SUSPENDED']);
        $this->asAcademy($suspended);
        DB::table('academy_automation_settings')->insert(['academy_id' => $suspended, 'wasender_session_status' => 'LOGGED_OUT']);

        $this->asSuperAdmin();
        Sanctum::actingAs($this->admin);
        $res = $this->getJson('/api/admin/system/attention')->assertOk();
        $clients = collect($res->json('clients'))->keyBy('id');

        expect($clients->has($late))->toBeTrue()
            ->and($clients->has($dropped))->toBeTrue();
        expect($clients->pluck('name'))->not->toContain('All Good')->not->toContain('Suspended');

        $overdue = collect($clients[$late]['items'])->firstWhere('code', 'overdue_lessons');
        expect($overdue['severity'])->toBe('WARN')
            ->and($overdue['params']['count'])->toBe(2)
            ->and($overdue['params']['oldest_days'])->toBeGreaterThanOrEqual(4)->toBeLessThanOrEqual(5);

        expect($clients[$dropped]['severity'])->toBe('CRIT')
            ->and($clients[$dropped]['items'][0]['code'])->toBe('whatsapp_disconnected');
        // Worst first.
        expect($res->json('clients.0.severity'))->toBe('CRIT');
        expect($res->json('counts.crit'))->toBeGreaterThanOrEqual(1);
    });

    it('refuses the reader to anyone below the platform, at the database too', function () {
        $academy = $this->createAcademy();
        $this->asAcademy($academy);

        expect(fn () => DB::select('select app.admin_client_health()'))->toThrow(QueryException::class);
    });
});
