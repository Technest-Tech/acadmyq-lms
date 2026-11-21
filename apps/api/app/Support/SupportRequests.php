<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Database\Query\Builder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * One academy's problems and change requests, and the platform team's answers on them
 * (`support_requests` + `support_request_messages`, see the migration of 2026_11_27).
 *
 * The rules both sides share live here so the academy's page, the Super Admin inbox and the
 * `support:log` command can never disagree on what a status means:
 *
 *   NEW          waiting for the platform team to look at it
 *   IN_PROGRESS  accepted — being worked on
 *   WAITING      the team asked the academy something; the academy's answer puts it back
 *   DONE         solved / delivered            ┐
 *   REJECTED     declined, with the reason     ├ closed
 *   CANCELLED    the academy withdrew it       ┘
 *
 * A reply from the academy on a DONE request reopens it (the problem came back); REJECTED and
 * CANCELLED are final for the academy — it raises a new request instead. The platform team can
 * move any request anywhere.
 */
final class SupportRequests
{
    public const KINDS = ['PROBLEM', 'CHANGE'];

    public const PRIORITIES = ['NORMAL', 'URGENT'];

    public const STATUSES = ['NEW', 'IN_PROGRESS', 'WAITING', 'DONE', 'REJECTED', 'CANCELLED'];

    /** Still being dealt with. */
    public const OPEN = ['NEW', 'IN_PROGRESS', 'WAITING'];

    /** Finished one way or another. */
    public const CLOSED = ['DONE', 'REJECTED', 'CANCELLED'];

    /** What the platform team may move a request to from the inbox. */
    public const ADMIN_STATUSES = ['NEW', 'IN_PROGRESS', 'WAITING', 'DONE', 'REJECTED'];

    /** A status the team can only set with words the academy reads: a question, or the reason for a no. */
    public const NEEDS_WORDS = ['WAITING', 'REJECTED'];

    /** Screenshots (or a PDF) per post. Three of 5 MB stay under prod's 20 MB PHP body limit. */
    public const MAX_FILES = 3;

    public const MAX_FILE_KB = 5120;

    public const FILE_MIMES = 'jpg,jpeg,png,webp,gif,pdf';

    public const MAX_TITLE = 200;

    public const MAX_BODY = 5000;

    /** Validation rules for the files a post may carry (multipart `attachments[]`). */
    public static function attachmentRules(): array
    {
        return [
            'attachments' => ['sometimes', 'array', 'max:'.self::MAX_FILES],
            'attachments.*' => ['file', 'mimes:'.self::FILE_MIMES, 'max:'.self::MAX_FILE_KB],
        ];
    }

    /**
     * The academy's next request number (#1, #2 …). Serialised per academy with a transaction-level
     * advisory lock, so two requests sent in the same second cannot both take the same number.
     * Must run inside a transaction (every request does — TenantContextMiddleware).
     */
    public static function nextNumber(string $academyId): int
    {
        DB::select('select pg_advisory_xact_lock(hashtext(?))', ['support_requests:'.$academyId]);

        return (int) DB::table('support_requests')->where('academy_id', $academyId)->max('number') + 1;
    }

    /**
     * Put uploaded files on the media disk under the request's folder.
     *
     * @param  array<int, UploadedFile>  $files
     * @return list<array{key: string, name: string, size: int, type: string}>
     */
    public static function storeFiles(array $files, string $academyId, string $requestId): array
    {
        $disk = Storage::disk(LmsMedia::disk());
        $stored = [];

        foreach ($files as $file) {
            $ext = strtolower((string) ($file->getClientOriginalExtension() ?: $file->extension()));
            $ext = preg_match('/^[a-z0-9]{1,5}$/', $ext) === 1 ? $ext : 'bin';
            $dir = "support/{$academyId}/{$requestId}";
            $name = ((string) Str::uuid()).'.'.$ext;
            $disk->putFileAs($dir, $file, $name);

            $stored[] = [
                'key' => $dir.'/'.$name,
                'name' => Str::limit((string) $file->getClientOriginalName(), 180, ''),
                'size' => (int) $file->getSize(),
                'type' => (string) ($file->getMimeType() ?? 'application/octet-stream'),
            ];
        }

        return $stored;
    }

    /**
     * Stored attachments → what a screen shows: name, size, type and a short-lived signed url.
     *
     * @return list<array{name: string, size: int, type: string, url: string}>
     */
    public static function files(mixed $json): array
    {
        $list = is_string($json) ? json_decode($json, true) : $json;
        if (! is_array($list)) {
            return [];
        }

        $out = [];
        foreach ($list as $file) {
            if (! is_array($file) || ! isset($file['key']) || ! str_starts_with((string) $file['key'], 'support/')) {
                continue;
            }
            $out[] = [
                'name' => (string) ($file['name'] ?? 'file'),
                'size' => (int) ($file['size'] ?? 0),
                'type' => (string) ($file['type'] ?? ''),
                'url' => LmsMedia::objectUrl((string) $file['key']),
            ];
        }

        return $out;
    }

    /**
     * One request as a list row. `$side` is who is looking: the academy sees its own unread flag and
     * never the team member's name; the platform team also gets the academy it belongs to.
     *
     * @return array<string, mixed>
     */
    public static function row(object $r, string $side): array
    {
        $row = [
            'id' => (string) $r->id,
            'number' => (int) $r->number,
            'kind' => (string) $r->kind,
            'title' => (string) $r->title,
            'priority' => (string) $r->priority,
            'status' => (string) $r->status,
            'source' => (string) $r->source,
            'page' => $r->page !== null ? (string) $r->page : null,
            'createdBy' => $side === 'ADMIN' || $r->source === 'ACADEMY'
                ? ($r->created_by_name !== null ? (string) $r->created_by_name : null)
                : null,
            'unread' => (bool) ($side === 'ADMIN' ? $r->unread_by_admin : $r->unread_by_academy),
            'replies' => (int) ($r->replies ?? 0),
            'createdAt' => self::iso($r->created_at),
            'lastActivityAt' => self::iso($r->last_activity_at),
            'closedAt' => self::iso($r->closed_at),
        ];

        if ($side === 'ADMIN') {
            $row['academy'] = ['id' => (string) $r->academy_id, 'name' => (string) ($r->academy_name ?? '')];
        }

        return $row;
    }

    /**
     * A request with its body, files and conversation.
     *
     * @return array<string, mixed>
     */
    public static function detail(object $r, string $side): array
    {
        $messages = DB::table('support_request_messages')
            ->where('request_id', $r->id)
            ->where('academy_id', $r->academy_id)
            ->when($side !== 'ADMIN', static fn ($q) => $q->where('internal', false))
            ->orderBy('created_at')
            ->orderBy('id')
            ->get();

        return [
            'request' => [
                ...self::row($r, $side),
                'body' => (string) $r->body,
                'attachments' => self::files($r->attachments),
            ],
            'messages' => $messages->map(static fn (object $m): array => [
                'id' => (string) $m->id,
                'side' => (string) $m->side,
                // The academy reads "the support team", not which of us wrote.
                'author' => $side === 'ADMIN' || $m->side === 'ACADEMY'
                    ? ($m->author_name !== null ? (string) $m->author_name : null)
                    : null,
                'body' => (string) $m->body,
                'internal' => (bool) $m->internal,
                'statusFrom' => $m->status_from !== null ? (string) $m->status_from : null,
                'statusTo' => $m->status_to !== null ? (string) $m->status_to : null,
                'attachments' => self::files($m->attachments),
                'createdAt' => self::iso($m->created_at),
            ])->all(),
        ];
    }

    /** The base list query: a request + how many visible replies it has (+ the academy's name). */
    public static function listQuery(string $side): Builder
    {
        $replies = DB::table('support_request_messages as m')
            ->selectRaw('count(*)')
            ->whereColumn('m.request_id', 'r.id')
            ->where('m.body', '!=', '')
            ->when($side !== 'ADMIN', static fn ($q) => $q->where('m.internal', false));

        return DB::table('support_requests as r')
            ->join('academies as a', 'a.id', '=', 'r.academy_id')
            ->select('r.*', 'a.name as academy_name')
            ->selectSub($replies, 'replies');
    }

    /**
     * The columns a status change writes, besides the status itself.
     *
     * @return array<string, mixed>
     */
    public static function statusPatch(object $r, string $to): array
    {
        $patch = ['status' => $to];

        // Instants are stamped by the database: a PHP Carbon binds as a naive string the PG session
        // reads in its own zone (see the pg-naive-timestamp trap).
        if ($to === 'IN_PROGRESS' && $r->accepted_at === null) {
            $patch['accepted_at'] = DB::raw('now()');
        }
        $patch['closed_at'] = in_array($to, self::CLOSED, true) ? DB::raw('now()') : null;

        return $patch;
    }

    /** Who is writing, for the name copied onto the row. */
    public static function nameOf(string $userId): ?string
    {
        $name = DB::table('users')->where('id', $userId)->value('full_name');

        return $name !== null ? (string) $name : null;
    }

    public static function iso(mixed $value): ?string
    {
        return $value !== null ? Carbon::parse((string) $value)->toIso8601String() : null;
    }
}
