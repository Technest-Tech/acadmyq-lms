<?php

declare(strict_types=1);

use App\Jobs\RollSessionWindowJob;
use App\Support\JobRuns;
use App\Support\SystemHealth;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Bus\Queueable;
use Illuminate\Console\Scheduling\CallbackEvent;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

// Super Admin → System health: the cron, the queue, every scheduled task against when it last
// actually FINISHED, the dead jobs (with retry / dismiss) and the WhatsApp gateway — the things
// that used to need an SSH session to see.

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

final class HealthProbeJob implements ShouldQueue
{
    use Dispatchable, Queueable;

    public function __construct(public bool $explode = false) {}

    public function handle(): void
    {
        if ($this->explode) {
            throw new RuntimeException("the probe blew up\nwith a second line nobody needs");
        }
    }
}

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
    $this->asSuperAdmin();

    Cache::flush();
    Http::fake(['*/health' => Http::response(['sessions' => ['total' => 3, 'connected' => 3]])]);

    // The scheduler's own minute, as cron would run it: a fresh heartbeat + the published schedule.
    $this->artisan('schedule:list')->assertSuccessful();
    Cache::put('scheduler.heartbeat_at', now()->toIso8601String());
    Cache::put('scheduler.last_roll_at', now()->subHours(2)->toIso8601String());
    JobRuns::publishSchedule(app(Schedule::class));
});

function healthFailedJob(string $job = 'App\\Jobs\\RollSessionWindowJob', string $exception = "Timeout: the job ran too long\n#0 stack"): string
{
    $uuid = (string) Str::uuid();
    DB::table('failed_jobs')->insert([
        'uuid' => $uuid,
        'connection' => 'database',
        'queue' => 'default',
        'payload' => json_encode([
            'uuid' => $uuid,
            'displayName' => $job,
            'job' => 'Illuminate\\Queue\\CallQueuedHandler@call',
            'maxTries' => null,
            'data' => ['commandName' => $job, 'command' => serialize(new HealthProbeJob)],
        ]),
        'exception' => $exception,
        'failed_at' => now(),
    ]);

    return $uuid;
}

it('is closed to everyone but the platform', function () {
    $academy = $this->createAcademy();
    Sanctum::actingAs($this->makeUser($academy, 'ACADEMY_OWNER'));
    $uuid = (string) Str::uuid();

    $this->getJson('/api/admin/system/health')->assertForbidden();
    $this->getJson('/api/admin/system/attention')->assertForbidden();
    $this->postJson("/api/admin/system/failed-jobs/{$uuid}/retry")->assertForbidden();
    $this->deleteJson("/api/admin/system/failed-jobs/{$uuid}")->assertForbidden();
});

it('reports a healthy machine as OK, with every scheduled task listed', function () {
    Sanctum::actingAs($this->admin);

    $res = $this->getJson('/api/admin/system/health')->assertOk()
        ->assertJsonPath('status', 'OK')
        ->assertJsonPath('problems', [])
        ->assertJsonPath('database.ok', true)
        ->assertJsonPath('gateway.up', true)
        ->assertJsonPath('queue.failed_total', 0);

    expect($res->json('scheduler.heartbeat_age_seconds'))->toBeLessThan(60);

    $tasks = collect($res->json('tasks'))->keyBy('name');
    expect($tasks->keys())->toContain('roll-session-window', 'whatsapp-group-alerts', 'accounts-daily')
        ->not->toContain('scheduler-heartbeat');
    expect($tasks['roll-session-window']['job'])->toBe('RollSessionWindowJob')
        ->and($tasks['roll-session-window']['cron'])->toBe('30 0 * * *')
        ->and($tasks['roll-session-window']['next_due_at'])->not->toBeNull();
    // Nothing has been seen to finish yet and tracking only just began: waiting, not late.
    expect($tasks->pluck('state')->unique()->values()->all())->each->toBeIn(['OK', 'WAITING']);
});

it('knows which class does the work of every scheduled job', function () {
    $names = collect(app(Schedule::class)->events())
        ->filter(fn ($event) => $event instanceof CallbackEvent)
        ->map(fn ($event) => (string) $event->description)
        ->reject(fn (string $name) => $name === 'scheduler-heartbeat');

    expect($names)->not->toBeEmpty();
    foreach ($names as $name) {
        expect(SystemHealth::JOB_CLASSES)->toHaveKey($name);
        expect(class_exists(SystemHealth::JOB_CLASSES[$name]))->toBeTrue();
    }
});

it('stamps a job when it finishes and when it fails', function () {
    HealthProbeJob::dispatch();
    expect(JobRuns::of(HealthProbeJob::class)['ok_at'])->not->toBeNull()
        ->and(JobRuns::of(HealthProbeJob::class)['failed_at'])->toBeNull();

    expect(fn () => HealthProbeJob::dispatch(true))->toThrow(RuntimeException::class);
    $runs = JobRuns::of(HealthProbeJob::class);
    expect($runs['failed_at'])->not->toBeNull()
        ->and($runs['error'])->toBe('the probe blew up');
});

it('says a task failed when its latest end was a failure, and clears it on the next good run', function () {
    Sanctum::actingAs($this->admin);
    JobRuns::failed(RollSessionWindowJob::class, 'Timeout: ran too long');

    $res = $this->getJson('/api/admin/system/health')->assertOk()->assertJsonPath('status', 'WARN');
    $task = collect($res->json('tasks'))->firstWhere('name', 'roll-session-window');
    expect($task['state'])->toBe('FAILED')
        ->and($task['last_error'])->toBe('Timeout: ran too long');
    expect(collect($res->json('problems'))->firstWhere('code', 'task_failed')['params']['task'])->toBe('roll-session-window');

    $this->travel(1)->minutes();
    Cache::put('scheduler.heartbeat_at', now()->toIso8601String());
    JobRuns::ok(RollSessionWindowJob::class);
    $task = collect($this->getJson('/api/admin/system/health')->json('tasks'))->firstWhere('name', 'roll-session-window');
    expect($task['state'])->toBe('OK')->and($task['last_error'])->toBeNull();
});

it('says a task is late when its slot passed and nothing has finished since', function () {
    Sanctum::actingAs($this->admin);
    // Tracking has been on for a week, and the hourly sweep last finished yesterday.
    Cache::put('job_runs.tracking_since', now()->subWeek()->toIso8601String());
    Cache::put('job_runs.ok.FlagOverdueReportsJob', ['at' => now()->subDay()->toIso8601String()]);
    // Sit well past the top of the hour so the grace has run out.
    $this->travelTo(now()->startOfHour()->addMinutes(45));
    Cache::put('scheduler.heartbeat_at', now()->toIso8601String());

    $res = $this->getJson('/api/admin/system/health')->assertOk();
    $task = collect($res->json('tasks'))->firstWhere('name', 'flag-overdue-reports');
    expect($task['state'])->toBe('LATE');
    expect(collect($res->json('problems'))->pluck('code'))->toContain('task_late');
});

it('raises the alarm when the cron stops, the nightly roll goes stale or the gateway is down', function () {
    Sanctum::actingAs($this->admin);
    Cache::put('scheduler.heartbeat_at', now()->subMinutes(12)->toIso8601String());
    Cache::put('scheduler.last_roll_at', now()->subHours(57)->toIso8601String());
    Http::swap(new Factory);
    Http::fake(['*' => Http::response(null, 500)]);

    $res = $this->getJson('/api/admin/system/health')->assertOk()->assertJsonPath('status', 'CRIT');
    $problems = collect($res->json('problems'))->keyBy('code');

    expect($problems->keys())->toContain('scheduler_stopped', 'roll_stale', 'gateway_down');
    expect($problems['scheduler_stopped']['params']['minutes'])->toBe(12)
        ->and($problems['roll_stale']['params']['hours'])->toBe(57);
    // The worst come first.
    expect($res->json('problems.0.severity'))->toBe('CRIT');
});

it('lists the dead jobs with the first line of what killed them', function () {
    Sanctum::actingAs($this->admin);
    $uuid = healthFailedJob();

    $res = $this->getJson('/api/admin/system/health')->assertOk()
        ->assertJsonPath('status', 'WARN')
        ->assertJsonPath('queue.failed_total', 1)
        ->assertJsonPath('queue.failed_24h', 1)
        ->assertJsonPath('failed_jobs.0.id', $uuid)
        ->assertJsonPath('failed_jobs.0.job', 'RollSessionWindowJob')
        ->assertJsonPath('failed_jobs.0.error', 'Timeout: the job ran too long');

    expect(collect($res->json('problems'))->firstWhere('code', 'jobs_failed')['params']['count'])->toBe(1);
});

it('puts a dead job back on the queue, or dismisses it, and records who did', function () {
    Sanctum::actingAs($this->admin);
    $retried = healthFailedJob('HealthProbeJob');
    $dismissed = healthFailedJob('HealthProbeJob');

    $this->postJson("/api/admin/system/failed-jobs/{$retried}/retry")->assertOk();
    expect(DB::table('failed_jobs')->where('uuid', $retried)->exists())->toBeFalse()
        ->and(DB::table('jobs')->count())->toBe(1);

    $this->deleteJson("/api/admin/system/failed-jobs/{$dismissed}")->assertOk();
    expect(DB::table('failed_jobs')->count())->toBe(0)
        ->and(DB::table('jobs')->count())->toBe(1);

    $this->asSuperAdmin();
    expect(DB::table('audit_log')->whereIn('action', ['system.job_retried', 'system.job_dismissed'])->count())->toBe(2);

    // Gone is gone: a second click on a stale row is a 404, not a silent success.
    $this->postJson("/api/admin/system/failed-jobs/{$retried}/retry")->assertNotFound();
    $this->deleteJson("/api/admin/system/failed-jobs/{$dismissed}")->assertNotFound();
});
