<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\LessonPackages;
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
 * (`legacy_package_id`) is skipped. Only a CENTRE academy; the preset flip comes after, by hand.
 */
final class CentreMigratePackages extends Command
{
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

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

            $run = fn (): array => $this->move($academyId, $packages, $apply);
            $result = $apply ? DB::transaction($run) : $run();

            $this->table(['Package', 'Student', 'Subject', 'Sold', 'Used', 'Status', 'Line'], $result['rows']);
            $this->line("Packages mapped: {$result['mapped']} (skipped, already moved: {$result['skipped']})");
            $this->line("Credits mapped: {$result['credits']}");
            $this->line("Unmapped lines (a bill but no line found): {$result['unmapped']}");
            foreach ($result['unmapped_ids'] as $id) {
                $this->warn("  package {$id} has a bill but its line was not found — the subscription carries invoice_id only");
            }

            $after = $this->sums($academyId);
            $this->printSums('After', $after);
            if ($after['lines'] !== $before['lines'] || $after['allocations'] !== $before['allocations']) {
                $this->error('Money moved — it must not. Investigate before deploying.');

                return self::FAILURE;
            }
            if ($apply) {
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

    /** @return array{rows: list<array<int, mixed>>, mapped: int, skipped: int, credits: int, unmapped: int, unmapped_ids: list<string>} */
    private function move(string $academyId, LessonPackages $packages, bool $apply): array
    {
        $out = ['rows' => [], 'mapped' => 0, 'skipped' => 0, 'credits' => 0, 'unmapped' => 0, 'unmapped_ids' => []];
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
        }

        return $out;
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
