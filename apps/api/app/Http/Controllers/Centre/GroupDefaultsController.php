<?php

declare(strict_types=1);

namespace App\Http\Controllers\Centre;

use App\Http\Controllers\Controller;
use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * A centre's group defaults (docs/centre-profile/02-COHERENCE-AUDIT §3) — `/api/group-defaults`,
 * behind `entitled:centre`. What a new group opens on: lesson length, how students pay, lessons a
 * month, how the teacher is paid, online or in a room. The group form pre-fills from them on create
 * and never overwrites what was typed; nothing server-side reads them, so a default never moves an
 * existing group.
 *
 * The money halves follow the group form's own gates: billing (mode, lessons a month) is read with
 * `student.set_price` / `invoice.read` and written with `student.set_price`; the teacher's pay is
 * read with `teacher.set_pay` / `payout.read` and written with `teacher.set_pay`. The rest is a
 * Settings list (`specialization.manage`, like rooms and levels).
 */
final class GroupDefaultsController extends Controller
{
    private const BILLING = ['billing_mode', 'month_lessons'];

    private const PAY = ['teacher_pay_mode', 'teacher_pay_minor', 'teacher_share_bp'];

    /** GET /api/group-defaults — the academy's defaults; null fields = no default. */
    public function show(): JsonResponse
    {
        if (! Gate::any(['group.read', 'group.manage', 'specialization.manage', 'settings.manage'])) {
            abort(403, 'This action is unauthorized.');
        }

        return response()->json(['defaults' => $this->present($this->row())]);
    }

    /** PATCH /api/group-defaults — set or clear any of them; what is not sent keeps its value. */
    public function update(Request $request): JsonResponse
    {
        if (! Gate::any(['specialization.manage', 'settings.manage'])) {
            abort(403, 'This action is unauthorized.');
        }

        $data = $request->validate([
            'lesson_minutes' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:600'],
            'mode' => ['sometimes', 'nullable', Rule::in(['ONLINE', 'OFFLINE'])],
            'billing_mode' => ['sometimes', 'nullable', Rule::in(['MONTHLY', 'PER_LESSON', 'COURSE'])],
            'month_lessons' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:500'],
            'teacher_pay_mode' => ['sometimes', 'nullable', Rule::in(['PER_LESSON', 'PER_HOUR', 'PER_STUDENT', 'REVENUE_SHARE'])],
            'teacher_pay_minor' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:100000000000'],
            'teacher_share_bp' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:10000'],
        ]);
        if (array_intersect(array_keys($data), self::BILLING) !== []) {
            Gate::authorize('student.set_price');
        }
        if (array_intersect(array_keys($data), self::PAY) !== []) {
            Gate::authorize('teacher.set_pay');
        }

        $ctx = app(AuthContext::class);
        if ($ctx->academyId === null) {
            abort(403, 'Enter an academy to change its group defaults.');
        }

        $before = $this->row();
        $after = array_merge($before, $data);
        // The pay amount belongs to its mode: a share for REVENUE_SHARE, an amount for the others,
        // neither without a mode.
        if (array_intersect(array_keys($data), self::PAY) !== []) {
            if ($after['teacher_pay_mode'] === null) {
                $after['teacher_pay_minor'] = null;
                $after['teacher_share_bp'] = null;
            } elseif ($after['teacher_pay_mode'] === 'REVENUE_SHARE') {
                $after['teacher_pay_minor'] = null;
            } else {
                $after['teacher_share_bp'] = null;
            }
        }

        DB::table('academy_group_defaults')->upsert(
            [['academy_id' => $ctx->academyId, ...$after, 'updated_at' => now()]],
            ['academy_id'],
            [...array_keys($after), 'updated_at'],
        );
        Audit::log('group_defaults.updated', 'academy_group_defaults', $ctx->academyId, $ctx->academyId, $ctx->userId, $ctx->role,
            after: $after, before: $before);

        return response()->json(['defaults' => $this->present($this->row())]);
    }

    /** @return array<string, mixed> every column, null when unset (or no row yet) */
    private function row(): array
    {
        $row = DB::table('academy_group_defaults')->first();

        $int = fn (string $col): ?int => $row !== null && $row->{$col} !== null ? (int) $row->{$col} : null;
        $text = fn (string $col): ?string => $row !== null && $row->{$col} !== null ? (string) $row->{$col} : null;

        return [
            'lesson_minutes' => $int('lesson_minutes'),
            'mode' => $text('mode'),
            'billing_mode' => $text('billing_mode'),
            'month_lessons' => $int('month_lessons'),
            'teacher_pay_mode' => $text('teacher_pay_mode'),
            'teacher_pay_minor' => $int('teacher_pay_minor'),
            'teacher_share_bp' => $int('teacher_share_bp'),
        ];
    }

    /** What this caller may see: the money halves only behind their own gates. */
    private function present(array $row): array
    {
        $out = ['lesson_minutes' => $row['lesson_minutes'], 'mode' => $row['mode']];
        if (Gate::any(['student.set_price', 'invoice.read'])) {
            $out += array_intersect_key($row, array_flip(self::BILLING));
        }
        if (Gate::any(['teacher.set_pay', 'payout.read'])) {
            $out += array_intersect_key($row, array_flip(self::PAY));
        }

        return $out;
    }
}
