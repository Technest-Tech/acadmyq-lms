<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Audit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Folds a renewal back into the group it came from (Lingo, 2026-11-20).
 *
 * Renewing used to open a NEW group for the next term and archive the old one. A class then sat in
 * two groups — its lessons and sheets in the archive, its students and their next charge in the new
 * one — the family's discounts (which name the group) were left behind, and a student whose last
 * lesson fell on the term's last day lost it: `left_on` is exclusive, so that lesson dropped out of
 * their hours, counted as unused and was carried into the new term instead of a charge being raised.
 * Renewing now keeps the group ({@see CourseTerm::renew}); this puts the ones already split back:
 *
 *   - the old group runs again, with the new term's settings (end date, price, teacher, times …);
 *   - everyone who was moved is a member of it again, without a break — which gives the last day's
 *     lesson back to their hours — and takes back the minutes they "carried";
 *   - the charges raised in the new term become the old group's next months, priced again under the
 *     family's discounts; what is paid on them stays on them;
 *   - whoever has now used up what they paid for is raised their next month;
 *   - the new term's group is deleted once nothing is left on it.
 *
 * One root at a time, each inside the caller's transaction: a refusal (thrown) undoes that root
 * whole and leaves the others. Only groups billed by hours — a calendar month is billed by month,
 * and two terms' charges for the same month do not fold.
 */
final class RenewalMerge
{
    /** What the old group keeps of its own; everything else is the running term's. */
    private const KEEP_OWN = [
        'id', 'academy_id', 'start_date', 'status', 'archived_at', 'closed_reason', 'continues_group_id',
        'created_by', 'created_at', 'updated_at', 'billing_rule_from',
    ];

    private const RENEWED_OUT = 'Renewed into ';

    public function __construct(
        private readonly ClassGroups $groups,
        private readonly GroupLessonGenerator $generator,
        private readonly GroupBilling $billing,
        private readonly GroupPayroll $groupPayroll,
        private readonly Payroll $payroll,
        private readonly PayerDiscounts $discounts,
    ) {}

    /**
     * The groups a renewal archived that still have a term continuing them — each the top of its
     * own chain. Read in the academy's context.
     *
     * @return Collection<int, object>
     */
    public function roots(?string $onlyGroupId = null): Collection
    {
        return DB::table('class_groups as o')
            ->where('o.status', 'ARCHIVED')
            ->where('o.closed_reason', CourseTerm::RENEWED)
            ->whereExists(fn ($q) => $q->selectRaw('1')->from('class_groups as n')->whereColumn('n.continues_group_id', 'o.id'))
            // The top of the chain: not itself the continuation of a renewed term.
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('class_groups as p')
                ->whereColumn('p.id', 'o.continues_group_id')->where('p.closed_reason', CourseTerm::RENEWED))
            ->when($onlyGroupId !== null, fn ($q) => $q->where('o.id', $onlyGroupId))
            ->orderBy('o.name')->orderBy('o.created_at')
            ->get(['o.*']);
    }

    /**
     * Fold every term that continues `$root` back into it. Call inside a transaction; throws
     * {@see RuntimeException} with the reason when the root cannot be folded.
     *
     * @return array<string,mixed> what was done
     */
    public function fold(object $root, string $actorUserId, string $actorRole): array
    {
        $rootId = (string) $root->id;
        $academyId = (string) $root->academy_id;
        $terms = $this->continuations($rootId);
        $termIds = $terms->pluck('id')->map(fn ($id) => (string) $id)->all();

        $running = $terms->where('status', 'ACTIVE')->sortByDesc('created_at')->first();
        if ($running === null) {
            throw new RuntimeException('no running term continues it');
        }
        foreach ([$root, ...$terms->all()] as $g) {
            if (! GroupBilling::byHours($g)) {
                throw new RuntimeException("\"{$g->name}\" is not billed by hours");
            }
        }

        $report = [
            'group_id' => $rootId, 'name' => (string) $running->name, 'terms' => count($termIds),
            'end_date' => $running->end_date !== null ? Carbon::parse($running->end_date)->format('Y-m-d') : null,
        ];

        // ── The old group runs again, as the running term is set up ──────────────
        $config = array_diff_key((array) $running, array_flip(self::KEEP_OWN));
        DB::table('class_groups')->where('id', $rootId)->update($config + [
            'status' => 'ACTIVE', 'archived_at' => null, 'closed_reason' => null, 'updated_at' => now(),
        ]);
        $slotKeyOf = [];
        foreach ($termIds as $termId) {
            $slotKeyOf += $this->slotKeys($termId);
        }
        $this->groups->reconcileSlots($academyId, $rootId, $this->groups->slotsOf((string) $running->id));
        $rootSlots = array_flip($this->slotKeys($rootId));

        // ── The people ───────────────────────────────────────────────────────────
        $report['members'] = $this->foldMembers($rootId, $termIds);
        $report['last_day_given_back'] = $this->giveBackLastDay($rootId);

        // ── The charges: the new term's months are the old group's next ones ────
        $lines = DB::table('invoice_line_items')->whereIn('class_group_id', $termIds)
            ->orderBy('group_period')->orderBy('group_cycle')->orderBy('created_at')->get();
        if ($lines->contains(fn ($l) => $l->group_cycle === null)) {
            throw new RuntimeException('a charge on the new term is not an hours month');
        }
        $paidBefore = (int) DB::table('receipt_allocations')->whereIn('invoice_line_id', $lines->pluck('id')->all())->sum('amount_minor');
        $nextCycle = [];
        foreach ($lines as $line) {
            $studentId = (string) $line->student_id;
            $nextCycle[$studentId] ??= (int) DB::table('invoice_line_items')
                ->where('class_group_id', $rootId)->where('student_id', $studentId)->max('group_cycle');
            $cycle = ++$nextCycle[$studentId];
            $hours = GroupBilling::hoursText((int) $line->group_minutes);
            DB::table('invoice_line_items')->where('id', $line->id)->update([
                'class_group_id' => $rootId,
                'group_cycle' => $cycle,
                'description' => (int) ($line->group_months ?? 1) === 2
                    ? "{$running->name} — payment {$cycle}, 2 months ({$hours} h)"
                    : "{$running->name} — month {$cycle} ({$hours} h)",
            ]);
        }
        $movedIds = $lines->pluck('id')->map(fn ($id) => (string) $id)->all();

        // ── Whatever else hangs on the new term's group ──────────────────────────
        $report['lessons_moved'] = $this->moveLessons($rootId, $termIds, $slotKeyOf, $rootSlots);
        $this->moveTheRest($rootId, $termIds);

        $months = [];
        foreach ($lines as $line) {
            $d = Carbon::parse($line->group_period);
            $months[$d->format('Y-m')] = [(int) $d->year, (int) $d->month];
        }
        foreach (DB::table('payout_line_items')->whereIn('class_group_id', $termIds)->get() as $share) {
            // A share of a month's charges: the charges are the old group's now, and so is the share.
            if (! $this->payroll->removeGroupLine($share, quiet: true)) {
                throw new RuntimeException('the new term has a teacher share on a finalized statement');
            }
            if ($share->group_period !== null) {
                $d = Carbon::parse($share->group_period);
                $months[$d->format('Y-m')] = [(int) $d->year, (int) $d->month];
            }
        }

        // ── The new term's group goes, once nothing is left on it ────────────────
        foreach ([
            'class_group_attendance' => 'group_id', 'class_group_members' => 'group_id', 'invoice_line_items' => 'class_group_id',
            'payout_line_items' => 'class_group_id', 'group_assessments' => 'group_id', 'group_term_reports' => 'group_id',
            'class_group_waitlist' => 'group_id', 'class_group_lesson_removals' => 'group_id',
        ] as $table => $column) {
            if (DB::table($table)->whereIn($column, $termIds)->exists()) {
                throw new RuntimeException("rows are still on the new term in {$table}");
            }
        }
        if (DB::table('class_group_lessons')->whereIn('group_id', $termIds)->where('status', '<>', 'SCHEDULED')->exists()) {
            throw new RuntimeException('a held or cancelled lesson is still on the new term');
        }
        DB::table('class_groups')->whereIn('id', $termIds)->delete(); // its weekly times cascade, and a lesson left behind

        // ── Lessons to come, the right prices, and whoever is now due ────────────
        $fresh = DB::table('class_groups')->where('id', $rootId)->first();
        $report['generated'] = $this->generator->regenerate($rootId);

        $before = (int) DB::table('invoice_line_items')->whereIn('id', $movedIds)->sum('amount_minor');
        $this->discounts->repriceGroupLines($academyId, $movedIds);
        $after = (int) DB::table('invoice_line_items')->whereIn('id', $movedIds)->sum('amount_minor');
        $paidAfter = (int) DB::table('receipt_allocations')->whereIn('invoice_line_id', $movedIds)->sum('amount_minor');
        $report['charges_moved'] = ['lines' => count($movedIds), 'was_minor' => $before, 'now_minor' => $after, 'paid_minor' => $paidAfter, 'credit_back_minor' => $paidBefore - $paidAfter];

        $had = DB::table('invoice_line_items')->where('class_group_id', $rootId)->pluck('id')->map(fn ($id) => (string) $id)->all();
        $this->billing->onPricingChanged($fresh);
        $raised = DB::table('invoice_line_items')->where('class_group_id', $rootId)->whereNotIn('id', $had)->get(['id', 'amount_minor']);
        $report['charges_raised'] = ['lines' => $raised->count(), 'amount_minor' => (int) $raised->sum('amount_minor')];

        foreach ($months as [$y, $m]) {
            $this->groupPayroll->syncRevenueShare($fresh, $y, $m);
        }

        $report['active_members'] = DB::table('class_group_members')->where('group_id', $rootId)->where('status', 'ACTIVE')->count();
        $report['lessons_to_come'] = DB::table('class_group_lessons')->where('group_id', $rootId)->where('status', 'SCHEDULED')->count();

        Audit::log('class_group.renewal_merged', 'class_group', $rootId, $academyId, $actorUserId, $actorRole,
            after: $report + ['merged_group_ids' => $termIds],
            before: ['status' => $root->status, 'closed_reason' => $root->closed_reason]);

        return $report;
    }

    /**
     * Every term that continues `$rootId`, through renewed terms only, oldest first.
     *
     * @return Collection<int, object>
     */
    private function continuations(string $rootId): Collection
    {
        $found = collect();
        $parents = [$rootId];
        while ($parents !== []) {
            $children = DB::table('class_groups')->whereIn('continues_group_id', $parents)->lockForUpdate()->get();
            $found = $found->concat($children);
            // Only a renewed term hands its class on; a promotion or a plain successor ends the chain.
            $parents = $children->where('closed_reason', CourseTerm::RENEWED)->pluck('id')->map(fn ($id) => (string) $id)->all();
        }

        return $found->sortBy('created_at')->values();
    }

    /** @return array<string,string> slot id => "weekday|HH:MM" */
    private function slotKeys(string $groupId): array
    {
        return DB::table('class_group_slots')->where('group_id', $groupId)->get(['id', 'weekday', 'start_time_local'])
            ->mapWithKeys(fn ($s) => [(string) $s->id => $s->weekday.'|'.substr((string) $s->start_time_local, 0, 5)])->all();
    }

    /**
     * Each membership of the new terms goes back to the old group: the one the renewal ended is
     * opened again (no break, so the days between count), a student who is already back in it only
     * hands back the minutes carried, and one who first came in the new term moves over as they are.
     *
     * @param  list<string>  $termIds
     * @return array{reopened:int, came_new:int, already_back:int, left_since:int}
     */
    private function foldMembers(string $rootId, array $termIds): array
    {
        $out = ['reopened' => 0, 'came_new' => 0, 'already_back' => 0, 'left_since' => 0];
        $rows = DB::table('class_group_members as m')
            ->join('class_groups as g', 'g.id', '=', 'm.group_id')
            ->whereIn('m.group_id', $termIds)
            ->orderBy('g.created_at')->orderBy('m.joined_on')->orderBy('m.created_at')
            ->get(['m.*']);

        foreach ($rows as $m) {
            $own = DB::table('class_group_members')->where('group_id', $rootId)->where('student_id', $m->student_id)
                ->orderByDesc('joined_on')->orderByDesc('created_at')->get();
            $active = $own->firstWhere('status', 'ACTIVE');
            // The row the renewal ended — not simply the newest: a student moved in and out of the
            // group before has other rows, some starting the same day.
            $latest = $own->first(fn ($r) => $r->status === 'LEFT' && str_starts_with((string) $r->left_reason, self::RENEWED_OUT));
            $carried = (int) $m->carried_minutes;

            if ($active !== null) {
                DB::table('class_group_members')->where('id', $active->id)->update([
                    'carried_minutes' => DB::raw("carried_minutes + ({$carried})"), 'updated_at' => now(),
                ]);
                DB::table('class_group_members')->where('id', $m->id)->delete();
                $out['already_back']++;

                continue;
            }

            if ($latest !== null) {
                $stillIn = $m->status === 'ACTIVE';
                DB::table('class_group_members')->where('id', $latest->id)->update([
                    'status' => $stillIn ? 'ACTIVE' : 'LEFT',
                    'left_on' => $stillIn ? null : max(
                        Carbon::parse($m->left_on)->format('Y-m-d'),
                        Carbon::parse($latest->left_on)->format('Y-m-d'),
                    ),
                    'left_reason' => $stillIn ? null : $m->left_reason,
                    'carried_minutes' => DB::raw("carried_minutes + ({$carried})"),
                    'months_per_charge' => (int) $m->months_per_charge,
                    'price_minor' => $m->price_minor ?? $latest->price_minor,
                    'renewal_held_from' => $m->renewal_held_from,
                    'is_trial' => (bool) $m->is_trial,
                    'paused_by_suspension' => (bool) $m->paused_by_suspension,
                    'updated_at' => now(),
                ]);
                DB::table('class_group_members')->where('id', $m->id)->delete();
                $out[$stillIn ? 'reopened' : 'left_since']++;

                continue;
            }

            DB::table('class_group_members')->where('id', $m->id)->update(['group_id' => $rootId, 'updated_at' => now()]);
            $out['came_new']++;
        }

        return $out;
    }

    /**
     * A member the renewal ended and did not take on left "on" the term's last day — which, the
     * leave day being exclusive, took that day's lesson out of their hours. They leave the day after.
     */
    private function giveBackLastDay(string $rootId): int
    {
        $fixed = 0;
        $rows = DB::table('class_group_members')->where('group_id', $rootId)->where('status', 'LEFT')
            ->where('left_reason', 'like', self::RENEWED_OUT.'%')->get();
        foreach ($rows as $m) {
            if (DB::table('class_group_members')->where('group_id', $rootId)->where('student_id', $m->student_id)->where('status', 'ACTIVE')->exists()) {
                continue; // back in the group on another row: that row already covers the day
            }
            $leftOn = Carbon::parse($m->left_on)->format('Y-m-d');
            $held = DB::table('class_group_lessons')->where('group_id', $rootId)->where('status', 'HELD')
                ->where('occurrence_local_date', $leftOn)->exists();
            if ($held) {
                DB::table('class_group_members')->where('id', $m->id)->update([
                    'left_on' => Carbon::parse($leftOn)->addDay()->format('Y-m-d'), 'left_reason' => 'Not renewed', 'updated_at' => now(),
                ]);
                $fixed++;
            }
        }

        return $fixed;
    }

    /**
     * The new terms' lessons become the old group's, as the same rows — whatever was sent or written
     * for a lesson (a reminder, a note, a sheet) stays with it — each on the old group's matching
     * weekly time. One the timetable no longer has, or that the old group already holds on that
     * day, is dropped when nobody has touched it and kept beside it (off the timetable) when
     * someone has: held, cancelled, moved, added by hand, written on, or with a sheet.
     *
     * @param  list<string>  $termIds
     * @param  array<string,string>  $slotKeyOf  the terms' slot id => "weekday|HH:MM"
     * @param  array<string,string>  $rootSlots  "weekday|HH:MM" => the old group's slot id
     */
    private function moveLessons(string $rootId, array $termIds, array $slotKeyOf, array $rootSlots): int
    {
        $lessons = DB::table('class_group_lessons as l')->whereIn('l.group_id', $termIds)
            ->orderBy('l.scheduled_at_utc')
            ->get(['l.*',
                DB::raw('exists (select 1 from class_group_attendance a where a.lesson_id = l.id) as has_sheet'),
                DB::raw('exists (select 1 from class_group_lesson_removals r where r.lesson_id = l.id) as has_removal'),
            ]);

        $moved = 0;
        foreach ($lessons as $l) {
            $touched = $l->status !== 'SCHEDULED' || $l->moved_at !== null || $l->is_extra
                || $l->admin_note !== null || $l->notes !== null || $l->topic !== null || $l->homework !== null
                || $l->has_sheet || $l->has_removal;
            $slotId = $l->slot_id !== null ? ($rootSlots[$slotKeyOf[(string) $l->slot_id] ?? ''] ?? null) : null;
            $taken = $slotId !== null && DB::table('class_group_lessons')->where('group_id', $rootId)->where('slot_id', $slotId)
                ->where('occurrence_local_date', $l->occurrence_local_date)->exists();

            if (! $touched && ($taken || ($l->slot_id !== null && $slotId === null))) {
                continue; // an untouched lesson with no place on the timetable: it goes with its group
            }
            if ($taken) {
                $slotId = null;
            }

            DB::table('class_group_lessons')->where('id', $l->id)->update(['group_id' => $rootId, 'slot_id' => $slotId, 'updated_at' => now()]);
            DB::table('class_group_attendance')->where('lesson_id', $l->id)->update(['group_id' => $rootId]);
            DB::table('class_group_lesson_removals')->where('lesson_id', $l->id)->update(['group_id' => $rootId]);
            DB::table('payout_line_items')->where('class_group_lesson_id', $l->id)->update(['class_group_id' => $rootId]);
            $moved++;
        }

        return $moved;
    }

    /**
     * The family discounts, expenses, assessments, reports, level history and waiting list that name
     * the new term's group name the old one instead.
     *
     * @param  list<string>  $termIds
     */
    private function moveTheRest(string $rootId, array $termIds): void
    {
        // A discount that already reaches the old group needs no second target for it.
        $targets = DB::table('payer_discount_targets')->whereIn('class_group_id', $termIds)->get(['id', 'discount_id']);
        foreach ($targets as $t) {
            $has = DB::table('payer_discount_targets')->where('discount_id', $t->discount_id)->where('class_group_id', $rootId)->exists();
            $has
                ? DB::table('payer_discount_targets')->where('id', $t->id)->delete()
                : DB::table('payer_discount_targets')->where('id', $t->id)->update(['class_group_id' => $rootId]);
        }

        foreach ([
            'payer_discounts' => 'class_group_id', 'expenses' => 'class_group_id',
            'group_assessments' => 'group_id', 'group_term_reports' => 'group_id', 'class_group_waitlist' => 'group_id',
            'student_level_history' => 'from_group_id',
        ] as $table => $column) {
            DB::table($table)->whereIn($column, $termIds)->update([$column => $rootId]);
        }
        DB::table('student_level_history')->whereIn('to_group_id', $termIds)->update(['to_group_id' => $rootId]);
    }
}
