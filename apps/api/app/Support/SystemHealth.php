<?php

declare(strict_types=1);

namespace App\Support;

use App\Jobs\AccountsDailyJob;
use App\Jobs\AutoDeductUnreportedSessionsJob;
use App\Jobs\BillGroupMonthsJob;
use App\Jobs\CloseMonthlyInvoicesJob;
use App\Jobs\CloseMonthlyPayoutsJob;
use App\Jobs\ExpireAcademyTrialsJob;
use App\Jobs\FlagOverdueReportsJob;
use App\Jobs\LessonReminderJob;
use App\Jobs\MonthlyStudentBillingJob;
use App\Jobs\OpenFixedSalaryPayoutsJob;
use App\Jobs\PrepaidMonthlyBillingJob;
use App\Jobs\PurgeExpiredRecordingsJob;
use App\Jobs\RollSessionWindowJob;
use App\Services\Whatsapp\GatewayAdminClient;
use Cron\CronExpression;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Super Admin → System health: is the machine behind every client actually running?
 *
 * Everything here used to be an SSH session: `curl /api/health` for the cron, `queue:failed` for the
 * jobs, the gateway's own endpoint for WhatsApp. One read, no tenant data, and nothing in it can
 * throw — a health page that 500s when something is unhealthy is no use.
 */
final class SystemHealth
{
    /**
     * The scheduled jobs, by the name routes/console.php gives them. A queued job's schedule entry
     * knows only its name, so this is the one place that says which class does the work — and
     * SystemHealthTest fails when a scheduled job is missing from it.
     *
     * @var array<string, class-string>
     */
    public const JOB_CLASSES = [
        'roll-session-window' => RollSessionWindowJob::class,
        'close-monthly-invoices' => CloseMonthlyInvoicesJob::class,
        'close-monthly-payouts' => CloseMonthlyPayoutsJob::class,
        'open-fixed-salary-payouts' => OpenFixedSalaryPayoutsJob::class,
        'bill-group-months' => BillGroupMonthsJob::class,
        'flag-overdue-reports' => FlagOverdueReportsJob::class,
        'auto-deduct-unreported' => AutoDeductUnreportedSessionsJob::class,
        'expire-academy-trials' => ExpireAcademyTrialsJob::class,
        'accounts-daily' => AccountsDailyJob::class,
        'prepaid-monthly-billing' => PrepaidMonthlyBillingJob::class,
        'type1-student-billing' => MonthlyStudentBillingJob::class,
        'type1-student-billing-retry-1' => MonthlyStudentBillingJob::class,
        'type1-student-billing-retry-2' => MonthlyStudentBillingJob::class,
        'type2-lesson-reminders' => LessonReminderJob::class,
        'purge-expired-recordings' => PurgeExpiredRecordingsJob::class,
    ];

    /** The cron runs every minute: five silent minutes is a dead cron, not a slow one. */
    private const HEARTBEAT_STALE_SECONDS = 300;

    /** The daily roll runs at 00:30; past this it has missed a night. */
    private const ROLL_STALE_HOURS = 26;

    /** A job waiting this long means nothing is working the queue. */
    private const QUEUE_STUCK_SECONDS = 900;

    /** How long after its slot a task may still be running before it reads as late. */
    private const LATE_GRACE_MINUTES = 20;

    private const FAILED_LIST_LIMIT = 30;

    public function __construct(private readonly GatewayAdminClient $gateway) {}

    /** @return array<string,mixed> */
    public function snapshot(): array
    {
        $database = $this->database();
        $scheduler = $this->scheduler();
        $queue = $this->queue();
        $tasks = $this->tasks();
        $gateway = $this->gateway();

        $problems = $this->problems($database, $scheduler, $queue, $tasks, $gateway);

        return [
            'status' => $this->worst(array_column($problems, 'severity')),
            'problems' => $problems,
            'app' => $this->app(),
            'database' => $database,
            'scheduler' => $scheduler,
            'queue' => $queue,
            'tasks' => $tasks,
            'failed_jobs' => $this->failedJobs(),
            'gateway' => $gateway,
            'checked_at' => now()->utc()->toIso8601String(),
        ];
    }

    /** What is running, and since when. @return array<string,mixed> */
    private function app(): array
    {
        return [
            'environment' => (string) config('app.env'),
            'commit' => $this->commit(),
            'deployed_at' => $this->deployedAt(),
        ];
    }

    /** @return array{ok: bool} */
    private function database(): array
    {
        try {
            DB::select('select 1');

            return ['ok' => true];
        } catch (Throwable) {
            return ['ok' => false];
        }
    }

    /** @return array{heartbeat_at: ?string, heartbeat_age_seconds: ?int, last_roll_at: ?string, last_roll_age_hours: ?float} */
    private function scheduler(): array
    {
        $out = ['heartbeat_at' => null, 'heartbeat_age_seconds' => null, 'last_roll_at' => null, 'last_roll_age_hours' => null];
        try {
            $beat = Cache::get('scheduler.heartbeat_at');
            $roll = Cache::get('scheduler.last_roll_at');
            if (is_string($beat)) {
                $out['heartbeat_at'] = $beat;
                $out['heartbeat_age_seconds'] = (int) now()->diffInSeconds(Carbon::parse($beat), true);
            }
            if (is_string($roll)) {
                $out['last_roll_at'] = $roll;
                $out['last_roll_age_hours'] = round(now()->diffInMinutes(Carbon::parse($roll), true) / 60, 1);
            }
        } catch (Throwable) {
            // Reported as "never" — which is itself the alarm.
        }

        return $out;
    }

    /**
     * The queue: what is waiting (and for how long), and what died. A job that is delayed on
     * purpose — a retry backing off — is not "waiting", so only jobs already due are counted.
     *
     * @return array{pending: int, oldest_pending_age_seconds: ?int, failed_total: int, failed_24h: int}
     */
    private function queue(): array
    {
        $out = ['pending' => 0, 'oldest_pending_age_seconds' => null, 'failed_total' => 0, 'failed_24h' => 0];
        try {
            $now = now()->getTimestamp();
            $due = DB::table('jobs')->whereNull('reserved_at')->where('available_at', '<=', $now);
            $out['pending'] = (int) (clone $due)->count();
            $oldest = (clone $due)->min('available_at');
            $out['oldest_pending_age_seconds'] = $oldest === null ? null : max(0, $now - (int) $oldest);

            $out['failed_total'] = (int) DB::table('failed_jobs')->count();
            $out['failed_24h'] = (int) DB::table('failed_jobs')->where('failed_at', '>=', now()->subDay())->count();
        } catch (Throwable) {
            // A queue that is not on the database driver has no tables to read.
        }

        return $out;
    }

    /**
     * Every scheduled task with when it was last due, when it last FINISHED and when it last failed.
     *
     *   FAILED   its latest end was a failure
     *   LATE     its slot passed (plus a grace) and nothing has finished since
     *   WAITING  never seen to finish, but run tracking only began after its last slot
     *   OK       finished after its last slot
     *
     * @return list<array<string,mixed>>
     */
    private function tasks(): array
    {
        $since = JobRuns::trackingSince();
        $sinceAt = $since === null ? null : Carbon::parse($since);
        $out = [];

        foreach (JobRuns::schedule() as $task) {
            $name = (string) $task['name'];
            $class = self::JOB_CLASSES[$name] ?? null;
            $runs = JobRuns::of($class ?? $name);

            [$lastDue, $nextDue] = $this->slots((string) $task['cron'], $task['timezone'] ?? null);
            $okAt = $runs['ok_at'] === null ? null : Carbon::parse($runs['ok_at']);
            $failedAt = $runs['failed_at'] === null ? null : Carbon::parse($runs['failed_at']);

            $state = 'OK';
            if ($failedAt !== null && ($okAt === null || $failedAt->greaterThan($okAt))) {
                $state = 'FAILED';
            } elseif ($lastDue !== null && ($okAt === null || $okAt->lessThan($lastDue))) {
                $overdue = $lastDue->copy()->addMinutes(self::LATE_GRACE_MINUTES)->isPast();
                $tracked = $sinceAt !== null && $sinceAt->lessThanOrEqualTo($lastDue);
                $state = ! $overdue ? 'OK' : ($okAt === null && ! $tracked ? 'WAITING' : 'LATE');
            }

            $out[] = [
                'name' => $name,
                'job' => $class === null ? null : JobRuns::key($class),
                'cron' => (string) $task['cron'],
                'last_due_at' => $lastDue?->utc()->toIso8601String(),
                'next_due_at' => $nextDue?->utc()->toIso8601String(),
                'last_ok_at' => $okAt?->utc()->toIso8601String(),
                'last_failed_at' => $failedAt?->utc()->toIso8601String(),
                'last_error' => $state === 'FAILED' ? $runs['error'] : null,
                'state' => $state,
            ];
        }

        return $out;
    }

    /** The latest failed jobs, newest first, each with the first line of what killed it. @return list<array<string,mixed>> */
    private function failedJobs(): array
    {
        try {
            $rows = DB::table('failed_jobs')->orderByDesc('failed_at')->limit(self::FAILED_LIST_LIMIT)
                ->get(['uuid', 'queue', 'payload', 'exception', 'failed_at']);
        } catch (Throwable) {
            return [];
        }

        return $rows->map(function (object $row): array {
            $payload = json_decode((string) $row->payload, true);
            $name = is_array($payload) ? (string) ($payload['displayName'] ?? '') : '';

            return [
                'id' => (string) $row->uuid,
                'job' => $name === '' ? null : JobRuns::key($name),
                'queue' => (string) $row->queue,
                'failed_at' => Carbon::parse((string) $row->failed_at)->utc()->toIso8601String(),
                'error' => mb_substr(trim((string) strtok((string) $row->exception, "\n")), 0, 400),
            ];
        })->all();
    }

    /**
     * The WhatsApp gateway. With no gateway address configured (a dev machine) there is nothing to
     * be down, so it is reported as not configured rather than as an outage.
     *
     * @return array{configured: bool, up: bool, sessions: mixed}
     */
    private function gateway(): array
    {
        if (trim((string) config('services.whatsapp_gateway.base_url')) === '') {
            return ['configured' => false, 'up' => false, 'sessions' => null];
        }

        try {
            $health = $this->gateway->health();
        } catch (Throwable) {
            $health = ['up' => false];
        }

        return [
            'configured' => true,
            'up' => (bool) ($health['up'] ?? false),
            'sessions' => $health['sessions'] ?? null,
        ];
    }

    /**
     * What is wrong, worst first — the page's headline, and the reason behind the overall status.
     *
     * @param  array<string,mixed>  $database
     * @param  array<string,mixed>  $scheduler
     * @param  array<string,mixed>  $queue
     * @param  list<array<string,mixed>>  $tasks
     * @param  array<string,mixed>  $gateway
     * @return list<array{code: string, severity: string, params: array<string,mixed>}>
     */
    private function problems(array $database, array $scheduler, array $queue, array $tasks, array $gateway): array
    {
        $problems = [];
        $add = function (string $code, string $severity, array $params = []) use (&$problems): void {
            $problems[] = ['code' => $code, 'severity' => $severity, 'params' => $params];
        };

        if (! $database['ok']) {
            $add('database_down', 'CRIT');
        }

        $beat = $scheduler['heartbeat_age_seconds'];
        if ($beat === null) {
            $add('scheduler_never_ran', 'WARN');
        } elseif ($beat > self::HEARTBEAT_STALE_SECONDS) {
            $add('scheduler_stopped', 'CRIT', ['minutes' => intdiv($beat, 60)]);
        }

        $roll = $scheduler['last_roll_age_hours'];
        if ($roll !== null && $roll > self::ROLL_STALE_HOURS) {
            $add('roll_stale', 'CRIT', ['hours' => (int) round($roll)]);
        }

        $waiting = $queue['oldest_pending_age_seconds'];
        if ($waiting !== null && $waiting > self::QUEUE_STUCK_SECONDS) {
            $add('queue_stuck', 'CRIT', ['minutes' => intdiv($waiting, 60), 'pending' => $queue['pending']]);
        }

        if ($gateway['configured'] && ! $gateway['up']) {
            $add('gateway_down', 'CRIT');
        }

        foreach ($tasks as $task) {
            if ($task['state'] === 'FAILED') {
                $add('task_failed', 'WARN', ['task' => $task['name']]);
            } elseif ($task['state'] === 'LATE') {
                $add('task_late', 'WARN', ['task' => $task['name']]);
            }
        }

        if ($queue['failed_24h'] > 0) {
            $add('jobs_failed', 'WARN', ['count' => $queue['failed_24h']]);
        }

        usort($problems, fn (array $a, array $b): int => self::rank($b['severity']) <=> self::rank($a['severity']));

        return $problems;
    }

    /** @param list<string> $severities */
    private function worst(array $severities): string
    {
        $worst = 'OK';
        foreach ($severities as $severity) {
            if (self::rank($severity) > self::rank($worst)) {
                $worst = $severity;
            }
        }

        return $worst;
    }

    public static function rank(string $severity): int
    {
        return match ($severity) {
            'CRIT' => 2,
            'WARN' => 1,
            default => 0,
        };
    }

    /** The slot a cron expression last named, and the next one. @return array{0: ?Carbon, 1: ?Carbon} */
    private function slots(string $cron, ?string $timezone): array
    {
        try {
            $expression = new CronExpression($cron);
            $zone = $timezone ?: (string) config('app.timezone');
            $now = now($zone);

            return [
                Carbon::instance($expression->getPreviousRunDate($now, 0, true)),
                Carbon::instance($expression->getNextRunDate($now)),
            ];
        } catch (Throwable) {
            return [null, null];
        }
    }

    /** The commit on disk, read straight from .git — no shell. Null when the checkout has none. */
    private function commit(): ?string
    {
        try {
            $git = dirname(base_path(), 2).'/.git';
            $head = @file_get_contents($git.'/HEAD');
            if ($head === false) {
                return null;
            }
            $head = trim($head);
            if (! str_starts_with($head, 'ref: ')) {
                return substr($head, 0, 7);
            }
            $ref = substr($head, 5);
            $sha = @file_get_contents($git.'/'.$ref);
            if ($sha === false) {
                // A ref that only exists packed.
                $packed = @file_get_contents($git.'/packed-refs');
                if ($packed !== false && preg_match('/^([0-9a-f]{40}) '.preg_quote($ref, '/').'$/m', $packed, $m) === 1) {
                    $sha = $m[1];
                }
            }

            return is_string($sha) && trim($sha) !== '' ? substr(trim($sha), 0, 7) : null;
        } catch (Throwable) {
            return null;
        }
    }

    /** Every deploy rebuilds the config cache, so its file time is when this code went live. */
    private function deployedAt(): ?string
    {
        $file = base_path('bootstrap/cache/config.php');
        $time = is_file($file) ? @filemtime($file) : false;

        return $time === false ? null : Carbon::createFromTimestampUTC($time)->toIso8601String();
    }
}
