<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Carbon;

/**
 * Super Admin → System health → "needs attention": which clients need the platform owner to step
 * in, and why. It turns the facts `app.admin_client_health()` reads (plus each client's account in
 * the book) into a short list of named problems per client.
 *
 * Every rule lives here, with its threshold as a constant, so "is this worth interrupting the
 * owner for" can be retuned in one place. A rule reports what IS, never a guess: a client that
 * never linked a number is not "disconnected", and a new client is not "inactive".
 *
 *   CRIT  the client is being hurt now (reminders not going out, lessons stopped, money late)
 *   WARN  it will hurt soon, or it is drifting
 */
final class ClientAttention
{
    /** Unmarked lessons older than this are a habit, not a busy day. */
    public const OVERDUE_WARN_DAYS = 3;

    public const OVERDUE_CRIT_DAYS = 14;

    public const OVERDUE_CRIT_COUNT = 50;

    /** Mirrors the clients roster (client-summary.ts): nobody signed in for two weeks. */
    public const INACTIVE_AFTER_DAYS = 14;

    public const NEVER_SIGNED_IN_AFTER_DAYS = 3;

    public const TRIAL_SOON_DAYS = 3;

    /** A handful of failed sends is noise (a wrong number); this many in a day is a pattern. */
    public const WA_FAILED_MIN = 5;

    /**
     * @param  list<array<string,mixed>>  $facts  rows of app.admin_client_health()
     * @param  array<string, array<string,mixed>>  $accounts  FinanceLedger::summariesByAcademy()
     * @return array{clients: list<array<string,mixed>>, counts: array{clients: int, crit: int, warn: int}}
     */
    public static function inbox(array $facts, array $accounts, ?Carbon $now = null): array
    {
        $now ??= now();
        $clients = [];

        foreach ($facts as $row) {
            // A suspended client is switched off on purpose: nothing about it needs chasing here.
            if (($row['status'] ?? null) === 'SUSPENDED') {
                continue;
            }

            $items = self::items($row, $accounts[(string) $row['id']] ?? null, $now);
            if ($items === []) {
                continue;
            }

            usort($items, fn (array $a, array $b): int => SystemHealth::rank($b['severity']) <=> SystemHealth::rank($a['severity']));
            $clients[] = [
                'id' => (string) $row['id'],
                'name' => (string) $row['name'],
                'client_type' => $row['client_type'] ?? null,
                'severity' => $items[0]['severity'],
                'items' => $items,
            ];
        }

        // Worst first, then whoever has the most wrong, then by name so the order is stable.
        usort($clients, fn (array $a, array $b): int => [SystemHealth::rank($b['severity']), count($b['items']), $a['name']]
            <=> [SystemHealth::rank($a['severity']), count($a['items']), $b['name']]);

        return [
            'clients' => $clients,
            'counts' => [
                'clients' => count($clients),
                'crit' => count(array_filter($clients, fn (array $c): bool => $c['severity'] === 'CRIT')),
                'warn' => count(array_filter($clients, fn (array $c): bool => $c['severity'] === 'WARN')),
            ],
        ];
    }

    /**
     * @param  array<string,mixed>  $row
     * @param  array<string,mixed>|null  $account
     * @return list<array{code: string, severity: string, params: array<string,mixed>}>
     */
    public static function items(array $row, ?array $account, Carbon $now): array
    {
        $items = [];
        $add = function (string $code, string $severity, array $params = []) use (&$items): void {
            $items[] = ['code' => $code, 'severity' => $severity, 'params' => $params];
        };

        $modules = is_array($row['modules'] ?? null) ? $row['modules'] : [];
        $management = in_array('MANAGEMENT', $modules, true);

        // ── WhatsApp ────────────────────────────────────────────────────────────────────────
        // A number that was linked and is no longer connected. Never-linked (no state at all) is
        // a client that has not set WhatsApp up, which is not an incident.
        $state = $row['wa_status'] ?? null;
        $live = (bool) ($row['reminders_live'] ?? false);
        // A pairing in progress (QR on screen) is not a drop — unless reminders are already live.
        $pairing = in_array($state, ['QR', 'CONNECTING'], true) && ! $live;
        if (is_string($state) && $state !== '' && $state !== 'CONNECTED' && ! $pairing) {
            $add('whatsapp_disconnected', $live ? 'CRIT' : 'WARN', ['state' => $state, 'reminders_live' => $live]);
        } elseif ($live && $state === null) {
            // Reminders were launched but no number is linked at all.
            $add('whatsapp_disconnected', 'CRIT', ['state' => null, 'reminders_live' => true]);
        }

        $failed = (int) ($row['wa_failed_24h'] ?? 0);
        $sent = (int) ($row['wa_sent_24h'] ?? 0);
        if ($failed >= self::WA_FAILED_MIN && $failed > $sent) {
            $add('whatsapp_failing', $sent === 0 ? 'CRIT' : 'WARN', ['failed' => $failed, 'sent' => $sent]);
        }

        // ── Lessons ─────────────────────────────────────────────────────────────────────────
        if ($management) {
            // Lessons were happening, there are live timetables, and nothing is scheduled for the
            // coming week: the roll-forward stopped producing for this client.
            if ((int) ($row['active_schedules'] ?? 0) > 0
                && (int) ($row['lessons_last_14d'] ?? 0) > 0
                && (int) ($row['lessons_next_7d'] ?? 0) === 0) {
                $add('lessons_stopped', 'CRIT', ['schedules' => (int) $row['active_schedules']]);
            }

            $overdue = (int) ($row['overdue_lessons'] ?? 0);
            $oldest = self::daysSince($row['oldest_overdue_end'] ?? null, $now);
            if ($overdue > 0 && $oldest !== null && $oldest >= self::OVERDUE_WARN_DAYS) {
                $crit = $oldest >= self::OVERDUE_CRIT_DAYS || $overdue >= self::OVERDUE_CRIT_COUNT;
                $add('overdue_lessons', $crit ? 'CRIT' : 'WARN', ['count' => $overdue, 'oldest_days' => $oldest]);
            }
        }

        // ── Money and the trial ─────────────────────────────────────────────────────────────
        if ($account !== null && ($account['has_overdue'] ?? false)) {
            $add('bills_overdue', 'CRIT', ['overdue' => $account['overdue'] ?? []]);
        }

        $trialEnd = $row['trial_end'] ?? null;
        if (is_string($trialEnd) && $trialEnd !== '') {
            $end = Carbon::parse($trialEnd);
            if ($end->lessThan($now)) {
                $add('trial_ended', 'CRIT', ['days' => (int) floor($end->diffInDays($now, true))]);
            } elseif ($end->lessThanOrEqualTo($now->copy()->addDays(self::TRIAL_SOON_DAYS))) {
                $add('trial_ending', 'WARN', ['days' => (int) ceil($now->diffInHours($end, true) / 24)]);
            }
        }

        // ── Is anyone there? ────────────────────────────────────────────────────────────────
        // Only a client that has a login to use: a WhatsApp-only client never signs in.
        if ($management) {
            $since = self::daysSince($row['last_login_at'] ?? null, $now);
            if ($since === null) {
                $age = self::daysSince($row['created_at'] ?? null, $now) ?? 0;
                if ($age >= self::NEVER_SIGNED_IN_AFTER_DAYS) {
                    $add('never_signed_in', 'WARN', ['days' => $age]);
                }
            } elseif ($since >= self::INACTIVE_AFTER_DAYS) {
                $add('inactive', 'WARN', ['days' => $since]);
            }
        }

        return $items;
    }

    /** Whole days since a timestamp, or null when there is none. */
    private static function daysSince(mixed $at, Carbon $now): ?int
    {
        if (! is_string($at) || $at === '') {
            return null;
        }

        return max(0, (int) floor(Carbon::parse($at)->diffInDays($now, true)));
    }
}
