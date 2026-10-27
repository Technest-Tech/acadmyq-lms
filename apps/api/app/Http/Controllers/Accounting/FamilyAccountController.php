<?php

declare(strict_types=1);

namespace App\Http\Controllers\Accounting;

use App\Http\Controllers\Controller;
use App\Services\Ledger;
use App\Services\PayerDiscounts;
use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The family card's money (docs/groups/01-ACCOUNTING.md) — one place for a family: its children and
 * what each is enrolled in (groups, private lessons), what the family owes and how old it is, every
 * open charge with where it comes from, and its timeline: receipts, voids, reminders, bills sent and
 * the desk's own follow-up notes.
 *
 * A family is the SAME guardian the rest of the system uses — group and private charges sit on
 * the same account. An academy that invoices each student separately (PER_STUDENT) is handled by
 * summing every child's own account, so the card always shows the whole family.
 *
 *   GET    /accounting/family/{guardianId}
 *   POST   /accounting/family/{guardianId}/notes     { body, follow_up_on? }
 *   DELETE /accounting/family/{guardianId}/notes/{noteId}
 *
 * Behind `entitled:accounting`. Reading is `invoice.read`, writing a note `invoice.mark_paid`.
 */
final class FamilyAccountController extends Controller
{
    public function __construct(private readonly Ledger $ledger, private readonly PayerDiscounts $discounts) {}

    public function show(string $guardianId): JsonResponse
    {
        Gate::authorize('invoice.read');
        $academyId = $this->academyId();
        $guardian = DB::table('guardians')->where('id', $guardianId)->first(['id', 'full_name', 'whatsapp_phone', 'renewal_policy']);
        if ($guardian === null) {
            abort(404, 'Family not found.');
        }

        $children = DB::table('students')->where('guardian_id', $guardianId)->whereNull('deleted_at')
            ->orderBy('full_name')->get(['id', 'full_name', 'status']);
        $childIds = $children->pluck('id')->map(fn ($id) => (string) $id)->all();
        $today = Carbon::now($this->timezone($academyId))->format('Y-m-d');

        // Every account the family's money sits on. Where the academy bills families, that is the
        // guardian's alone — it already holds the bills raised on a child (Ledger::poolsFamily).
        // An academy billing each student adds each child's own account.
        $payers = [['guardian_id' => $guardianId, 'student_id' => null, 'payer_name' => null]];
        if (! Ledger::poolsFamily($academyId)) {
            foreach ($childIds as $sid) {
                $payers[] = ['guardian_id' => null, 'student_id' => $sid, 'payer_name' => null];
            }
        }

        $lines = collect();
        $balance = [];
        foreach ($payers as $p) {
            $lines = $lines->merge($this->ledger->openLines($academyId, $p)->map(function ($l) use ($p) {
                $l->payer_kind = $p['guardian_id'] !== null ? 'GUARDIAN' : 'STUDENT';
                $l->payer_id = $p['guardian_id'] ?? $p['student_id'];

                return $l;
            }));
            foreach ($this->ledger->balance($academyId, $p) as $b) {
                $c = $b['currency'];
                $balance[$c] ??= ['currency' => $c, 'due_minor' => 0, 'credit_minor' => 0, 'balance_minor' => 0, 'overdue_minor' => 0];
                $balance[$c]['due_minor'] += $b['due_minor'];
                $balance[$c]['credit_minor'] += $b['credit_minor'];
                $balance[$c]['balance_minor'] += $b['balance_minor'];
            }
        }

        $sessionIds = DB::table('invoice_line_items')->whereIn('id', $lines->pluck('id')->all())->whereNotNull('session_id')->pluck('id')->map(fn ($v) => (string) $v)->flip();
        $groupNames = DB::table('class_groups')->whereIn('id', $lines->pluck('class_group_id')->filter()->unique()->values()->all())->pluck('name', 'id');
        $dueByChild = [];
        $charges = $lines->sortBy(fn ($l) => ($l->session_date ?? '').'|'.$l->id)->values()->map(function ($l) use (&$balance, &$dueByChild, $today, $sessionIds, $groupNames) {
            $left = (int) $l->amount_minor - (int) $l->allocated;
            $date = $l->session_date !== null ? Carbon::parse($l->session_date)->format('Y-m-d') : sprintf('%04d-%02d-01', (int) $l->period_year, (int) $l->period_month);
            if (substr($date, 0, 7) < substr($today, 0, 7)) {
                $balance[(string) $l->currency]['overdue_minor'] += $left;
            }
            if ($l->student_id !== null) {
                $dueByChild[(string) $l->student_id][(string) $l->currency] = ($dueByChild[(string) $l->student_id][(string) $l->currency] ?? 0) + $left;
            }

            return [
                'id' => (string) $l->id,
                'invoice_id' => (string) $l->invoice_id,
                'source' => $l->class_group_id !== null ? 'GROUP' : (isset($sessionIds[(string) $l->id]) ? 'PRIVATE' : 'OTHER'),
                'group_name' => $l->class_group_id !== null ? ($groupNames[(string) $l->class_group_id] ?? null) : null,
                'description' => (string) $l->description,
                'student_id' => $l->student_id !== null ? (string) $l->student_id : null,
                'student_name' => $l->student_name,
                'date' => $date,
                'period' => sprintf('%04d-%02d', (int) $l->period_year, (int) $l->period_month),
                'amount_minor' => (int) $l->amount_minor,
                'list_amount_minor' => $l->list_amount_minor !== null ? (int) $l->list_amount_minor : null,
                'discount_minor' => (int) $l->discount_minor,
                'discount_label' => $l->discount_label,
                'paid_minor' => (int) $l->allocated,
                'remaining_minor' => $left,
                'currency' => (string) $l->currency,
                'payer_kind' => $l->payer_kind,
                'payer_id' => (string) $l->payer_id,
            ];
        })->all();

        // What each child is enrolled in.
        $memberships = DB::table('class_group_members as m')
            ->join('class_groups as g', 'g.id', '=', 'm.group_id')
            ->leftJoin('teachers as t', 't.id', '=', 'g.teacher_id')
            ->whereIn('m.student_id', $childIds ?: ['00000000-0000-0000-0000-000000000000'])
            ->where('m.status', 'ACTIVE')
            ->whereNull('m.left_on')
            ->get(['m.student_id', 'g.id', 'g.name', 'g.billing_mode', 'g.price_minor as group_price', 'g.currency', 'm.price_minor as member_price', 'm.joined_on', 't.full_name as teacher_name'])
            ->groupBy(fn ($m) => (string) $m->student_id);
        $subscriptions = DB::table('subscriptions')
            ->whereIn('student_id', $childIds ?: ['00000000-0000-0000-0000-000000000000'])
            ->where('status', 'ACTIVE')->whereNull('deleted_at')
            ->get(['student_id', 'plan_label', 'price_minor', 'currency', 'price_basis'])
            ->keyBy(fn ($s) => (string) $s->student_id);
        $teachers = DB::table('schedules as s')
            ->join('teachers as t', 't.id', '=', 's.teacher_id')
            ->whereIn('s.student_id', $childIds ?: ['00000000-0000-0000-0000-000000000000'])
            ->where('s.is_active', true)
            ->distinct()
            ->get(['s.student_id', 't.full_name'])
            ->groupBy(fn ($r) => (string) $r->student_id);

        $childRows = $children->map(fn ($c) => [
            'id' => (string) $c->id,
            'name' => (string) $c->full_name,
            'status' => (string) $c->status,
            'groups' => ($memberships[(string) $c->id] ?? collect())->map(fn ($m) => [
                'id' => (string) $m->id,
                'name' => (string) $m->name,
                'teacher_name' => $m->teacher_name,
                'billing_mode' => (string) $m->billing_mode,
                'price_minor' => $m->member_price !== null ? (int) $m->member_price : ($m->group_price !== null ? (int) $m->group_price : null),
                'currency' => $m->currency,
                'joined_on' => Carbon::parse($m->joined_on)->format('Y-m-d'),
            ])->values()->all(),
            'private' => isset($subscriptions[(string) $c->id]) ? [
                'plan_label' => (string) $subscriptions[(string) $c->id]->plan_label,
                'price_minor' => (int) $subscriptions[(string) $c->id]->price_minor,
                'currency' => (string) $subscriptions[(string) $c->id]->currency,
                'price_basis' => (string) $subscriptions[(string) $c->id]->price_basis,
                'teachers' => ($teachers[(string) $c->id] ?? collect())->pluck('full_name')->values()->all(),
            ] : null,
            'due' => array_map(fn ($cur, $amt) => ['currency' => $cur, 'due_minor' => $amt], array_keys($dueByChild[(string) $c->id] ?? []), array_values($dueByChild[(string) $c->id] ?? [])),
        ])->all();

        // Paid this year, and the timeline.
        $receipts = DB::table('receipts as r')
            ->leftJoin('users as u', 'u.id', '=', 'r.received_by')
            ->where(fn ($q) => $q->where('r.guardian_id', $guardianId)->orWhereIn('r.student_id', $childIds ?: ['00000000-0000-0000-0000-000000000000']))
            ->orderByDesc('r.received_on')->orderByDesc('r.created_at')->orderByDesc('r.number')
            ->limit(200)
            ->get(['r.id', 'r.number', 'r.received_on', 'r.created_at', 'r.amount_minor', 'r.currency', 'r.method', 'r.voided_at', 'r.void_reason', 'u.full_name as received_by']);
        $year = substr($today, 0, 4);
        $paidThisYear = [];
        foreach ($receipts as $r) {
            if ($r->voided_at === null && Carbon::parse($r->received_on)->format('Y') === $year) {
                $paidThisYear[(string) $r->currency] = ($paidThisYear[(string) $r->currency] ?? 0) + (int) $r->amount_minor;
            }
        }

        $timeline = [];
        foreach ($receipts as $r) {
            $timeline[] = [
                'at' => Carbon::parse($r->created_at)->toIso8601String(),
                'date' => Carbon::parse($r->received_on)->format('Y-m-d'),
                'kind' => 'RECEIPT',
                'id' => (string) $r->id,
                'number' => (string) $r->number,
                'amount_minor' => (int) $r->amount_minor,
                'currency' => (string) $r->currency,
                'method' => (string) $r->method,
                'by' => $r->received_by,
                'voided' => $r->voided_at !== null,
                'void_reason' => $r->void_reason,
            ];
        }
        foreach (DB::table('audit_log as a')->leftJoin('users as u', 'u.id', '=', 'a.actor_user_id')
            ->where('a.action', 'accounting.reminder_sent')
            ->where(fn ($q) => $q->where('a.entity_id', $guardianId)->orWhereIn('a.entity_id', $childIds ?: ['00000000-0000-0000-0000-000000000000']))
            ->orderByDesc('a.created_at')->limit(50)
            ->get(['a.id', 'a.created_at', 'u.full_name as by']) as $a) {
            $timeline[] = ['at' => Carbon::parse($a->created_at)->toIso8601String(), 'date' => Carbon::parse($a->created_at)->format('Y-m-d'), 'kind' => 'REMINDER', 'id' => (string) $a->id, 'by' => $a->by];
        }
        foreach (DB::table('invoices')->where('guardian_id', $guardianId)->whereNotNull('sent_at')->orderByDesc('sent_at')->limit(50)
            ->get(['id', 'sent_at', 'period_year', 'period_month', 'total_minor', 'currency']) as $i) {
            $timeline[] = [
                'at' => Carbon::parse($i->sent_at)->toIso8601String(), 'date' => Carbon::parse($i->sent_at)->format('Y-m-d'), 'kind' => 'BILL_SENT', 'id' => (string) $i->id,
                'period' => sprintf('%04d-%02d', (int) $i->period_year, (int) $i->period_month), 'amount_minor' => (int) $i->total_minor, 'currency' => (string) $i->currency,
            ];
        }
        foreach (DB::table('payer_notes as n')->leftJoin('users as u', 'u.id', '=', 'n.created_by')->where('n.guardian_id', $guardianId)
            ->orderByDesc('n.created_at')->limit(100)
            ->get(['n.id', 'n.body', 'n.follow_up_on', 'n.created_at', 'n.created_by', 'u.full_name as by']) as $n) {
            $timeline[] = [
                'at' => Carbon::parse($n->created_at)->toIso8601String(), 'date' => Carbon::parse($n->created_at)->format('Y-m-d'), 'kind' => 'NOTE', 'id' => (string) $n->id,
                'body' => (string) $n->body, 'follow_up_on' => $n->follow_up_on !== null ? Carbon::parse($n->follow_up_on)->format('Y-m-d') : null,
                'by' => $n->by, 'mine' => (string) $n->created_by === (string) app(AuthContext::class)->userId,
            ];
        }
        usort($timeline, fn ($a, $b) => strcmp($b['at'], $a['at']));

        $nextFollowUp = DB::table('payer_notes')->where('guardian_id', $guardianId)->whereNotNull('follow_up_on')
            ->where('follow_up_on', '>=', $today)->orderBy('follow_up_on')->first(['follow_up_on', 'body']);

        ksort($balance);

        return response()->json([
            'family' => ['id' => (string) $guardian->id, 'name' => (string) $guardian->full_name, 'phone' => $guardian->whatsapp_phone, 'renewal_policy' => (string) $guardian->renewal_policy],
            'today' => $today,
            'balance' => array_values($balance),
            'paid_this_year' => array_map(fn ($c, $a) => ['currency' => $c, 'amount_minor' => $a], array_keys($paidThisYear), array_values($paidThisYear)),
            'last_receipt' => $receipts->firstWhere('voided_at', null) !== null ? [
                'id' => (string) $receipts->firstWhere('voided_at', null)->id,
                'number' => (string) $receipts->firstWhere('voided_at', null)->number,
                'received_on' => Carbon::parse($receipts->firstWhere('voided_at', null)->received_on)->format('Y-m-d'),
                'amount_minor' => (int) $receipts->firstWhere('voided_at', null)->amount_minor,
                'currency' => (string) $receipts->firstWhere('voided_at', null)->currency,
            ] : null,
            'next_follow_up' => $nextFollowUp !== null ? ['date' => Carbon::parse($nextFollowUp->follow_up_on)->format('Y-m-d'), 'body' => (string) $nextFollowUp->body] : null,
            'children' => $childRows,
            'charges' => $charges,
            'discounts' => $this->discounts->forFamily($guardianId, $childIds)->map(fn ($d) => [
                'id' => (string) $d->id,
                'kind' => (string) $d->kind,
                'value' => (int) $d->value,
                'label' => (string) $d->label,
                'scope' => (string) $d->scope,
                'student_id' => $d->student_id !== null ? (string) $d->student_id : null,
                'student_name' => $d->student_name,
                'class_group_id' => $d->class_group_id !== null ? (string) $d->class_group_id : null,
                'group_name' => $d->group_name,
                'starts_on' => Carbon::parse($d->starts_on)->format('Y-m-d'),
                'ends_on' => $d->ends_on !== null ? Carbon::parse($d->ends_on)->format('Y-m-d') : null,
                'active' => $d->ends_on === null || Carbon::parse($d->ends_on)->format('Y-m-d') > $today,
                'preset_id' => isset($d->preset_id) && $d->preset_id !== null ? (string) $d->preset_id : null,
                'by' => $d->created_by_name,
            ])->values()->all(),
            'timeline' => array_slice($timeline, 0, 150),
            'can_collect' => Gate::allows('invoice.mark_paid'),
            'can_remind' => Gate::allows('invoice.send_link'),
            'can_note' => Gate::allows('invoice.mark_paid'),
        ]);
    }

    public function addNote(Request $request, string $guardianId): JsonResponse
    {
        Gate::authorize('invoice.mark_paid');
        $data = $request->validate([
            'body' => ['required', 'string', 'min:2', 'max:2000'],
            'follow_up_on' => ['nullable', 'date_format:Y-m-d'],
        ]);
        if (! DB::table('guardians')->where('id', $guardianId)->exists()) {
            throw ValidationException::withMessages(['guardian' => ['Unknown family. / أسرة غير معروفة.']]);
        }
        $ctx = app(AuthContext::class);
        $id = (string) DB::table('payer_notes')->insertGetId([
            'academy_id' => $this->academyId(),
            'guardian_id' => $guardianId,
            'body' => trim((string) $data['body']),
            'follow_up_on' => $data['follow_up_on'] ?? null,
            'created_by' => $ctx->userId,
            'created_at' => now(),
        ]);
        Audit::log('accounting.note_added', 'guardian', $guardianId, $this->academyId(), $ctx->userId, $ctx->role, after: ['note' => $id, 'follow_up_on' => $data['follow_up_on'] ?? null]);

        return response()->json(['id' => $id], 201);
    }

    public function deleteNote(string $guardianId, string $noteId): JsonResponse
    {
        Gate::authorize('invoice.mark_paid');
        $ctx = app(AuthContext::class);
        $note = DB::table('payer_notes')->where('id', $noteId)->where('guardian_id', $guardianId)->first();
        if ($note === null) {
            abort(404, 'Note not found.');
        }
        // A note is the writer's own record; the owner may tidy anyone's.
        if ((string) $note->created_by !== (string) $ctx->userId && ! in_array($ctx->role, ['ACADEMY_OWNER', 'SUPER_ADMIN'], true)) {
            abort(403, 'Only the person who wrote this note can delete it.');
        }
        DB::table('payer_notes')->where('id', $noteId)->delete();
        Audit::log('accounting.note_deleted', 'guardian', $guardianId, $this->academyId(), $ctx->userId, $ctx->role, before: ['body' => $note->body]);

        return response()->json(['ok' => true]);
    }

    /**
     * POST /api/accounting/family/{guardianId}/discounts — a standing discount for the family (or one
     * child): a percentage or a fixed amount off each charge, from today, until it is ended. With
     * `apply_to_existing` it also comes off the charges already on the family's open bills
     * ({@see PayerDiscounts::applyToExisting()}); without it, nothing already billed moves.
     */
    public function addDiscount(Request $request, string $guardianId): JsonResponse
    {
        Gate::authorize('invoice.mark_paid');
        $data = $request->validate([
            // A preset (بنود الخصم) brings its own kind, value and name; without one it is typed in.
            'preset_id' => ['nullable', 'uuid'],
            'kind' => ['required_without:preset_id', Rule::in(['PERCENT', 'FIXED'])],
            // PERCENT: whole percent (1–100); FIXED: minor units per charge.
            'value' => ['required_without:preset_id', 'integer', 'min:1', 'max:1000000000000'],
            'label' => ['required_without:preset_id', 'string', 'min:1', 'max:80'],
            'scope' => ['sometimes', Rule::in(['ALL', 'GROUP', 'PRIVATE'])],
            'student_id' => ['nullable', 'uuid'],
            'class_group_id' => ['nullable', 'uuid'],
            'starts_on' => ['nullable', 'date_format:Y-m-d'],
            'apply_to_existing' => ['sometimes', 'boolean'],
        ]);
        if (! DB::table('guardians')->where('id', $guardianId)->exists()) {
            throw ValidationException::withMessages(['guardian' => ['Unknown family. / أسرة غير معروفة.']]);
        }
        $presetId = $data['preset_id'] ?? null;
        if ($presetId !== null) {
            $preset = DB::table('discount_presets')->where('id', $presetId)->where('is_active', true)->first();
            if ($preset === null) {
                throw ValidationException::withMessages(['preset_id' => ['That discount preset is not available. / بند الخصم هذا غير متاح.']]);
            }
            // Stored like the form's input: a whole percent, or minor units.
            $data['kind'] = (string) $preset->kind;
            $data['value'] = $preset->kind === 'PERCENT' ? intdiv((int) $preset->value, 100) : (int) $preset->value;
            $data['label'] = (string) $preset->name;
        }
        if ($data['kind'] === 'PERCENT' && (int) $data['value'] > 100) {
            throw ValidationException::withMessages(['value' => ['A percentage is 1–100. / النسبة من 1 إلى 100.']]);
        }
        $studentId = $data['student_id'] ?? null;
        if ($studentId !== null && ! DB::table('students')->where('id', $studentId)->where('guardian_id', $guardianId)->exists()) {
            throw ValidationException::withMessages(['student_id' => ['Not one of this family\'s children. / ليس من أبناء هذه الأسرة.']]);
        }
        $scope = $data['scope'] ?? 'ALL';
        $groupId = $scope === 'GROUP' ? ($data['class_group_id'] ?? null) : null;
        if ($groupId !== null && ! DB::table('class_groups')->where('id', $groupId)->exists()) {
            throw ValidationException::withMessages(['class_group_id' => ['Unknown group. / مجموعة غير معروفة.']]);
        }

        $ctx = app(AuthContext::class);
        $academyId = $this->academyId();
        $id = (string) DB::table('payer_discounts')->insertGetId([
            'academy_id' => $academyId,
            'guardian_id' => $studentId === null ? $guardianId : null,
            'student_id' => $studentId,
            'kind' => $data['kind'],
            'value' => $data['kind'] === 'PERCENT' ? (int) $data['value'] * 100 : (int) $data['value'],
            'label' => trim((string) $data['label']),
            'scope' => $scope,
            'class_group_id' => $groupId,
            'starts_on' => $data['starts_on'] ?? $this->discounts->today($academyId),
            'preset_id' => $presetId,
            'created_by' => $ctx->userId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Audit::log('accounting.discount_added', 'guardian', $guardianId, $academyId, $ctx->userId, $ctx->role, after: [
            'discount' => $id, 'kind' => $data['kind'], 'value' => (int) $data['value'], 'label' => trim((string) $data['label']), 'scope' => $scope, 'student_id' => $studentId,
            'preset_id' => $presetId,
        ]);
        $applied = ($data['apply_to_existing'] ?? false) ? $this->applied($guardianId, $id) : ['lines' => 0, 'discount_minor' => 0];

        return response()->json(['id' => $id, 'applied' => $applied], 201);
    }

    /**
     * POST /api/accounting/family/{guardianId}/discounts/{id}/apply-existing — a discount given
     * earlier also comes off the charges already on the family's open bills. Safe to repeat.
     */
    public function applyDiscountToExisting(string $guardianId, string $discountId): JsonResponse
    {
        Gate::authorize('invoice.mark_paid');
        $d = $this->familyDiscount($guardianId, $discountId);
        if ($d->ends_on !== null && Carbon::parse($d->ends_on)->format('Y-m-d') <= $this->discounts->today($this->academyId())) {
            throw ValidationException::withMessages(['discount' => ['This discount has ended. / هذا الخصم منتهٍ.']]);
        }

        return response()->json(['applied' => $this->applied($guardianId, $discountId)]);
    }

    /** DELETE /api/accounting/family/{guardianId}/discounts/{id} — ends it today. What it already took stays. */
    public function endDiscount(string $guardianId, string $discountId): JsonResponse
    {
        Gate::authorize('invoice.mark_paid');
        $d = $this->familyDiscount($guardianId, $discountId);
        $ctx = app(AuthContext::class);
        $today = $this->discounts->today($this->academyId());
        if ($d->ends_on === null || Carbon::parse($d->ends_on)->format('Y-m-d') > $today) {
            // Ending it on the day it started removes it outright: it never applied to anything.
            DB::table('payer_discounts')->where('id', $discountId)->update([
                'ends_on' => max($today, Carbon::parse($d->starts_on)->format('Y-m-d')),
                'ended_by' => $ctx->userId,
                'updated_at' => now(),
            ]);
        }
        Audit::log('accounting.discount_ended', 'guardian', $guardianId, $this->academyId(), $ctx->userId, $ctx->role, before: ['discount' => $discountId, 'label' => $d->label]);

        return response()->json(['ok' => true]);
    }

    /** Runs the reprice and leaves a trace of what it moved. */
    private function applied(string $guardianId, string $discountId): array
    {
        $ctx = app(AuthContext::class);
        $applied = $this->discounts->applyToExisting($this->academyId(), $discountId);
        if ($applied['lines'] > 0) {
            Audit::log('accounting.discount_applied_to_existing', 'guardian', $guardianId, $this->academyId(), $ctx->userId, $ctx->role, after: ['discount' => $discountId] + $applied);
        }

        return $applied;
    }

    private function familyDiscount(string $guardianId, string $discountId): object
    {
        $childIds = DB::table('students')->where('guardian_id', $guardianId)->pluck('id')->map(fn ($v) => (string) $v)->all();
        $d = DB::table('payer_discounts')->where('id', $discountId)
            ->where(fn ($q) => $q->where('guardian_id', $guardianId)->orWhereIn('student_id', $childIds ?: ['00000000-0000-0000-0000-000000000000']))
            ->first();
        if ($d === null) {
            abort(404, 'Discount not found.');
        }

        return $d;
    }

    private function academyId(): string
    {
        return (string) app(AuthContext::class)->academyId;
    }

    private function timezone(string $academyId): string
    {
        return (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC');
    }
}
