<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\LessonPackages;
use App\Services\ModuleBilling;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Entitlement;
use App\Support\LessonCount;
use App\Support\Tenancy;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The data move of docs/centre-profile/01-PRIVATE-SUBSCRIPTION-SPLIT.md: a centre's `lesson_packages`
 * become `centre_subscriptions`, their credits become `centre_subscription_lessons`. Bills, lines,
 * receipts, allocations and payouts are NOT touched — each new row only remembers which line is its
 * (found by what the line says, through LessonPackages::packageLineDescriptions, for the last time).
 *
 *   php artisan centre:migrate-packages <academy id | exact name> [--dry-run|--apply]
 *
 * Dry-run (the default) prints what would be written and the verification sums; `--apply` writes it
 * in one transaction and prints the same sums before and after. Idempotent: a package already moved
 * (`legacy_package_id`) is skipped. Only an academy holding `centre`.
 *
 * `--apply` also ends the old engine for this academy, in that same transaction: each moved row is
 * closed as history (no renewal held, no settlement waiting, nothing ACTIVE for an old reader to act
 * on; what it was goes in the audit row) and the `packages` switch goes off, so no lesson can be marked
 * between the move and the switch. `profile:set` afterwards moves the type and the rest of the preset.
 */
final class CentreMigratePackages extends Command
{
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    /** Why a package row stopped being live: it now reads as a centre subscription. */
    public const MOVED_REASON = 'MOVED_TO_SUBSCRIPTION';

    protected $signature = 'centre:migrate-packages
        {academy : The academy id, or its exact name}
        {--dry-run : Only print what would be written (the default)}
        {--apply : Write the rows}';

    protected $description = "Move a centre's lesson packages onto centre_subscriptions (lessons, one bill line each).";

    public function handle(LessonPackages $packages): int
    {
        $apply = (bool) $this->option('apply');
        $academy = $this->academy((string) $this->argument('academy'));
        if ($academy === null) {
            $this->error('No such academy.');

            return self::FAILURE;
        }
        $academyId = (string) $academy->id;
        $ctx = new AuthContext(userId: self::SYSTEM_USER_ID, academyId: $academyId, role: 'SUPER_ADMIN', permissions: []);

        return Tenancy::withContext($ctx, function () use ($academyId, $academy, $apply, $packages): int {
            if (! Entitlement::hasCapability($academyId, 'centre')) {
                $this->error("{$academy->name} is not a centre (no `centre` switch): nothing to move.");

                return self::FAILURE;
            }
            $this->line(($apply ? 'Moving' : 'Would move')." {$academy->name}'s packages onto centre_subscriptions.");
            $before = $this->sums($academyId);
            $this->printSums('Before', $before);

            $run = function () use ($academyId, $packages, $apply): array {
                $moved = $this->move($academyId, $packages, $apply);
                if ($apply) {
                    $this->endPackageEngine($academyId);
                }

                return $moved;
            };
            $result = $apply ? DB::transaction($run) : $run();

            $this->table(['Package', 'Student', 'Subject', 'Sold', 'Used', 'Status', 'Line'], $result['rows']);
            $this->line("Packages mapped: {$result['mapped']} (skipped, already moved: {$result['skipped']})");
            $this->line("Credits mapped: {$result['credits']}");
            $this->line("Unmapped lines (a bill but no line found): {$result['unmapped']}");
            foreach ($result['unmapped_ids'] as $id) {
                $this->warn("  package {$id} has a bill but its line was not found — the subscription carries invoice_id only");
            }
            foreach ($result['warnings'] as $warning) {
                $this->warn($warning);
            }
            $this->warnLessonsBeforeTheirBlock($academyId);

            $after = $this->sums($academyId);
            $this->printSums('After', $after);
            if ($after['lines'] !== $before['lines'] || $after['allocations'] !== $before['allocations']) {
                $this->error('Money moved — it must not. Investigate before deploying.');

                return self::FAILURE;
            }
            // Only the run that moved them can compare: lessons are counted and undone from then on.
            if ($apply && $result['skipped'] === 0) {
                $expected = (int) DB::table('lesson_packages')->where('academy_id', $academyId)->count();
                $got = (int) DB::table('centre_subscriptions')->where('academy_id', $academyId)->whereNotNull('legacy_package_id')->count();
                $credits = (int) DB::table('lesson_package_credits')->where('academy_id', $academyId)->count();
                $lessons = (int) DB::table('centre_subscription_lessons as l')->join('centre_subscriptions as cs', 'cs.id', '=', 'l.subscription_id')
                    ->where('l.academy_id', $academyId)->whereNotNull('cs.legacy_package_id')->count();
                $this->line("Verify: {$got}/{$expected} packages have a subscription row; {$lessons}/{$credits} credits have a lesson row.");
                if ($got !== $expected || $lessons !== $credits) {
                    $this->error('Counts do not match.');

                    return self::FAILURE;
                }
            }
            $this->info($apply ? 'Done.' : 'Dry run — nothing written. Run with --apply to write.');

            return self::SUCCESS;
        });
    }

    /** @return array{rows: list<array<int, mixed>>, mapped: int, skipped: int, credits: int, unmapped: int, unmapped_ids: list<string>, warnings: list<string>} */
    private function move(string $academyId, LessonPackages $packages, bool $apply): array
    {
        $out = ['rows' => [], 'mapped' => 0, 'skipped' => 0, 'credits' => 0, 'unmapped' => 0, 'unmapped_ids' => [], 'warnings' => []];
        $moved = DB::table('centre_subscriptions')->where('academy_id', $academyId)->whereNotNull('legacy_package_id')->pluck('legacy_package_id')->map(fn ($v) => (string) $v)->all();
        $blocks = DB::table('lesson_packages as p')->join('students as s', 's.id', '=', 'p.student_id')
            ->where('p.academy_id', $academyId)->orderBy('s.full_name')->orderBy('p.sequence_no')->get(['p.*', 's.full_name as student_name']);

        foreach ($blocks as $p) {
            if (in_array((string) $p->id, $moved, true)) {
                $out['skipped']++;

                continue;
            }
            $credits = DB::table('lesson_package_credits as c')->join('sessions as se', 'se.id', '=', 'c.session_id')
                ->where('c.package_id', $p->id)->orderBy('se.scheduled_at_utc')
                ->get(['c.session_id', 'c.minutes', 'c.consumed_at', 'se.scheduled_at_utc', 'se.teacher_id', 'se.schedule_id', 'se.course']);
            $length = $this->lessonLength($p, $credits);
            $capacity = (int) $p->minutes_total + (int) $p->carried_over_minutes;
            $sold = max(1, LessonCount::whole($capacity, $length));
            $used = $credits->count();
            $status = match ((string) $p->status) {
                'ACTIVE' => $used >= $sold ? 'FINISHED' : 'OPEN',
                'COMPLETED' => (string) $p->closed_reason === 'EXHAUSTED' || $used >= $sold ? 'FINISHED' : 'CLOSED',
                default => 'CANCELLED',
            };
            $lineId = null;
            if ($p->invoice_id !== null) {
                $lineId = DB::table('invoice_line_items')->where('invoice_id', $p->invoice_id)->whereNull('session_id')
                    ->whereIn('description', $packages->packageLineDescriptions((string) $p->label, (int) $p->minutes_total, (int) $p->carried_over_minutes, $p->lesson_minutes !== null ? (int) $p->lesson_minutes : null))
                    ->orderBy('created_at')->value('id');
                // A settled line says "— N used" after what it said; a cancelled one may too.
                if ($lineId === null) {
                    $lineId = DB::table('invoice_line_items')->where('invoice_id', $p->invoice_id)->whereNull('session_id')
                        ->where('description', 'like', '%'.$p->label.'%')->orderBy('created_at')->value('id');
                }
                if ($lineId === null) {
                    $out['unmapped']++;
                    $out['unmapped_ids'][] = (string) $p->id;
                }
            }
            $tz = (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC');
            $subject = $p->teacher_id !== null ? ((string) DB::table('teachers')->where('id', $p->teacher_id)->value('full_name')).($p->course !== null ? ' / '.$p->course : '') : '—';
            $out['rows'][] = [substr((string) $p->id, 0, 8), $p->student_name, $subject, $sold, $used, $status, $lineId !== null ? substr((string) $lineId, 0, 8) : ($p->invoice_id !== null ? 'MISSING' : '—')];
            $out['mapped']++;
            $out['credits'] += $used;
            array_push($out['warnings'], ...$this->notCarried($p, $sold, $used, $length, $status));
            if (! $apply) {
                continue;
            }

            $id = (string) Str::uuid();
            DB::table('centre_subscriptions')->insert([
                'id' => $id, 'academy_id' => $academyId, 'student_id' => (string) $p->student_id,
                'teacher_id' => $p->teacher_id !== null ? (string) $p->teacher_id : null, 'course' => $p->course,
                'label' => (string) $p->label, 'lessons_sold' => $sold, 'lesson_minutes' => $length,
                'lesson_price_minor' => (int) round((int) $p->price_minor / $sold), 'price_minor' => (int) $p->price_minor, 'currency' => (string) $p->currency,
                'starts_on' => (string) $p->starts_on, 'status' => $status,
                'finished_at' => $status === 'FINISHED' ? ($p->closed_at ?? now()) : null,
                'closed_at' => in_array($status, ['CLOSED', 'CANCELLED'], true) ? $p->closed_at : null,
                'closed_reason' => in_array($status, ['CLOSED', 'CANCELLED'], true) ? $p->closed_reason : null,
                'invoice_id' => $p->invoice_id, 'invoice_line_id' => $lineId,
                'settlement' => $p->settlement ?? null, 'settled_minor' => $p->settled_minor ?? null, 'settled_at' => $p->settled_at ?? null,
                'settled_by' => $p->settled_by ?? null, 'settle_note' => $p->settle_note ?? null, 'settle_expense_id' => $p->settle_expense_id ?? null,
                'sequence_no' => (int) $p->sequence_no, 'reminders_sent' => (int) ($p->reminders_sent ?? 0), 'last_reminded_at' => $p->last_reminded_at ?? null,
                'legacy_package_id' => (string) $p->id, 'opened_by' => $p->opened_by_user_id, 'created_at' => $p->created_at, 'updated_at' => now(),
            ]);
            foreach ($credits as $c) {
                $teacher = $c->schedule_id !== null ? DB::table('schedules')->where('id', $c->schedule_id)->value('teacher_id') : null;
                DB::table('centre_subscription_lessons')->insertOrIgnore([
                    'id' => (string) Str::uuid(), 'academy_id' => $academyId, 'subscription_id' => $id, 'session_id' => (string) $c->session_id,
                    'student_id' => (string) $p->student_id, 'teacher_id' => (string) ($teacher ?? $c->teacher_id),
                    'course' => $c->course !== null && trim((string) $c->course) !== '' ? trim((string) $c->course) : null,
                    'lesson_on' => \Illuminate\Support\Carbon::parse($c->scheduled_at_utc)->setTimezone($tz)->toDateString(),
                    'counted_at' => $c->consumed_at, 'created_at' => $c->consumed_at,
                ]);
            }
            Audit::log('centre_subscription.migrated', 'centre_subscription', $id, $academyId, null, 'SUPER_ADMIN',
                after: ['legacy_package_id' => (string) $p->id, 'lessons_sold' => $sold, 'lessons_used' => $used, 'status' => $status, 'invoice_line_id' => $lineId]);
            $this->closeAsHistory($p, $id, $academyId);
        }

        return $out;
    }

    /**
     * The package row stays for the record, but nothing may act on it again: an ACTIVE row would be
     * ended by a student's removal or a cancelled charge, a held renewal would open a new block and bill
     * it on the next receipt, a PENDING settlement would list beside the subscription's own.
     */
    private function closeAsHistory(object $p, string $subscriptionId, string $academyId): void
    {
        $active = (string) $p->status === 'ACTIVE';
        DB::table('lesson_packages')->where('id', $p->id)->update([
            'status' => $active ? 'COMPLETED' : $p->status,
            'closed_at' => $active ? now() : $p->closed_at,
            'closed_reason' => $active ? self::MOVED_REASON : $p->closed_reason,
            'auto_renew' => false,
            'renewal_held_at' => null,
            'next_terms' => null,
            'settlement' => $p->settlement === 'PENDING' ? null : $p->settlement,
            'updated_at' => now(),
        ]);
        Audit::log('lesson_package.moved', 'lesson_package', (string) $p->id, $academyId, null, 'SUPER_ADMIN',
            before: ['status' => $p->status, 'closed_at' => $p->closed_at, 'closed_reason' => $p->closed_reason, 'auto_renew' => $p->auto_renew, 'renewal_held_at' => $p->renewal_held_at, 'next_terms' => $p->next_terms, 'settlement' => $p->settlement],
            after: ['subscription_id' => $subscriptionId]);
    }

    /** The `packages` switch goes off for this academy, every other switch as it is: MoneyPolicy now counts on the subscriptions. */
    private function endPackageEngine(string $academyId): void
    {
        $modules = app(ModuleBilling::class);
        $sub = $modules->current($academyId, 'MANAGEMENT');
        if ($sub === null) {
            throw new \RuntimeException('This academy has no MANAGEMENT module to switch.');
        }
        $overrides = json_decode((string) ($sub->overrides ?? ''), true);
        $overrides = is_array($overrides) ? $overrides : [];
        $disabled = array_values(array_unique([...array_map('strval', (array) ($overrides['disabled'] ?? [])), 'packages']));
        $modules->setDisabledFeatures($academyId, 'MANAGEMENT', $disabled, array_map('strval', (array) ($overrides['enabled'] ?? [])));
        $this->line('The packages switch is off for this academy.');
    }

    /**
     * What the move does not bring across, said out loud so a person decides before it happens.
     *
     * @return list<string>
     */
    private function notCarried(object $p, int $sold, int $used, int $length, string $status): array
    {
        $name = "{$p->student_name} ({$p->label})";
        $out = [];
        if ($status === 'OPEN' && $p->invoice_id === null) {
            $out[] = "  {$name}: open with no bill yet (billed at its end). Nothing will ever raise one: bill it by hand.";
        }
        if ((int) $p->minutes_overdrawn > 0 && $p->overdraft_invoice_id === null && $p->overdraft_absorbed_by === null) {
            $out[] = "  {$name}: {$p->minutes_overdrawn} overdrawn minutes never billed. They will not be.";
        }
        if ($status === 'OPEN') {
            $capacity = (int) $p->minutes_total + (int) $p->carried_over_minutes;
            $onCard = $sold - LessonCount::whole(max(0, $capacity - (int) $p->minutes_consumed), $length);
            if ($onCard !== $used) {
                $out[] = "  {$name}: the card reads {$onCard} of {$sold} used, the subscription will read {$used} of {$sold}.";
            }
            if ($p->expires_on !== null) {
                $out[] = "  {$name}: expires {$p->expires_on}. A subscription has no expiry date.";
            }
            if ((bool) $p->auto_renew && $used >= $sold - 1) {
                $out[] = "  {$name}: on its last lesson and set to renew. It will not renew by itself any more.";
            }
        }

        return $out;
    }

    /** An unmarked lesson dated before the only open block goes outside it when it is marked: the desk can move the block's start. */
    private function warnLessonsBeforeTheirBlock(string $academyId): void
    {
        $tz = (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC');
        $count = DB::table('sessions as se')
            ->where('se.academy_id', $academyId)->where('se.status', 'SCHEDULED')->whereNull('se.hidden_at')->where('se.scheduled_at_utc', '<', now())
            ->where(fn ($q) => $q
                ->whereExists(fn ($w) => $w->selectRaw('1')->from('lesson_packages as p')->whereColumn('p.student_id', 'se.student_id')->where('p.status', 'ACTIVE'))
                ->orWhereExists(fn ($w) => $w->selectRaw('1')->from('centre_subscriptions as cs')->whereColumn('cs.student_id', 'se.student_id')->where('cs.status', 'OPEN')))
            ->whereNotExists(fn ($w) => $w->selectRaw('1')->from('lesson_packages as p')->whereColumn('p.student_id', 'se.student_id')->where('p.status', 'ACTIVE')
                ->whereRaw('p.starts_on <= (se.scheduled_at_utc at time zone ?)::date', [$tz]))
            ->whereNotExists(fn ($w) => $w->selectRaw('1')->from('centre_subscriptions as cs')->whereColumn('cs.student_id', 'se.student_id')->where('cs.status', 'OPEN')
                ->whereRaw('cs.starts_on <= (se.scheduled_at_utc at time zone ?)::date', [$tz]))
            ->count();
        if ($count > 0) {
            $this->warn("  {$count} unmarked past lessons are dated before their student's open block: they go outside it when marked.");
        }
    }

    /** The length one lesson was sold in: the block's own, else what its lessons ran, else an hour. */
    private function lessonLength(object $p, $credits): int
    {
        if ($p->lesson_minutes !== null && (int) $p->lesson_minutes > 0) {
            return (int) $p->lesson_minutes;
        }
        $usual = $credits->countBy(fn ($c) => (int) $c->minutes)->sortDesc()->keys()->first();

        return $usual !== null && (int) $usual > 0 ? (int) $usual : 60;
    }

    /** @return array{lines: int, allocations: int} */
    private function sums(string $academyId): array
    {
        return [
            'lines' => (int) DB::table('invoice_line_items')->where('academy_id', $academyId)->sum('amount_minor'),
            'allocations' => (int) DB::table('receipt_allocations')->where('academy_id', $academyId)->sum('amount_minor'),
        ];
    }

    /** @param  array{lines: int, allocations: int}  $s */
    private function printSums(string $when, array $s): void
    {
        $this->line("{$when}: sum(invoice_line_items.amount_minor) = {$s['lines']}, sum(receipt_allocations.amount_minor) = {$s['allocations']}");
    }

    private function academy(string $needle): ?object
    {
        TenantContext::apply(userId: self::SYSTEM_USER_ID, academyId: null, role: 'SUPER_ADMIN', local: false);
        try {
            return DB::table('academies')
                ->where(fn ($q) => Str::isUuid($needle) ? $q->where('id', $needle) : $q->where('name', $needle))
                ->first(['id', 'name']);
        } finally {
            TenantContext::clear();
        }
    }
}
