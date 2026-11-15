<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * When did each background task last FINISH, and when did it last fail?
 *
 * The schedule log only says a job was queued: `roll-session-window` read DONE every night for a
 * week in October while the job itself died on the queue each time. These stamps are written where
 * the work actually ends — by the queue worker after a job is processed or fails (see
 * AppServiceProvider), and by a scheduled command on its way out — so Super Admin → System health
 * can say "last finished 02:31" instead of "was asked to run".
 *
 * Plain cache keys, one per fact, so two workers finishing at once never overwrite each other.
 * A stamp never throws: bookkeeping must not be the reason a job fails.
 */
final class JobRuns
{
    /** Long enough to outlive the monthly jobs' gap between runs. */
    private const TTL_DAYS = 70;

    /** A finished run. `$task` is a job class (any namespace) or a scheduled command's name. */
    public static function ok(string $task): void
    {
        self::put('ok', $task, ['at' => now()->toIso8601String()]);
    }

    public static function failed(string $task, ?string $error): void
    {
        self::put('failed', $task, [
            'at' => now()->toIso8601String(),
            'error' => $error === null ? null : mb_substr(self::firstLine($error), 0, 300),
        ]);
    }

    /** @return array{ok_at: ?string, failed_at: ?string, error: ?string} */
    public static function of(string $task): array
    {
        $ok = self::get('ok', $task);
        $failed = self::get('failed', $task);

        return [
            'ok_at' => $ok['at'] ?? null,
            'failed_at' => $failed['at'] ?? null,
            'error' => $failed['error'] ?? null,
        ];
    }

    /**
     * The scheduler's own minute: publish what is scheduled (the schedule only exists in the console,
     * and the panel is a web request) and remember since when runs are being tracked — a job nobody
     * has seen finish is "late" only if tracking was already on when it was due.
     */
    public static function publishSchedule(Schedule $schedule): void
    {
        try {
            $tasks = [];
            foreach ($schedule->events() as $event) {
                $name = (string) $event->description;
                if ($name === '' || $name === 'scheduler-heartbeat') {
                    continue;
                }
                $tasks[] = [
                    'name' => $name,
                    'cron' => $event->expression,
                    'timezone' => $event->timezone instanceof \DateTimeZone
                        ? $event->timezone->getName()
                        : ($event->timezone ?: null),
                ];
            }
            Cache::put('scheduler.tasks', $tasks, now()->addDays(2));
            Cache::add('job_runs.tracking_since', now()->toIso8601String(), now()->addYears(5));
        } catch (Throwable) {
            // The heartbeat itself matters more than the catalogue.
        }
    }

    /** @return list<array{name: string, cron: string, timezone: ?string}> */
    public static function schedule(): array
    {
        $tasks = Cache::get('scheduler.tasks');

        return is_array($tasks) ? array_values($tasks) : [];
    }

    public static function trackingSince(): ?string
    {
        $since = Cache::get('job_runs.tracking_since');

        return is_string($since) ? $since : null;
    }

    /** `App\Jobs\RollSessionWindowJob` → `RollSessionWindowJob`; a command name stays as it is. */
    public static function key(string $task): string
    {
        $pos = strrpos($task, '\\');

        return $pos === false ? $task : substr($task, $pos + 1);
    }

    /** @param array<string,mixed> $value */
    private static function put(string $kind, string $task, array $value): void
    {
        try {
            Cache::put("job_runs.{$kind}.".self::key($task), $value, now()->addDays(self::TTL_DAYS));
        } catch (Throwable) {
            // Never fail a job over its own bookkeeping.
        }
    }

    /** @return array<string,mixed> */
    private static function get(string $kind, string $task): array
    {
        try {
            $value = Cache::get("job_runs.{$kind}.".self::key($task));
        } catch (Throwable) {
            return [];
        }

        return is_array($value) ? $value : [];
    }

    private static function firstLine(string $text): string
    {
        return trim((string) strtok($text, "\n"));
    }
}
