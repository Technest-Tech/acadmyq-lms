<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\DataTable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * The platform team's inbox for marketing-site demo requests (see the `demo_requests` migration).
 *
 * PLATFORM-scoped, `platform.manage` only — the same gate as the rest of the Super Admin surface,
 * and the right one here for a blunt reason: a lead is a stranger's phone number and email, held by
 * us and belonging to no academy, so there is no tenant whose staff could ever have a claim on it.
 * The RLS policies on the table say the same thing a second time (`app.is_super_admin()`), so a
 * missing Gate call would return an empty list rather than someone else's prospects.
 *
 * Two verbs, deliberately: read the queue, and record what happened to a row (status + a note).
 * Nothing here contacts anyone — outreach happens in a person's own phone and inbox, and pretending
 * otherwise would put a half-built CRM in the admin panel. Export is the client's job: the list is
 * returned whole enough for the Super Admin screen to write an .xlsx from what it already has.
 */
final class DemoRequestController extends Controller
{
    private const STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST'];

    /** GET /api/admin/demo-requests — the queue, newest first. */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('platform.manage');

        $result = DataTable::paginate(DB::table('demo_requests'), $request, [
            'searchable' => ['name', 'email', 'phone', 'role', 'message'],
            'sortable' => [
                'created_at' => 'created_at',
                'id' => 'id',
                'name' => 'name',
                'status' => 'status',
                'product' => 'product',
            ],
            'filters' => [
                'status' => fn ($q, $value) => $q->where('status', strtoupper((string) $value)),
                'product' => fn ($q, $value) => $q->where('product', strtoupper((string) $value)),
                'country' => fn ($q, $value) => $q->where('country', strtoupper((string) $value)),
            ],
            // `-id` is not decoration: `created_at` is bound at second precision, so two leads that
            // arrive in the same second tie — and the engine's stable tiebreak is id ASC, which
            // would print the OLDER of the two first in a queue that reads newest-first. The ids
            // are uuid v7, so descending id is descending arrival time, exactly.
            'defaultSort' => '-created_at,-id',
        ]);

        $result['rows'] = $result['rows']->map(function (object $row): object {
            $row->created_at = $this->iso($row->created_at ?? null);
            $row->updated_at = $this->iso($row->updated_at ?? null);
            $row->consent = (bool) $row->consent;

            return $row;
        });

        // The status ribbon on the screen counts the whole queue, not the page in front of you.
        $result['counts'] = $this->counts();

        return response()->json($result);
    }

    /** PATCH /api/admin/demo-requests/{id} — record the outcome of working a lead. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('platform.manage');

        $data = $request->validate([
            'status' => ['sometimes', Rule::in(self::STATUSES)],
            'note' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        $before = DB::table('demo_requests')->where('id', $id)->first(['status', 'note']);
        if ($before === null) {
            abort(404, 'Demo request not found.');
        }

        $patch = [];
        if (array_key_exists('status', $data)) {
            $patch['status'] = $data['status'];
        }
        if (array_key_exists('note', $data)) {
            $note = trim((string) ($data['note'] ?? ''));
            $patch['note'] = $note === '' ? null : $note;
        }

        if ($patch !== []) {
            $patch['updated_at'] = now();
            DB::table('demo_requests')->where('id', $id)->update($patch);

            // Platform-scoped action ⇒ no academy_id. Recorded because "who marked this WON" is a
            // question that gets asked the moment two people work the same queue.
            $ctx = app(AuthContext::class);
            Audit::log(
                action: 'demo_request.updated',
                entityType: 'demo_request',
                entityId: $id,
                academyId: null,
                actorUserId: $ctx->userId,
                actorRole: $ctx->role,
                after: ['status' => $patch['status'] ?? $before->status],
                before: ['status' => $before->status],
            );
        }

        $row = DB::table('demo_requests')->where('id', $id)->first();
        if ($row !== null) {
            $row->created_at = $this->iso($row->created_at ?? null);
            $row->updated_at = $this->iso($row->updated_at ?? null);
            $row->consent = (bool) $row->consent;
        }

        return response()->json(['request' => $row, 'counts' => $this->counts()]);
    }

    /** @return array<string,int> status → count over the whole table, plus `total`. */
    private function counts(): array
    {
        $rows = DB::table('demo_requests')
            ->selectRaw('status, count(*) as n')
            ->groupBy('status')
            ->get();

        $counts = array_fill_keys(self::STATUSES, 0);
        $total = 0;
        foreach ($rows as $row) {
            $counts[(string) $row->status] = (int) $row->n;
            $total += (int) $row->n;
        }
        $counts['total'] = $total;

        return $counts;
    }

    private function iso(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        return Carbon::parse((string) $value)->toIso8601String();
    }
}
