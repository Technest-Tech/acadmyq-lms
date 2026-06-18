<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\AuthContext;
use App\Support\Entitlement;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * GET /api/audit (Sprint 9 §5) — the read UI over the append-only `audit_log` that Sprints
 * 2–8 have been populating. Append-only forever: this controller only ever SELECTs (§3.4).
 *
 * Scoping (AC-9.6 / TC-9.8):
 *   - ACADEMY_OWNER: their own academy only, enforced by the DB — the `audit_select` RLS
 *     policy (`academy_id = app.current_academy_id()`) is the guarantee, not an app `where`.
 *   - SUPER_ADMIN: the whole platform, via the audited `app.admin_audit(...)` SECURITY
 *     DEFINER escape hatch (same pattern as `app.admin_list_academies`). A cross-academy row
 *     can never leak to an owner because the owner path never touches that function.
 *
 * Plan-gated depth (AC-9.6 / TC-9.9): BASIC sees the last 30 days; the `audit.full`
 * capability (PRO, or the add-on) unlocks the full history — gating applied to an EXISTING
 * feature. Super Admin is platform-level and is never depth-limited.
 *
 * Filters: actor, action, entity type, entity id, date range — all bound parameters / fixed
 * function arguments; the client never names a column (injection-safe, §6.5).
 */
final class AuditController extends Controller
{
    private const DEPTH_DAYS = 30;

    private const MAX_PAGE_SIZE = 100;

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('audit.read');

        $ctx = app(AuthContext::class);

        $filters = $request->validate([
            'actor' => ['nullable', 'uuid'],
            'action' => ['nullable', 'string', 'max:128'],
            'entity' => ['nullable', 'string', 'max:128'],
            'entityId' => ['nullable', 'uuid'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'page' => ['nullable', 'integer', 'min:1'],
            'pageSize' => ['nullable', 'integer', 'min:1'],
        ]);

        $page = max(1, (int) ($filters['page'] ?? 1));
        $pageSize = max(1, min((int) ($filters['pageSize'] ?? 25), self::MAX_PAGE_SIZE));
        $offset = ($page - 1) * $pageSize;

        if ($ctx->role === 'SUPER_ADMIN') {
            return $this->superAdminView($filters, $page, $pageSize, $offset);
        }

        return $this->ownerView($ctx, $filters, $page, $pageSize, $offset);
    }

    /** Platform-wide read via the audited escape hatch (no depth limit). */
    private function superAdminView(array $filters, int $page, int $pageSize, int $offset): JsonResponse
    {
        $json = DB::selectOne('select app.admin_audit(?, ?, ?::uuid, ?::timestamptz, ?::timestamptz, ?, ?) as a', [
            $filters['action'] ?? null,
            $filters['entity'] ?? null,
            $filters['actor'] ?? null,
            isset($filters['from']) ? Carbon::parse($filters['from'])->startOfDay() : null,
            isset($filters['to']) ? Carbon::parse($filters['to'])->endOfDay() : null,
            $pageSize,
            $offset,
        ])->a;

        $result = json_decode($json, true) ?: ['rows' => [], 'total' => 0];

        return response()->json([
            'rows' => $result['rows'] ?? [],
            'total' => $result['total'] ?? 0,
            'page' => $page,
            'pageSize' => $pageSize,
            'depthLimitedDays' => null,
        ]);
    }

    /** Own-academy read, RLS-scoped, with plan-gated depth (BASIC = last 30 days). */
    private function ownerView(AuthContext $ctx, array $filters, int $page, int $pageSize, int $offset): JsonResponse
    {
        $depthLimited = ! Entitlement::check($ctx, 'audit.full');

        $base = DB::table('audit_log as al')
            ->leftJoin('users as u', 'u.id', '=', 'al.actor_user_id')
            ->when($depthLimited, fn ($q) => $q->where('al.created_at', '>=', now()->subDays(self::DEPTH_DAYS)))
            ->when($filters['actor'] ?? null, fn ($q, $v) => $q->where('al.actor_user_id', $v))
            ->when($filters['action'] ?? null, fn ($q, $v) => $q->where('al.action', $v))
            ->when($filters['entity'] ?? null, fn ($q, $v) => $q->where('al.entity_type', $v))
            ->when($filters['entityId'] ?? null, fn ($q, $v) => $q->where('al.entity_id', $v))
            ->when(isset($filters['from']), fn ($q) => $q->where('al.created_at', '>=', Carbon::parse($filters['from'])->startOfDay()))
            ->when(isset($filters['to']), fn ($q) => $q->where('al.created_at', '<=', Carbon::parse($filters['to'])->endOfDay()));

        $total = (clone $base)->count();

        $rows = $base
            ->orderByDesc('al.created_at')
            ->forPage($page, $pageSize)
            ->get([
                'al.id', 'al.academy_id', 'al.actor_user_id', 'u.full_name as actor_name',
                'al.actor_role', 'al.action', 'al.entity_type', 'al.entity_id',
                'al.before', 'al.after', 'al.created_at',
            ])
            ->map(function (object $r): array {
                return [
                    'id' => $r->id,
                    'academy_id' => $r->academy_id,
                    'academy_name' => null,
                    'actor_user_id' => $r->actor_user_id,
                    'actor_name' => $r->actor_name,
                    'actor_role' => $r->actor_role,
                    'action' => $r->action,
                    'entity_type' => $r->entity_type,
                    'entity_id' => $r->entity_id,
                    'before' => $r->before !== null ? json_decode($r->before, true) : null,
                    'after' => $r->after !== null ? json_decode($r->after, true) : null,
                    'created_at' => $r->created_at,
                ];
            })
            ->all();

        return response()->json([
            'rows' => $rows,
            'total' => $total,
            'page' => $page,
            'pageSize' => $pageSize,
            'depthLimitedDays' => $depthLimited ? self::DEPTH_DAYS : null,
        ]);
    }
}
