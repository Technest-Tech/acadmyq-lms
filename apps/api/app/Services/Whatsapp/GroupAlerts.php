<?php

declare(strict_types=1);

namespace App\Services\Whatsapp;

use App\Support\AcademyUrl;
use App\Support\AuthContext;
use App\Support\Entitlement;
use App\Support\Tenancy;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * The engine behind WhatsApp group alerts: every minute, for every academy with a linked group,
 * notice what became true, write it down once, and get it into the group.
 *
 * One run, per academy:
 *
 *   1. DETECT — ask each group's alert types what is currently true (a lesson started, a lesson is
 *      still unmarked N minutes in, money landed…) and insert one `whatsapp_group_alerts` row per
 *      (group, type, subject). The unique index makes re-detection free.
 *   2. RETIRE — an alert that stopped being true before it went out (the teacher marked the lesson,
 *      the report got written) is SKIPPED; one too old to be worth sending is EXPIRED.
 *   3. CLAIM + SEND — only while the number is connected. Due rows are claimed atomically, batched
 *      into one message per (group, type), and handed to the gateway, which answers on enqueue.
 *   4. CONFIRM — the gateway reports "sent" once WhatsApp took the message and "delivered" once a
 *      member's phone got it (webhook → {@see applyStatus()}). A message that has sat QUEUED with no
 *      word for a few minutes is looked up on the gateway; one it has lost goes back for a resend.
 *
 * Every instant this class compares is written from PHP with an explicit offset (see TS): the
 * Postgres session runs in another zone than the app, and a naive bind would shift a window by hours.
 * HTTP never runs inside a tenant transaction — each phase commits before the gateway is called.
 */
final class GroupAlerts
{
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    /**
     * How every instant is bound: an explicit offset (a naive string is read in the Postgres session's
     * zone) and microseconds (`toIso8601String()` drops them, which sorts a row written earlier in the
     * same second AFTER "now").
     */
    private const TS = 'Y-m-d\TH:i:s.uP';

    /** Tries per alert before it stays FAILED for good. */
    public const MAX_ATTEMPTS = 5;

    /**
     * A QUEUED message with no webhook after this long is looked up on the gateway. Short on purpose:
     * the gateway can report "sent" before this run has recorded the message id, and that report then
     * matches no row — the lookup is what heals it. Asking about a message still waiting its turn
     * costs one local request and changes nothing.
     */
    private const CONFIRM_AFTER_MINUTES = 3;

    /** A SENDING claim this old belongs to a run that died between claiming and recording. */
    private const STALE_CLAIM_MINUTES = 5;

    private const CLAIM_LIMIT = 150;

    private const DETECT_LIMIT = 500;

    public function __construct(
        private readonly WasenderClient $client,
        private readonly WhatsAppSender $sender,
        private readonly GroupAlertMessage $messages,
    ) {}

    /**
     * @return array<string, array{detected:int, messages:int, confirmed:int}>
     */
    public function run(?string $onlyAcademyId = null, ?CarbonImmutable $now = null): array
    {
        $now ??= CarbonImmutable::now();
        $results = [];

        foreach ($this->academyIds($onlyAcademyId) as $academyId) {
            try {
                $results[$academyId] = $this->runForAcademy($academyId, $now);
            } catch (Throwable $e) {
                // One academy's bad data must not starve every academy after it in the loop.
                Log::error('whatsapp group alerts: academy run failed', ['academy' => $academyId, 'err' => $e->getMessage()]);
            }
        }

        return $results;
    }

    /**
     * @return array{detected:int, messages:int, confirmed:int}
     */
    public function runForAcademy(string $academyId, CarbonImmutable $now): array
    {
        $result = ['detected' => 0, 'messages' => 0, 'confirmed' => 0];

        $setup = $this->inAcademy($academyId, function () use ($academyId): ?array {
            $groups = $this->activeGroups($academyId);
            if ($groups === []) {
                return null;
            }
            // A paused or unsold WhatsApp module stops the alerts; the groups stay linked for when it returns.
            if (! in_array('whatsapp.automation', Entitlement::resolve($academyId)['capabilities'], true)) {
                return null;
            }

            return [
                'groups' => $groups,
                'timezone' => $this->timezone($academyId),
                'token' => $this->sender->tokenFor($academyId),
            ];
        });

        if ($setup === null) {
            return $result;
        }

        $token = $setup['token'];
        $connected = $token !== null && $this->client->sessionStatus($token) === 'CONNECTED';

        [$detected, $claimed] = $this->inAcademy($academyId, function () use ($academyId, $setup, $connected, $now): array {
            [$inserted, $candidates] = $this->detect($academyId, $setup['groups'], $now);
            $this->retire($academyId, $setup['groups'], $candidates, $now);
            $this->recoverStaleClaims($academyId, $now);

            return [$inserted, $connected ? $this->claim($academyId, $now) : []];
        });
        $result['detected'] = $detected;

        if ($connected && $token !== null) {
            $outcomes = $this->dispatch($token, $setup['groups'], $claimed, $setup['timezone'], $now);
            if ($outcomes !== []) {
                $this->inAcademy($academyId, fn () => $this->record($academyId, $setup['groups'], $outcomes, $now));
            }
            $result['messages'] = count($outcomes);
            $result['confirmed'] = $this->confirm($academyId, $token, $now);
        }

        return $result;
    }

    /**
     * Send the operator's test message into a group right now, through the same ledger and the
     * same delivery tracking as a real alert — so "test worked" means the real path works.
     *
     * @return array{ok: bool, error: ?string, alert: ?object}
     */
    public function sendTest(string $academyId, string $groupId, ?string $sentBy, CarbonImmutable $now): array
    {
        $setup = $this->inAcademy($academyId, function () use ($academyId, $groupId): ?array {
            $group = $this->activeGroups($academyId)[$groupId] ?? null;

            return $group === null ? null : [
                'group' => $group,
                'timezone' => $this->timezone($academyId),
                'token' => $this->sender->tokenFor($academyId),
            ];
        });

        if ($setup === null) {
            return ['ok' => false, 'error' => 'group_inactive', 'alert' => null];
        }
        $token = $setup['token'];
        if ($token === null || $this->client->sessionStatus($token) !== 'CONNECTED') {
            return ['ok' => false, 'error' => 'not_connected', 'alert' => null];
        }

        $group = $setup['group'];
        $claimed = $this->inAcademy($academyId, function () use ($academyId, $group, $sentBy, $now): array {
            $id = (string) Str::uuid();
            DB::table('whatsapp_group_alerts')->insert([
                'id' => $id,
                'academy_id' => $academyId,
                'group_id' => $group->id,
                'event_type' => GroupAlertCatalog::TEST,
                'subject_key' => $id,
                'payload' => json_encode(['label' => $group->label ?? $group->name, 'by' => $sentBy], JSON_UNESCAPED_UNICODE),
                'due_at' => $now->format(self::TS),
                'status' => 'PENDING',
                'next_attempt_at' => $now->format(self::TS),
                'updated_at' => $now->format(self::TS),
            ]);

            return $this->claim($academyId, $now, [$id]);
        });

        $groups = [$group->id => $group];
        $outcomes = $this->dispatch($token, $groups, $claimed, $setup['timezone'], $now);
        $this->inAcademy($academyId, fn () => $this->record($academyId, $groups, $outcomes, $now));

        $alert = $this->inAcademy($academyId, fn () => DB::table('whatsapp_group_alerts')
            ->where('id', $claimed[0]->id ?? '')
            ->first());

        $outcome = $outcomes[0] ?? null;

        return ['ok' => (bool) ($outcome['ok'] ?? false), 'error' => $outcome['error'] ?? null, 'alert' => $alert];
    }

    /**
     * Apply a delivery report from the gateway to every alert that rode that WhatsApp message. Runs
     * inside the caller's academy context. States only move forward: a late "sent" never downgrades
     * a DELIVERED row.
     *
     * @return int rows changed
     */
    public function applyStatus(string $messageId, string $status, ?string $error, CarbonImmutable $now): int
    {
        $iso = $now->format(self::TS);
        $rows = fn () => DB::table('whatsapp_group_alerts')->where('provider_message_id', $messageId);

        return match (strtolower($status)) {
            'sent' => $rows()->where('status', 'QUEUED')
                ->update(['status' => 'SENT', 'sent_at' => $iso, 'error' => null, 'updated_at' => $iso]),
            'delivered' => $this->markDelivered($rows, $iso),
            'read', 'played' => $this->markDelivered($rows, $iso)
                + $rows()->where('status', 'DELIVERED')->whereNull('read_at')->update(['read_at' => $iso, 'updated_at' => $iso]),
            'failed' => $rows()->whereIn('status', ['QUEUED', 'SENT'])
                ->update(['status' => 'FAILED', 'error' => $error ?? 'send_failed', 'next_attempt_at' => $iso, 'updated_at' => $iso]),
            default => 0,
        };
    }

    // =========================================================================
    // 1 — Detect
    // =========================================================================

    /**
     * @param  array<string, object>  $groups
     * @return array{0: int, 1: array<string, array<string, array<string, true>>>} inserted count, and
     *                                                                             group → type → subject set
     */
    private function detect(string $academyId, array $groups, CarbonImmutable $now): array
    {
        $inserted = 0;
        $candidates = [];

        foreach ($groups as $group) {
            foreach ($group->events as $type) {
                $floor = $this->floorFor($group, $type);
                $found = match ($type) {
                    GroupAlertCatalog::SESSION_STARTED => $this->sessionsStarted($academyId, $floor, $now),
                    GroupAlertCatalog::SESSION_NOT_MARKED => $this->sessionsNotMarked($academyId, $floor, $group->settings['not_marked_after_minutes'], $now),
                    GroupAlertCatalog::REPORT_OVERDUE => $this->reportsOverdue($academyId, $floor, $group->settings['report_overdue_hours'], $now),
                    GroupAlertCatalog::PACKAGE_LOW => $this->packageNotifications($academyId, 'PACKAGE_LOW', GroupAlertCatalog::PACKAGE_LOW, $floor, $now),
                    GroupAlertCatalog::PACKAGE_ENDED => $this->packageNotifications($academyId, 'PACKAGE_COMPLETED', GroupAlertCatalog::PACKAGE_ENDED, $floor, $now),
                    GroupAlertCatalog::PAYMENT_RECEIVED => $this->payments($academyId, $floor, $now),
                    default => [],
                };

                $candidates[$group->id][$type] = [];
                if ($found === []) {
                    continue;
                }

                $rows = [];
                foreach ($found as $hit) {
                    $candidates[$group->id][$type][$hit['subject']] = true;
                    $rows[] = [
                        'id' => (string) Str::uuid(),
                        'academy_id' => $academyId,
                        'group_id' => $group->id,
                        'event_type' => $type,
                        'subject_key' => $hit['subject'],
                        'payload' => json_encode($hit['payload'], JSON_UNESCAPED_UNICODE),
                        'due_at' => $hit['due_at']->format(self::TS),
                        'status' => 'PENDING',
                        'next_attempt_at' => $now->format(self::TS),
                        'updated_at' => $now->format(self::TS),
                    ];
                }

                $inserted += DB::table('whatsapp_group_alerts')->insertOrIgnore($rows);
            }
        }

        return [$inserted, $candidates];
    }

    /**
     * Lessons whose start time has come and that are still just "scheduled" — not already marked,
     * and not waiting on a cancellation the owner has yet to approve.
     *
     * @return list<array{subject: string, due_at: CarbonImmutable, payload: array<string,mixed>}>
     */
    private function sessionsStarted(string $academyId, CarbonImmutable $floor, CarbonImmutable $now): array
    {
        $lower = $this->later($floor, $now->subMinutes(GroupAlertCatalog::MAX_AGE_MINUTES[GroupAlertCatalog::SESSION_STARTED]));

        $rows = $this->sessionQuery($academyId)
            ->where('se.status', 'SCHEDULED')
            ->where('se.scheduled_at_utc', '>=', $lower->format(self::TS))
            ->where('se.scheduled_at_utc', '<=', $now->format(self::TS))
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))
                ->from('session_cancellation_requests as r')
                ->whereColumn('r.session_id', 'se.id')
                ->where('r.status', 'PENDING')
                ->where('r.request_type', 'CANCEL'))
            ->get();

        return $rows->map(fn (object $s): array => [
            'subject' => (string) $s->id,
            'due_at' => CarbonImmutable::parse($s->scheduled_at_utc),
            'payload' => $this->sessionPayload($s),
        ])->all();
    }

    /**
     * Lessons N minutes past their start that nobody has marked — no attendance, no absence, no
     * cancellation, no pending request from the teacher (a request IS the teacher acting), and no
     * supervisor who pressed "Following" (someone is already on it, so there is nobody to remind).
     *
     * @return list<array{subject: string, due_at: CarbonImmutable, payload: array<string,mixed>}>
     */
    private function sessionsNotMarked(string $academyId, CarbonImmutable $floor, int $afterMinutes, CarbonImmutable $now): array
    {
        $lowerDue = $this->later($floor, $now->subMinutes(GroupAlertCatalog::MAX_AGE_MINUTES[GroupAlertCatalog::SESSION_NOT_MARKED]));

        $rows = $this->sessionQuery($academyId)
            ->where('se.status', 'SCHEDULED')
            ->where('se.scheduled_at_utc', '>=', $lowerDue->subMinutes($afterMinutes)->format(self::TS))
            ->where('se.scheduled_at_utc', '<=', $now->subMinutes($afterMinutes)->format(self::TS))
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))
                ->from('session_cancellation_requests as r')
                ->whereColumn('r.session_id', 'se.id')
                ->where('r.status', 'PENDING'))
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))
                ->from('session_follow_ups as f')
                ->whereColumn('f.session_id', 'se.id'))
            ->get();

        return $rows->map(fn (object $s): array => [
            'subject' => (string) $s->id,
            'due_at' => CarbonImmutable::parse($s->scheduled_at_utc)->addMinutes($afterMinutes),
            'payload' => $this->sessionPayload($s),
        ])->all();
    }

    /**
     * Lessons marked as held (attended, or a free lesson) with no report N hours after they ended.
     *
     * @return list<array{subject: string, due_at: CarbonImmutable, payload: array<string,mixed>}>
     */
    private function reportsOverdue(string $academyId, CarbonImmutable $floor, int $hours, CarbonImmutable $now): array
    {
        $graceMinutes = $hours * 60;
        $lowerDue = $this->later($floor, $now->subMinutes(GroupAlertCatalog::MAX_AGE_MINUTES[GroupAlertCatalog::REPORT_OVERDUE]));

        $rows = $this->sessionQuery($academyId)
            ->whereIn('se.status', ['ATTENDED', 'FREE'])
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))
                ->from('session_reports as sr')
                ->whereColumn('sr.session_id', 'se.id'))
            // A coarse bound on the raw column keeps the calendar index in play; the exact due-time
            // window below it is what decides.
            ->where('se.scheduled_at_utc', '>=', $lowerDue->subMinutes($graceMinutes)->subDay()->format(self::TS))
            ->where('se.scheduled_at_utc', '<=', $now->format(self::TS))
            ->whereRaw('se.scheduled_at_utc + make_interval(mins => se.duration_minutes + ?) <= ?::timestamptz', [$graceMinutes, $now->format(self::TS)])
            ->whereRaw('se.scheduled_at_utc + make_interval(mins => se.duration_minutes + ?) >= ?::timestamptz', [$graceMinutes, $lowerDue->format(self::TS)])
            ->get();

        return $rows->map(fn (object $s): array => [
            'subject' => (string) $s->id,
            'due_at' => CarbonImmutable::parse($s->scheduled_at_utc)->addMinutes((int) $s->duration_minutes + $graceMinutes),
            'payload' => $this->sessionPayload($s),
        ])->all();
    }

    /**
     * The package engine already raises PACKAGE_LOW / PACKAGE_COMPLETED owner notifications, deduped
     * per package; this relays them rather than re-deriving balances a second way.
     *
     * @return list<array{subject: string, due_at: CarbonImmutable, payload: array<string,mixed>}>
     */
    private function packageNotifications(string $academyId, string $notificationType, string $alertType, CarbonImmutable $floor, CarbonImmutable $now): array
    {
        $lower = $this->later($floor, $now->subMinutes(GroupAlertCatalog::MAX_AGE_MINUTES[$alertType]));
        $frontend = AcademyUrl::origin($academyId);

        $rows = DB::table('notifications as n')
            ->leftJoin('lesson_packages as p', 'p.id', '=', 'n.subject_id')
            ->leftJoin('students as st', 'st.id', '=', 'p.student_id')
            ->leftJoin('guardians as g', 'g.id', '=', 'st.guardian_id')
            ->leftJoin('invoices as i', 'i.id', '=', 'p.invoice_id')
            ->where('n.academy_id', $academyId)
            ->where('n.type', $notificationType)
            ->where('n.created_at', '>=', $lower->format(self::TS))
            ->orderBy('n.created_at')
            ->limit(self::DETECT_LIMIT)
            ->get([
                'n.id', 'n.created_at', 'n.data', 'p.label',
                'st.full_name as student', 'g.full_name as guardian', 'g.whatsapp_phone as guardian_phone',
                'i.status as invoice_status', 'i.public_token as invoice_token',
            ]);

        return $rows->map(function (object $n) use ($frontend): array {
            $data = json_decode((string) $n->data, true) ?: [];
            $unpaidInvoice = $n->invoice_token !== null && ! in_array($n->invoice_status, ['PAID', 'VOID'], true);

            return [
                'subject' => (string) $n->id,
                'due_at' => CarbonImmutable::parse($n->created_at),
                'payload' => [
                    'student' => $n->student ?? ($data['student_name'] ?? null),
                    'label' => $n->label ?? ($data['label'] ?? null),
                    'guardian' => $n->guardian,
                    'guardian_phone' => $n->guardian_phone,
                    'minutes_left' => $data['minutes_left'] ?? null,
                    'reason' => $data['reason'] ?? null,
                    'minutes_consumed' => $data['minutes_consumed'] ?? null,
                    'minutes_overdrawn' => $data['minutes_overdrawn'] ?? null,
                    'invoice_url' => $unpaidInvoice ? $frontend.'/i/'.$n->invoice_token : null,
                ],
            ];
        })->all();
    }

    /**
     * @return list<array{subject: string, due_at: CarbonImmutable, payload: array<string,mixed>}>
     */
    private function payments(string $academyId, CarbonImmutable $floor, CarbonImmutable $now): array
    {
        $lower = $this->later($floor, $now->subMinutes(GroupAlertCatalog::MAX_AGE_MINUTES[GroupAlertCatalog::PAYMENT_RECEIVED]));

        $rows = DB::table('invoice_payment_events as e')
            ->join('invoices as i', 'i.id', '=', 'e.invoice_id')
            ->leftJoin('guardians as g', 'g.id', '=', 'i.guardian_id')
            ->leftJoin('students as s', 's.id', '=', 'i.student_id')
            ->where('e.academy_id', $academyId)
            ->where('e.occurred_at', '>=', $lower->format(self::TS))
            ->orderBy('e.occurred_at')
            ->limit(self::DETECT_LIMIT)
            ->get([
                'e.id', 'e.occurred_at', 'e.amount_minor', 'e.paid_total_minor', 'e.invoice_total_minor',
                'e.currency', 'e.status_after', 'e.payment_method', 'i.period_month', 'i.period_year',
                DB::raw('coalesce(g.full_name, s.full_name, i.payer_name) as payer'),
            ]);

        return $rows->map(fn (object $e): array => [
            'subject' => (string) $e->id,
            'due_at' => CarbonImmutable::parse($e->occurred_at),
            'payload' => [
                'payer' => $e->payer,
                'amount_minor' => (int) $e->amount_minor,
                'paid_total_minor' => (int) $e->paid_total_minor,
                'invoice_total_minor' => (int) $e->invoice_total_minor,
                'currency' => trim((string) $e->currency),
                'status' => (string) $e->status_after,
                'method' => $e->payment_method,
                'period' => $e->period_month !== null ? $e->period_month.'/'.$e->period_year : null,
            ],
        ])->all();
    }

    private function sessionQuery(string $academyId): Builder
    {
        return DB::table('sessions as se')
            ->join('students as st', 'st.id', '=', 'se.student_id')
            ->leftJoin('teachers as te', 'te.id', '=', 'se.teacher_id')
            ->where('se.academy_id', $academyId)
            ->whereNull('st.deleted_at')
            ->orderBy('se.scheduled_at_utc')
            ->limit(self::DETECT_LIMIT)
            ->select(['se.id', 'se.scheduled_at_utc', 'se.duration_minutes', 'st.full_name as student', 'te.full_name as teacher']);
    }

    /** @return array<string,mixed> */
    private function sessionPayload(object $s): array
    {
        return [
            'student' => $s->student,
            'teacher' => $s->teacher,
            'starts_at' => CarbonImmutable::parse($s->scheduled_at_utc)->utc()->format(self::TS),
            'duration_minutes' => (int) $s->duration_minutes,
        ];
    }

    // =========================================================================
    // 2 — Retire
    // =========================================================================

    /**
     * @param  array<string, object>  $groups
     * @param  array<string, array<string, array<string, true>>>  $candidates
     */
    private function retire(string $academyId, array $groups, array $candidates, CarbonImmutable $now): void
    {
        $iso = $now->format(self::TS);

        foreach (GroupAlertCatalog::MAX_AGE_MINUTES as $type => $maxAge) {
            DB::table('whatsapp_group_alerts')
                ->where('academy_id', $academyId)
                ->where('event_type', $type)
                ->whereIn('status', ['PENDING', 'FAILED'])
                ->where('attempts', '<', self::MAX_ATTEMPTS)
                ->where('due_at', '<', $now->subMinutes($maxAge)->format(self::TS))
                ->update(['status' => 'EXPIRED', 'updated_at' => $iso]);
        }

        $open = DB::table('whatsapp_group_alerts')
            ->where('academy_id', $academyId)
            ->whereIn('status', ['PENDING', 'FAILED'])
            ->where('attempts', '<', self::MAX_ATTEMPTS)
            ->where('event_type', '<>', GroupAlertCatalog::TEST)
            ->limit(2000)
            ->get(['id', 'group_id', 'event_type', 'subject_key']);

        $disabled = [];
        $resolved = [];
        foreach ($open as $row) {
            $group = $groups[(string) $row->group_id] ?? null;
            if ($group === null || ! in_array($row->event_type, $group->events, true)) {
                $disabled[] = $row->id;
            } elseif (in_array($row->event_type, GroupAlertCatalog::CONDITIONAL, true)
                && ! isset($candidates[$group->id][$row->event_type][$row->subject_key])) {
                $resolved[] = $row->id;
            }
        }

        foreach ([['alert_turned_off', $disabled], ['no_longer_true', $resolved]] as [$reason, $ids]) {
            foreach (array_chunk($ids, 500) as $chunk) {
                DB::table('whatsapp_group_alerts')->whereIn('id', $chunk)
                    ->update(['status' => 'SKIPPED', 'error' => $reason, 'updated_at' => $iso]);
            }
        }
    }

    private function recoverStaleClaims(string $academyId, CarbonImmutable $now): void
    {
        DB::table('whatsapp_group_alerts')
            ->where('academy_id', $academyId)
            ->where('status', 'SENDING')
            ->where('updated_at', '<', $now->subMinutes(self::STALE_CLAIM_MINUTES)->format(self::TS))
            ->update(['status' => 'PENDING', 'updated_at' => $now->format(self::TS)]);
    }

    // =========================================================================
    // 3 — Claim, send, record
    // =========================================================================

    /**
     * Atomically take due alerts for this run. `skip locked` + the status flip mean two overlapping
     * runs can never both send the same row.
     *
     * @param  list<string>|null  $onlyIds
     * @return list<object>
     */
    private function claim(string $academyId, CarbonImmutable $now, ?array $onlyIds = null): array
    {
        $iso = $now->format(self::TS);
        $filter = '';
        $bindings = [$iso, $academyId, self::MAX_ATTEMPTS, $iso];

        if ($onlyIds !== null) {
            if ($onlyIds === []) {
                return [];
            }
            $filter = ' and id in ('.implode(',', array_fill(0, count($onlyIds), '?')).')';
            $bindings = [...$bindings, ...$onlyIds];
        }
        $bindings[] = self::CLAIM_LIMIT;

        return DB::select(<<<SQL
            update whatsapp_group_alerts a
               set status = 'SENDING', attempts = a.attempts + 1, updated_at = ?
             where a.id in (
               select id from whatsapp_group_alerts
                where academy_id = ?
                  and status in ('PENDING', 'FAILED')
                  and attempts < ?
                  and next_attempt_at <= ?{$filter}
                order by due_at
                limit ?
                for update skip locked
             )
            returning a.id, a.group_id, a.event_type, a.subject_key, a.payload, a.due_at, a.attempts
        SQL, $bindings);
    }

    /**
     * Batch claimed alerts into one message per (group, type) — split past MAX_ITEMS — and hand each
     * to the gateway. No database work here: the caller records the outcomes in its own transaction.
     *
     * @param  array<string, object>  $groups
     * @param  list<object>  $claimed
     * @return list<array{group_id: string, event_type: string, ids: list<string>, ok: bool, message_id: ?string, error: ?string}>
     */
    private function dispatch(string $token, array $groups, array $claimed, string $timezone, CarbonImmutable $now): array
    {
        $batches = [];
        foreach ($claimed as $row) {
            $batches[$row->group_id.'|'.$row->event_type][] = $row;
        }

        $outcomes = [];
        foreach ($batches as $rows) {
            usort($rows, fn (object $a, object $b): int => strcmp((string) $a->due_at, (string) $b->due_at));
            $group = $groups[(string) $rows[0]->group_id] ?? null;
            $type = (string) $rows[0]->event_type;

            foreach (array_chunk($rows, GroupAlertMessage::MAX_ITEMS) as $chunk) {
                $ids = array_map(fn (object $r): string => (string) $r->id, $chunk);

                if ($group === null) {
                    $outcomes[] = ['group_id' => (string) $chunk[0]->group_id, 'event_type' => $type, 'ids' => $ids, 'ok' => false, 'message_id' => null, 'error' => 'group_unavailable'];

                    continue;
                }

                $text = $this->messages->compose(
                    $type,
                    array_map(fn (object $r): array => json_decode((string) $r->payload, true) ?: [], $chunk),
                    $group->language,
                    $timezone,
                    $group->settings,
                    $now,
                );

                $res = $this->client->sendMessage($token, $group->jid, $text);
                $outcomes[] = [
                    'group_id' => $group->id,
                    'event_type' => $type,
                    'ids' => $ids,
                    'ok' => $res['ok'] && $res['message_id'] !== null,
                    'message_id' => $res['message_id'],
                    'error' => $res['ok'] && $res['message_id'] === null ? 'no_message_id' : $res['error'],
                ];
            }
        }

        return $outcomes;
    }

    /**
     * @param  array<string, object>  $groups
     * @param  list<array{group_id: string, event_type: string, ids: list<string>, ok: bool, message_id: ?string, error: ?string}>  $outcomes
     */
    private function record(string $academyId, array $groups, array $outcomes, CarbonImmutable $now): void
    {
        $iso = $now->format(self::TS);

        foreach ($outcomes as $o) {
            if ($o['ok']) {
                DB::table('whatsapp_group_alerts')->whereIn('id', $o['ids'])->update([
                    'status' => 'QUEUED',
                    'provider_message_id' => $o['message_id'],
                    'queued_at' => $iso,
                    'error' => null,
                    'updated_at' => $iso,
                ]);
            } else {
                // Back off 1, 2, 4… minutes (capped) so a flapping session is not hammered every run.
                DB::table('whatsapp_group_alerts')->whereIn('id', $o['ids'])->update([
                    'status' => 'FAILED',
                    'error' => $o['error'] ?? 'send_failed',
                    'next_attempt_at' => DB::raw("'".$iso."'::timestamptz + make_interval(mins => least(30, power(2, greatest(attempts - 1, 0))::int))"),
                    'updated_at' => $iso,
                ]);
            }

            // Every WhatsApp message the platform sends is in the send log — group alerts included —
            // so the Super Admin activity feed and per-client counts stay whole. Its own savepoint: a
            // rejected insert poisons the surrounding Postgres transaction even when PHP catches it,
            // and the delivery record above matters more than the log line.
            try {
                DB::transaction(fn () => DB::table('automation_send_log')->insert([
                    'id' => (string) Str::uuid(),
                    'academy_id' => $academyId,
                    'automation_type' => 'GROUP_ALERT',
                    'channel' => 'WHATSAPP',
                    'transport' => 'WASENDER',
                    'recipient_kind' => 'GROUP',
                    'recipient_phone' => $groups[$o['group_id']]->jid ?? null,
                    'template_key' => $o['event_type'],
                    'ref_type' => 'whatsapp_group',
                    'ref_id' => $o['group_id'],
                    'status' => $o['ok'] ? 'SENT' : 'FAILED',
                    'error' => $o['ok'] ? null : $o['error'],
                    'provider_message_id' => $o['message_id'],
                ]));
            } catch (Throwable $e) {
                Log::warning('whatsapp group alerts: send log insert failed', ['err' => $e->getMessage()]);
            }
        }
    }

    // =========================================================================
    // 4 — Confirm
    // =========================================================================

    /**
     * Look up messages the gateway accepted but never reported on. A restart empties its in-memory
     * queue, and without this those alerts would read "queued" forever.
     */
    private function confirm(string $academyId, string $token, CarbonImmutable $now): int
    {
        $ids = $this->inAcademy($academyId, fn () => DB::table('whatsapp_group_alerts')
            ->where('academy_id', $academyId)
            ->where('status', 'QUEUED')
            ->whereNotNull('provider_message_id')
            ->where('queued_at', '<', $now->subMinutes(self::CONFIRM_AFTER_MINUTES)->format(self::TS))
            ->distinct()
            ->limit(25)
            ->pluck('provider_message_id')
            ->map(fn ($id) => (string) $id)
            ->all());

        $changed = 0;
        foreach ($ids as $messageId) {
            $state = $this->client->messageState($token, $messageId);
            // No answer (unreachable, or a gateway without the route) is not evidence of loss.
            if ($state === null || $state['state'] === 'queued') {
                continue;
            }

            [$status, $error] = match ($state['state']) {
                'sent' => ['sent', null],
                'failed' => ['failed', $state['error'] ?? 'send_failed'],
                default => ['failed', 'lost_by_gateway'],
            };

            $changed += $this->inAcademy($academyId, fn () => $this->applyStatus($messageId, $status, $error, $now));
        }

        return $changed;
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /**
     * Linked, active groups keyed by id, with their JSON columns decoded.
     *
     * @return array<string, object>
     */
    public function activeGroups(string $academyId): array
    {
        $groups = [];
        foreach (DB::table('whatsapp_groups')->where('academy_id', $academyId)->where('is_active', true)->get() as $g) {
            $g->id = (string) $g->id;
            $g->events = GroupAlertCatalog::decodeEvents($g->events);
            $g->settings = GroupAlertCatalog::decodeSettings($g->settings);
            $since = is_string($g->event_since) ? json_decode($g->event_since, true) : $g->event_since;
            $g->event_since = is_array($since) ? $since : [];
            $groups[$g->id] = $g;
        }

        return $groups;
    }

    /** The instant this alert type was switched on for the group — nothing before it is reported. */
    private function floorFor(object $group, string $type): CarbonImmutable
    {
        $since = $group->event_since[$type] ?? null;

        return is_string($since) && $since !== ''
            ? CarbonImmutable::parse($since)
            : CarbonImmutable::parse($group->created_at);
    }

    private function later(CarbonImmutable $a, CarbonImmutable $b): CarbonImmutable
    {
        return $a->greaterThan($b) ? $a : $b;
    }

    private function markDelivered(\Closure $rows, string $iso): int
    {
        $rows()->whereIn('status', ['QUEUED', 'SENT'])->whereNull('sent_at')->update(['sent_at' => $iso]);

        return $rows()->whereIn('status', ['QUEUED', 'SENT'])
            ->update(['status' => 'DELIVERED', 'delivered_at' => $iso, 'error' => null, 'updated_at' => $iso]);
    }

    private function timezone(string $academyId): string
    {
        return (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?? 'UTC');
    }

    /** @return list<string> */
    private function academyIds(?string $onlyAcademyId): array
    {
        if ($onlyAcademyId !== null) {
            return [$onlyAcademyId];
        }

        TenantContext::apply(userId: self::SYSTEM_USER_ID, academyId: null, role: 'SUPER_ADMIN', local: false);
        try {
            return DB::table('academies')
                ->whereIn('status', ['ACTIVE', 'TRIAL'])
                ->pluck('id')
                ->map(fn ($id) => (string) $id)
                ->all();
        } finally {
            TenantContext::clear();
        }
    }

    /**
     * @template T
     *
     * @param  callable():T  $fn
     * @return T
     */
    private function inAcademy(string $academyId, callable $fn): mixed
    {
        return Tenancy::withContext(
            new AuthContext(userId: self::SYSTEM_USER_ID, academyId: $academyId, role: 'SUPER_ADMIN', permissions: []),
            $fn,
        );
    }
}
