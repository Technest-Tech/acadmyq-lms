<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\DataTable;
use App\Support\SupportRequests;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The platform team's support inbox (`platform.manage`): every client's problems and change
 * requests in one queue, and one client's on its own page (`filter[academy]`).
 *
 *   GET   /api/admin/support                 the queue (search, filter[status|academy|kind|priority], sort, page)
 *   GET   /api/admin/support/summary         how many carry something we have not read (sidebar badge)
 *   POST  /api/admin/support                 log a request on a client's behalf — work we did for it,
 *                                            or something it asked for by phone (source ADMIN)
 *   GET   /api/admin/support/{id}            one request + the whole conversation, internal notes too;
 *                                            marks it read for the team
 *   POST  /api/admin/support/{id}/messages   answer, and/or move it (accept, ask, done, reject), or
 *                                            leave an internal note the client never sees
 *   PATCH /api/admin/support/{id}            fix its kind, priority or title
 *
 * `filter[status]` takes a status, or OPEN / CLOSED / UNREAD for the groups the screen's tiles show.
 */
final class SupportInboxController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('platform.manage');

        $filter = $request->query('filter');
        $academy = is_array($filter) ? ($filter['academy'] ?? null) : null;
        $academy = self::isUuid($academy) ? (string) $academy : null;

        $result = DataTable::paginate(SupportRequests::listQuery('ADMIN'), $request, [
            'searchable' => ['r.title', 'r.body', 'a.name', 'r.created_by_name'],
            'sortable' => [
                'last_activity_at' => 'r.last_activity_at',
                'created_at' => 'r.created_at',
                'number' => 'r.number',
                'status' => 'r.status',
            ],
            'filters' => [
                'status' => static function ($q, $value): void {
                    $value = strtoupper((string) $value);
                    match ($value) {
                        'OPEN' => $q->whereIn('r.status', SupportRequests::OPEN),
                        'CLOSED' => $q->whereIn('r.status', SupportRequests::CLOSED),
                        'UNREAD' => $q->where('r.unread_by_admin', true),
                        default => $q->where('r.status', $value),
                    };
                },
                // A malformed id matches nothing rather than reaching Postgres as a bad uuid.
                'academy' => static fn ($q, $value) => self::isUuid($value)
                    ? $q->where('r.academy_id', (string) $value)
                    : $q->whereRaw('false'),
                'kind' => static fn ($q, $value) => $q->where('r.kind', strtoupper((string) $value)),
                'priority' => static fn ($q, $value) => $q->where('r.priority', strtoupper((string) $value)),
            ],
            'idColumn' => 'r.id',
            'defaultSort' => '-last_activity_at',
            'defaultPageSize' => 50,
        ]);

        $result['rows'] = $result['rows']->map(static fn (object $r): array => SupportRequests::row($r, 'ADMIN'))->values();
        $result['counts'] = $this->counts($academy);

        return response()->json($result);
    }

    public function summary(): JsonResponse
    {
        Gate::authorize('platform.manage');

        return response()->json([
            'unread' => DB::table('support_requests')->where('unread_by_admin', true)->count(),
            'new' => DB::table('support_requests')->where('status', 'NEW')->count(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        Gate::authorize('platform.manage');
        $ctx = app(AuthContext::class);

        $data = $request->validate([
            'academy_id' => ['required', 'uuid'],
            'kind' => ['required', Rule::in(SupportRequests::KINDS)],
            'title' => ['required', 'string', 'max:'.SupportRequests::MAX_TITLE],
            'body' => ['nullable', 'string', 'max:'.SupportRequests::MAX_BODY],
            'priority' => ['sometimes', Rule::in(SupportRequests::PRIORITIES)],
            'status' => ['sometimes', Rule::in(SupportRequests::ADMIN_STATUSES)],
            ...SupportRequests::attachmentRules(),
        ]);

        // Name the academy: RLS admits the Super Admin to every row of `academies`.
        $academyId = (string) $data['academy_id'];
        abort_unless(DB::table('academies')->where('id', $academyId)->exists(), 404, 'Client not found.');

        $title = trim($data['title']);
        if ($title === '') {
            throw ValidationException::withMessages(['title' => ['Write a short title.']]);
        }
        $status = $data['status'] ?? 'DONE';

        $id = DB::transaction(function () use ($data, $title, $status, $academyId, $ctx, $request): string {
            $number = SupportRequests::nextNumber($academyId);
            $closed = in_array($status, SupportRequests::CLOSED, true);
            $id = (string) DB::table('support_requests')->insertGetId([
                'academy_id' => $academyId,
                'number' => $number,
                'kind' => $data['kind'],
                'title' => $title,
                'body' => trim((string) ($data['body'] ?? '')),
                'priority' => $data['priority'] ?? 'NORMAL',
                'status' => $status,
                'source' => 'ADMIN',
                'created_by' => $ctx->userId,
                'created_by_name' => SupportRequests::nameOf($ctx->userId),
                'accepted_at' => $status === 'NEW' ? null : DB::raw('now()'),
                'closed_at' => $closed ? DB::raw('now()') : null,
                // The client sees a new line on its page — that is the point of logging it.
                'unread_by_academy' => true,
            ]);

            $files = SupportRequests::storeFiles($request->file('attachments', []), $academyId, $id);
            if ($files !== []) {
                DB::table('support_requests')->where('id', $id)->update(['attachments' => json_encode($files)]);
            }

            Audit::log('support.request_logged', 'support_request', $id, $academyId, $ctx->userId, $ctx->role,
                after: ['number' => $number, 'kind' => $data['kind'], 'title' => $title, 'status' => $status]);

            return $id;
        });

        return response()->json($this->detail($id), 201);
    }

    public function show(string $id): JsonResponse
    {
        Gate::authorize('platform.manage');
        $this->find($id);

        DB::table('support_requests')->where('id', $id)->where('unread_by_admin', true)
            ->update(['unread_by_admin' => false]);

        return response()->json($this->detail($id));
    }

    public function respond(Request $request, string $id): JsonResponse
    {
        Gate::authorize('platform.manage');
        $ctx = app(AuthContext::class);
        $r = $this->find($id);

        $data = $request->validate([
            'body' => ['nullable', 'string', 'max:'.SupportRequests::MAX_BODY],
            'internal' => ['sometimes', 'boolean'],
            'status' => ['sometimes', 'nullable', Rule::in(SupportRequests::ADMIN_STATUSES)],
            ...SupportRequests::attachmentRules(),
        ]);

        $body = trim((string) ($data['body'] ?? ''));
        $internal = (bool) ($data['internal'] ?? false);
        $uploads = $request->file('attachments', []);
        $to = $data['status'] ?? null;
        $to = $to === $r->status ? null : $to;

        if ($internal && $to !== null) {
            throw ValidationException::withMessages(['status' => ['An internal note cannot change the status — the client would see the change with no word on it.']]);
        }
        if ($to !== null && in_array($to, SupportRequests::NEEDS_WORDS, true) && $body === '') {
            throw ValidationException::withMessages(['body' => [$to === 'WAITING'
                ? 'Write the question the client should answer.'
                : 'Write the reason — the client reads it.']]);
        }
        if ($body === '' && $uploads === [] && $to === null) {
            throw ValidationException::withMessages(['body' => ['Write a reply or choose a status.']]);
        }

        DB::transaction(function () use ($r, $to, $body, $internal, $uploads, $ctx): void {
            DB::table('support_request_messages')->insert([
                'academy_id' => $r->academy_id,
                'request_id' => $r->id,
                'side' => 'ADMIN',
                'author_id' => $ctx->userId,
                'author_name' => SupportRequests::nameOf($ctx->userId),
                'body' => $body,
                'internal' => $internal,
                'status_from' => $to !== null ? $r->status : null,
                'status_to' => $to,
                'attachments' => json_encode(SupportRequests::storeFiles($uploads, (string) $r->academy_id, (string) $r->id)),
            ]);

            // An internal note is ours alone: the client's page neither lights up nor moves.
            $patch = $internal
                ? ['unread_by_admin' => false]
                : [
                    ...($to !== null ? SupportRequests::statusPatch($r, $to) : []),
                    'unread_by_admin' => false,
                    'unread_by_academy' => true,
                    'last_activity_at' => DB::raw('now()'),
                ];
            DB::table('support_requests')->where('id', $r->id)->update([...$patch, 'updated_at' => DB::raw('now()')]);

            if ($to !== null) {
                Audit::log('support.request_status', 'support_request', (string) $r->id, (string) $r->academy_id, $ctx->userId, $ctx->role,
                    after: ['status' => $to], before: ['status' => $r->status]);
            }
        });

        return response()->json($this->detail($id));
    }

    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('platform.manage');
        $r = $this->find($id);

        $data = $request->validate([
            'kind' => ['sometimes', Rule::in(SupportRequests::KINDS)],
            'priority' => ['sometimes', Rule::in(SupportRequests::PRIORITIES)],
            'title' => ['sometimes', 'string', 'max:'.SupportRequests::MAX_TITLE],
        ]);
        if (array_key_exists('title', $data)) {
            $data['title'] = trim($data['title']);
            if ($data['title'] === '') {
                throw ValidationException::withMessages(['title' => ['Write a short title.']]);
            }
        }

        if ($data !== []) {
            DB::table('support_requests')->where('id', $id)->update([...$data, 'updated_at' => DB::raw('now()')]);
            $ctx = app(AuthContext::class);
            Audit::log('support.request_updated', 'support_request', $id, (string) $r->academy_id, $ctx->userId, $ctx->role,
                after: $data, before: array_intersect_key((array) $r, $data));
        }

        return response()->json($this->detail($id));
    }

    private static function isUuid(mixed $value): bool
    {
        return is_string($value) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value) === 1;
    }

    private function find(string $id): object
    {
        abort_unless(self::isUuid($id), 404, 'Request not found.');
        $r = DB::table('support_requests')->where('id', $id)->first();
        abort_if($r === null, 404, 'Request not found.');

        return $r;
    }

    /** @return array<string, mixed> */
    private function detail(string $id): array
    {
        $r = SupportRequests::listQuery('ADMIN')->where('r.id', $id)->first();

        return SupportRequests::detail($r, 'ADMIN');
    }

    /**
     * The tiles above the queue: every status, the open / closed groups and what is unread — over
     * the whole inbox, or one client's when the screen is that client's page.
     *
     * @return array<string, int>
     */
    private function counts(?string $academyId): array
    {
        $rows = DB::table('support_requests')
            ->when($academyId !== null, static fn ($q) => $q->where('academy_id', $academyId))
            ->selectRaw('status, count(*) as n, count(*) filter (where unread_by_admin) as unread,
                         count(*) filter (where priority = ? and status in (?, ?, ?)) as urgent',
                ['URGENT', ...SupportRequests::OPEN])
            ->groupBy('status')
            ->get();

        $counts = array_fill_keys(SupportRequests::STATUSES, 0);
        $unread = 0;
        $urgent = 0;
        foreach ($rows as $row) {
            $counts[(string) $row->status] = (int) $row->n;
            $unread += (int) $row->unread;
            $urgent += (int) $row->urgent;
        }

        return [
            ...$counts,
            'OPEN' => array_sum(array_intersect_key($counts, array_flip(SupportRequests::OPEN))),
            'CLOSED' => array_sum(array_intersect_key($counts, array_flip(SupportRequests::CLOSED))),
            'ALL' => array_sum($counts),
            'UNREAD' => $unread,
            'URGENT' => $urgent,
        ];
    }
}
