<?php

declare(strict_types=1);

namespace App\Http\Controllers\Support;

use App\Http\Controllers\Controller;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\SupportRequests;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The academy's side of support (`support.manage`): raise a problem or a change request, follow
 * where each one stands, answer the platform team, withdraw one sent by mistake.
 *
 *   GET  /api/support/requests               every request this academy ever raised, newest activity first
 *   GET  /api/support/summary                how many carry an answer nobody here has read (sidebar badge)
 *   POST /api/support/requests               raise one (multipart: kind, title, body, priority, page, attachments[])
 *   GET  /api/support/requests/{id}          one request + the conversation; marks it read for the academy
 *   POST /api/support/requests/{id}/messages answer / add details (multipart: body, attachments[])
 *   POST /api/support/requests/{id}/withdraw take back a request the team has not looked at yet
 *
 * Every query names the academy: the platform Super Admin is admitted to every row of these
 * tables by RLS, so "my academy" must never be left for the policy to pick.
 */
final class SupportRequestController extends Controller
{
    /** Enough for years of an academy's requests; the page filters on the client. */
    private const LIST_LIMIT = 500;

    public function index(): JsonResponse
    {
        $academyId = $this->academy();

        $rows = SupportRequests::listQuery('ACADEMY')
            ->where('r.academy_id', $academyId)
            ->orderByDesc('r.last_activity_at')
            ->orderByDesc('r.number')
            ->limit(self::LIST_LIMIT)
            ->get();

        $count = static fn (array $statuses): int => $rows->whereIn('status', $statuses)->count();

        return response()->json([
            'rows' => $rows->map(static fn (object $r): array => SupportRequests::row($r, 'ACADEMY'))->values()->all(),
            'counts' => [
                'open' => $count(SupportRequests::OPEN),
                'waiting' => $count(['WAITING']),
                'closed' => $count(SupportRequests::CLOSED),
                'unread' => $rows->where('unread_by_academy', true)->count(),
            ],
        ]);
    }

    public function summary(): JsonResponse
    {
        $academyId = $this->academy();

        return response()->json([
            'unread' => DB::table('support_requests')
                ->where('academy_id', $academyId)
                ->where('unread_by_academy', true)
                ->count(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $academyId = $this->academy();
        $ctx = app(AuthContext::class);

        $data = $request->validate([
            'kind' => ['required', Rule::in(SupportRequests::KINDS)],
            'title' => ['required', 'string', 'max:'.SupportRequests::MAX_TITLE],
            'body' => ['nullable', 'string', 'max:'.SupportRequests::MAX_BODY],
            'priority' => ['sometimes', Rule::in(SupportRequests::PRIORITIES)],
            'page' => ['sometimes', 'nullable', 'string', 'max:300'],
            ...SupportRequests::attachmentRules(),
        ]);

        $title = trim($data['title']);
        if ($title === '') {
            throw ValidationException::withMessages(['title' => ['Write a short title.']]);
        }

        $id = DB::transaction(function () use ($data, $title, $academyId, $ctx, $request): string {
            $number = SupportRequests::nextNumber($academyId);
            $id = (string) DB::table('support_requests')->insertGetId([
                'academy_id' => $academyId,
                'number' => $number,
                'kind' => $data['kind'],
                'title' => $title,
                'body' => trim((string) ($data['body'] ?? '')),
                'priority' => $data['priority'] ?? 'NORMAL',
                'status' => 'NEW',
                'source' => 'ACADEMY',
                'page' => $this->cleanPage($data['page'] ?? null),
                'created_by' => $ctx->userId,
                'created_by_name' => SupportRequests::nameOf($ctx->userId),
                'unread_by_admin' => true,
            ]);

            $files = SupportRequests::storeFiles($request->file('attachments', []), $academyId, $id);
            if ($files !== []) {
                DB::table('support_requests')->where('id', $id)->update(['attachments' => json_encode($files)]);
            }

            Audit::log('support.request_created', 'support_request', $id, $academyId, $ctx->userId, $ctx->role,
                after: ['number' => $number, 'kind' => $data['kind'], 'title' => $title]);

            return $id;
        });

        return response()->json($this->detail($academyId, $id), 201);
    }

    public function show(string $id): JsonResponse
    {
        $academyId = $this->academy();
        $this->find($academyId, $id);

        DB::table('support_requests')
            ->where('academy_id', $academyId)
            ->where('id', $id)
            ->where('unread_by_academy', true)
            ->update(['unread_by_academy' => false]);

        return response()->json($this->detail($academyId, $id));
    }

    public function reply(Request $request, string $id): JsonResponse
    {
        $academyId = $this->academy();
        $ctx = app(AuthContext::class);
        $r = $this->find($academyId, $id);

        $data = $request->validate([
            'body' => ['nullable', 'string', 'max:'.SupportRequests::MAX_BODY],
            ...SupportRequests::attachmentRules(),
        ]);

        $body = trim((string) ($data['body'] ?? ''));
        $uploads = $request->file('attachments', []);
        if ($body === '' && $uploads === []) {
            throw ValidationException::withMessages(['body' => ['Write a reply or attach a file.']]);
        }

        if (in_array($r->status, ['REJECTED', 'CANCELLED'], true)) {
            abort(409, 'This request is closed — raise a new one.');
        }

        // An answer to the team's question puts the request back where it was; a word on a solved
        // request means it is not solved after all.
        $to = match ($r->status) {
            'WAITING' => $r->accepted_at !== null ? 'IN_PROGRESS' : 'NEW',
            'DONE' => 'IN_PROGRESS',
            default => null,
        };

        DB::transaction(function () use ($r, $to, $body, $uploads, $academyId, $ctx): void {
            DB::table('support_request_messages')->insert([
                'academy_id' => $academyId,
                'request_id' => $r->id,
                'side' => 'ACADEMY',
                'author_id' => $ctx->userId,
                'author_name' => SupportRequests::nameOf($ctx->userId),
                'body' => $body,
                'status_from' => $to !== null ? $r->status : null,
                'status_to' => $to,
                'attachments' => json_encode(SupportRequests::storeFiles($uploads, $academyId, (string) $r->id)),
            ]);

            DB::table('support_requests')->where('academy_id', $academyId)->where('id', $r->id)->update([
                ...($to !== null ? SupportRequests::statusPatch($r, $to) : []),
                'unread_by_admin' => true,
                'last_activity_at' => DB::raw('now()'),
                'updated_at' => DB::raw('now()'),
            ]);
        });

        return response()->json($this->detail($academyId, $id));
    }

    public function withdraw(string $id): JsonResponse
    {
        $academyId = $this->academy();
        $ctx = app(AuthContext::class);
        $r = $this->find($academyId, $id);

        if ($r->status !== 'NEW') {
            abort(409, 'Only a request the team has not picked up yet can be withdrawn.');
        }

        DB::table('support_request_messages')->insert([
            'academy_id' => $academyId,
            'request_id' => $r->id,
            'side' => 'ACADEMY',
            'author_id' => $ctx->userId,
            'author_name' => SupportRequests::nameOf($ctx->userId),
            'status_from' => 'NEW',
            'status_to' => 'CANCELLED',
        ]);
        DB::table('support_requests')->where('academy_id', $academyId)->where('id', $r->id)->update([
            ...SupportRequests::statusPatch($r, 'CANCELLED'),
            'unread_by_admin' => true,
            'last_activity_at' => DB::raw('now()'),
            'updated_at' => DB::raw('now()'),
        ]);

        Audit::log('support.request_withdrawn', 'support_request', (string) $r->id, $academyId, $ctx->userId, $ctx->role,
            after: ['status' => 'CANCELLED'], before: ['status' => 'NEW']);

        return response()->json($this->detail($academyId, $id));
    }

    /** The signed-in academy, after the capability check. */
    private function academy(): string
    {
        Gate::authorize('support.manage');
        $academyId = app(AuthContext::class)->academyId;
        abort_if($academyId === null, 404, 'No academy.');

        return $academyId;
    }

    private function find(string $academyId, string $id): object
    {
        $r = DB::table('support_requests')->where('academy_id', $academyId)->where('id', $id)->first();
        abort_if($r === null, 404, 'Request not found.');

        return $r;
    }

    /** @return array<string, mixed> */
    private function detail(string $academyId, string $id): array
    {
        $r = SupportRequests::listQuery('ACADEMY')->where('r.academy_id', $academyId)->where('r.id', $id)->first();

        return SupportRequests::detail($r, 'ACADEMY');
    }

    /** Keep only an in-app path ("/students?tab=x"), never a full url someone pasted. */
    private function cleanPage(?string $page): ?string
    {
        $page = trim((string) $page);

        return $page !== '' && str_starts_with($page, '/') && ! str_starts_with($page, '//') ? $page : null;
    }
}
