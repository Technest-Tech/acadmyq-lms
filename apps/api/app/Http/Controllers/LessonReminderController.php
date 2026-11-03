<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\Whatsapp\GroupAlertCatalog;
use App\Services\Whatsapp\GroupAlerts;
use App\Services\Whatsapp\LessonGroupReminders;
use App\Services\Whatsapp\WasenderClient;
use App\Services\Whatsapp\WhatsAppConnection;
use App\Services\Whatsapp\WhatsAppSender;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\DataTable;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * The academy's side of lesson reminders (`whatsapp.group_reminders`, opt-in, so every route is
 * `entitled:`): assign a WhatsApp group to a student or teacher, choose when reminders go out, and
 * see whether they are arriving. Delivery itself is {@see GroupAlerts}, on the scheduler.
 *
 * Assigning is `student.update` / `teacher.update`, the same people who edit that record — so a
 * supervisor can do it without reaching the academy's settings. The timing is `settings.manage`.
 *
 * A group is checked against the connected number when it is assigned: one the number has left, or
 * where only admins may post, would otherwise swallow every reminder without a word.
 */
final class LessonReminderController extends Controller
{
    private const TS = 'Y-m-d\TH:i:s.uP';

    /** The number's group list is a heavy call to WhatsApp; a picker opened on every row must not repeat it. */
    private const GROUPS_CACHE_SECONDS = 60;

    public function __construct(
        private readonly WasenderClient $client,
        private readonly WhatsAppSender $sender,
        private readonly GroupAlerts $alerts,
        private readonly LessonGroupReminders $reminders,
        private readonly WhatsAppConnection $connection,
    ) {}

    /** GET /api/lesson-reminders — timing, the number's state, and how the last day went. */
    public function show(): JsonResponse
    {
        $ctx = $this->context();
        abort_unless($ctx->can('settings.manage') || $this->mayAssign($ctx), 403);
        $academyId = (string) $ctx->academyId;

        $connection = $this->connection->status($ctx);
        $token = $this->sender->tokenFor($academyId);
        $probe = $token !== null ? $this->client->status($token) : null;
        $settings = $this->reminders->settings($academyId);

        $counts = DB::table('whatsapp_group_alerts')
            ->where('academy_id', $academyId)
            ->whereIn('event_type', GroupAlertCatalog::LESSON_REMINDERS)
            ->where('due_at', '>=', CarbonImmutable::now()->subDay()->format(self::TS))
            ->groupBy('status')
            ->selectRaw('status, count(*) as n')
            ->pluck('n', 'status');
        $sum = fn (string ...$statuses): int => (int) collect($statuses)->sum(fn (string $s) => (int) ($counts[$s] ?? 0));

        return response()->json([
            'settings' => $settings,
            'lead_choices' => LessonGroupReminders::LEAD_CHOICES,
            'timezone' => (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?? 'UTC'),
            'whatsapp' => ['state' => $connection['state'], 'phone' => $connection['phone']],
            'capacity' => $probe === null || $probe['daily_cap'] === null ? null : [
                'sent_today' => (int) $probe['sent_today'],
                'daily_cap' => $probe['daily_cap'],
                'expected_next_day' => $this->expectedNextDay($academyId, $settings),
            ],
            'assigned' => [
                'students' => $this->tally('students'),
                'teachers' => $this->tally('teachers'),
            ],
            'last_day' => [
                'sent' => $sum('SENT', 'DELIVERED'),
                'waiting' => $sum('PENDING', 'SENDING', 'QUEUED'),
                'failed' => $sum('FAILED'),
                'missed' => $sum('EXPIRED'),
            ],
        ]);
    }

    /** PUT /api/lesson-reminders/settings — when reminders go out, and in which language. */
    public function updateSettings(Request $request): JsonResponse
    {
        Gate::authorize('settings.manage');
        $ctx = $this->context();
        $academyId = (string) $ctx->academyId;

        $data = $request->validate([
            'lead_minutes' => ['required', 'integer', Rule::in(LessonGroupReminders::LEAD_CHOICES)],
            'at_start' => ['required', 'boolean'],
            'language' => ['required', Rule::in(['ar', 'en'])],
        ]);

        $now = CarbonImmutable::now()->format(self::TS);
        $fields = [
            'lesson_reminder_lead_minutes' => (int) $data['lead_minutes'],
            'lesson_reminder_at_start' => (bool) $data['at_start'],
            'lesson_reminder_language' => $data['language'],
            'updated_at' => $now,
        ];

        $updated = DB::table('academy_automation_settings')->where('academy_id', $academyId)->update($fields);
        if ($updated === 0) {
            DB::table('academy_automation_settings')->insert($fields + ['academy_id' => $academyId]);
        }

        // A message is written in its group's language. A group a Super Admin linked for staff alerts
        // keeps the language chosen there.
        DB::table('whatsapp_groups')->where('academy_id', $academyId)->where('kind', 'LESSON')
            ->update(['language' => $data['language'], 'updated_at' => $now]);

        Audit::log('lesson_reminders.settings', 'academy', $academyId, $academyId, $ctx->userId, $ctx->role, after: $data);

        return response()->json(['settings' => $this->reminders->settings($academyId)]);
    }

    /** GET /api/lesson-reminders/groups — the groups the connected number is in, for the picker. */
    public function groups(Request $request): JsonResponse
    {
        $ctx = $this->context();
        abort_unless($this->mayAssign($ctx), 403);
        $academyId = (string) $ctx->academyId;

        $listing = $this->listing($academyId, $request->boolean('refresh'));
        if ($listing instanceof JsonResponse) {
            return $listing;
        }

        $assigned = collect(DB::select(<<<'SQL'
            select g.jid,
                   (select count(*) from students s where s.whatsapp_group_id = g.id and s.deleted_at is null) as students,
                   (select count(*) from teachers t where t.whatsapp_group_id = g.id and t.deleted_at is null) as teachers
              from whatsapp_groups g
             where g.academy_id = ?
        SQL, [$academyId]))->keyBy('jid');

        return response()->json([
            'groups' => array_map(fn (array $g): array => [
                'jid' => $g['id'],
                'name' => $g['subject'] !== '' ? $g['subject'] : $g['id'],
                'size' => $g['size'],
                'can_send' => $g['can_send'],
                'assigned_students' => (int) ($assigned[$g['id']]->students ?? 0),
                'assigned_teachers' => (int) ($assigned[$g['id']]->teachers ?? 0),
            ], $listing),
        ]);
    }

    /** GET /api/lesson-reminders/assignments?kind=student|teacher — who has which group. */
    public function assignments(Request $request): JsonResponse
    {
        $ctx = $this->context();
        $kind = $request->validate(['kind' => ['required', Rule::in(['student', 'teacher'])]])['kind'];
        // A teacher reads students row by row, so listing them all takes the power to edit them.
        abort_unless($ctx->can($kind === 'student' ? 'student.update' : 'teacher.read'), 403);

        $query = DB::table($kind === 'student' ? 'students as p' : 'teachers as p')
            ->leftJoin('whatsapp_groups as g', 'g.id', '=', 'p.whatsapp_group_id')
            ->whereNull('p.deleted_at')
            ->select(['p.id', 'p.full_name', 'g.id as group_id', 'g.jid as group_jid', 'g.name as group_name']);

        $result = DataTable::paginate($query, $request, [
            'idColumn' => 'p.id',
            'searchable' => ['p.full_name', 'g.name'],
            'sortable' => ['name' => 'p.full_name'],
            'filters' => [
                'assigned' => fn (Builder $q, $value) => $value === 'yes'
                    ? $q->whereNotNull('p.whatsapp_group_id')
                    : $q->whereNull('p.whatsapp_group_id'),
            ],
            'defaultSort' => 'name',
            'defaultPageSize' => 30,
        ]);

        $last = $this->lastDeliveries($result['rows']->pluck('group_id')->filter()->unique()->values()->all());

        return response()->json([
            ...$result,
            'rows' => $result['rows']->map(fn (object $row): array => $this->presentPerson($row, $last))->values(),
        ]);
    }

    /** GET /api/lesson-reminders/assignments/{kind}/{id} — one person, for their profile. */
    public function person(string $kind, string $id): JsonResponse
    {
        $ctx = $this->context();
        abort_unless($ctx->can($kind === 'student' ? 'student.update' : 'teacher.update'), 403);

        return response()->json(['person' => $this->loadPerson($kind, $id)]);
    }

    /** PUT /api/lesson-reminders/assignments/{kind}/{id} — assign a group; a null jid clears it. */
    public function assign(Request $request, string $kind, string $id): JsonResponse
    {
        Gate::authorize($kind === 'student' ? 'student.update' : 'teacher.update');
        $ctx = $this->context();
        $academyId = (string) $ctx->academyId;

        $data = $request->validate([
            'jid' => ['present', 'nullable', 'string', 'max:100', 'regex:/^[0-9-]+@g\.us$/'],
        ]);
        $jid = $data['jid'];

        $table = $kind === 'student' ? 'students' : 'teachers';
        $person = DB::table($table)->where('id', $id)->whereNull('deleted_at')->first(['id', 'whatsapp_group_id']);
        if ($person === null) {
            abort(404, 'Not found.');
        }

        $groupId = null;
        if ($jid !== null) {
            $checked = $this->checkedGroup($academyId, $jid);
            if ($checked instanceof JsonResponse) {
                return $checked;
            }
            $groupId = $this->groupRow($academyId, $jid, $checked['subject'], $ctx);
        }

        if ($groupId !== ($person->whatsapp_group_id !== null ? (string) $person->whatsapp_group_id : null)) {
            DB::table($table)->where('id', $id)->update([
                'whatsapp_group_id' => $groupId,
                'updated_at' => CarbonImmutable::now()->format(self::TS),
            ]);
            Audit::log('lesson_reminders.group_assigned', $kind, $id, $academyId, $ctx->userId, $ctx->role,
                after: ['group_id' => $groupId], before: ['group_id' => $person->whatsapp_group_id]);
        }

        return response()->json(['person' => $this->loadPerson($kind, $id)]);
    }

    /** POST /api/lesson-reminders/groups/{groupId}/test — prove a group really receives messages. */
    public function test(string $groupId): JsonResponse
    {
        $ctx = $this->context();
        abort_unless($this->mayAssign($ctx), 403);
        $academyId = (string) $ctx->academyId;

        if (DB::table('whatsapp_groups')->where('academy_id', $academyId)->where('id', $groupId)->doesntExist()) {
            abort(404, 'Group not found.');
        }

        $result = $this->alerts->sendTest($academyId, $groupId, null, CarbonImmutable::now(), lessonReminders: true);

        if ($result['error'] === 'not_connected') {
            return response()->json(['error' => 'not_connected', 'message' => 'WhatsApp is not connected.'], 409);
        }
        if (! $result['ok']) {
            // Never a 502: Cloudflare swaps those for its own page, which the browser reports as CORS.
            return response()->json(['error' => (string) $result['error'], 'message' => 'The WhatsApp service did not accept the message.'], 503);
        }

        return response()->json(['ok' => true]);
    }

    /** GET /api/lesson-reminders/log — the latest reminders; `problems=1` keeps the ones that did not arrive. */
    public function log(Request $request): JsonResponse
    {
        $ctx = $this->context();
        abort_unless($ctx->can('settings.manage') || $this->mayAssign($ctx), 403);

        $rows = DB::table('whatsapp_group_alerts as a')
            ->join('whatsapp_groups as g', 'g.id', '=', 'a.group_id')
            ->where('a.academy_id', $ctx->academyId)
            ->whereIn('a.event_type', GroupAlertCatalog::LESSON_REMINDERS)
            ->when($request->boolean('problems'), fn ($q) => $q->whereIn('a.status', ['FAILED', 'EXPIRED']), fn ($q) => $q->where('a.status', '<>', 'SKIPPED'))
            ->orderByDesc('a.due_at')
            ->limit(max(1, min(100, (int) $request->query('limit', 50))))
            ->get(['a.id', 'a.event_type', 'a.status', 'a.error', 'a.payload', 'a.due_at', 'a.sent_at', 'a.delivered_at', 'g.name as group_name']);

        return response()->json([
            'rows' => $rows->map(fn (object $a): array => [
                'id' => (string) $a->id,
                'event_type' => (string) $a->event_type,
                'status' => (string) $a->status,
                'error' => $a->error,
                'group_name' => (string) $a->group_name,
                'lesson' => json_decode((string) $a->payload, true) ?: (object) [],
                'due_at' => $this->iso($a->due_at),
                'sent_at' => $this->iso($a->sent_at),
                'delivered_at' => $this->iso($a->delivered_at),
            ])->values(),
        ]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /**
     * The number's groups, or the response that explains why they cannot be read.
     *
     * @return list<array{id: string, subject: string, size: int, announce: bool, is_admin: bool, can_send: bool}>|JsonResponse
     */
    private function listing(string $academyId, bool $refresh = false): array|JsonResponse
    {
        $key = "whatsapp-groups:{$academyId}";
        if (! $refresh && is_array($cached = Cache::get($key))) {
            return $cached;
        }

        $token = $this->sender->tokenFor($academyId);
        if ($token === null) {
            return response()->json(['error' => 'not_connected', 'message' => 'Connect your WhatsApp number first.'], 409);
        }

        $res = $this->client->listGroups($token);
        if (! $res['ok']) {
            // 401 = the gateway no longer knows the token: as good as not connected.
            $error = (string) $res['error'];
            $notConnected = str_starts_with($error, 'http_409') || str_starts_with($error, 'http_401');

            return response()->json([
                'error' => $notConnected ? 'not_connected' : 'gateway_unavailable',
                'message' => $notConnected ? 'Connect your WhatsApp number first.' : 'Could not reach the WhatsApp service. Please retry.',
            ], $notConnected ? 409 : 503);
        }

        Cache::put($key, $res['groups'], self::GROUPS_CACHE_SECONDS);

        return $res['groups'];
    }

    /**
     * A group the number can actually post in, or the response saying why not. A miss on the cached
     * list reads it fresh: the number may have been added to the group a moment ago.
     *
     * @return array{id: string, subject: string, size: int, announce: bool, is_admin: bool, can_send: bool}|JsonResponse
     */
    private function checkedGroup(string $academyId, string $jid): array|JsonResponse
    {
        $listing = $this->listing($academyId);
        if ($listing instanceof JsonResponse) {
            return $listing;
        }

        $match = collect($listing)->firstWhere('id', $jid);
        if ($match === null) {
            $listing = $this->listing($academyId, refresh: true);
            if ($listing instanceof JsonResponse) {
                return $listing;
            }
            $match = collect($listing)->firstWhere('id', $jid);
        }

        if ($match === null) {
            return response()->json([
                'error' => 'not_a_member',
                'message' => 'The connected WhatsApp number is not a member of that group.',
            ], 422);
        }
        if (! $match['can_send']) {
            return response()->json([
                'error' => 'admins_only',
                'message' => 'Only admins can post in that group. Make the connected number a group admin.',
            ], 422);
        }

        return $match;
    }

    /** The row for this WhatsApp group: one per group, whatever it is used for. */
    private function groupRow(string $academyId, string $jid, string $subject, AuthContext $ctx): string
    {
        $now = CarbonImmutable::now()->format(self::TS);
        $name = $subject !== '' ? $subject : $jid;

        DB::table('whatsapp_groups')->insertOrIgnore([
            'id' => (string) Str::uuid(),
            'academy_id' => $academyId,
            'jid' => $jid,
            'name' => $name,
            'language' => $this->reminders->settings($academyId)['language'],
            'kind' => 'LESSON',
            'created_by' => $ctx->userId,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $row = DB::table('whatsapp_groups')->where('academy_id', $academyId)->where('jid', $jid)->first(['id', 'name']);
        if ((string) $row->name !== $name) {
            DB::table('whatsapp_groups')->where('id', $row->id)->update(['name' => $name, 'updated_at' => $now]);
        }

        return (string) $row->id;
    }

    /** @return array<string,mixed> */
    private function loadPerson(string $kind, string $id): array
    {
        $row = DB::table($kind === 'student' ? 'students as p' : 'teachers as p')
            ->leftJoin('whatsapp_groups as g', 'g.id', '=', 'p.whatsapp_group_id')
            ->where('p.id', $id)
            ->whereNull('p.deleted_at')
            ->first(['p.id', 'p.full_name', 'g.id as group_id', 'g.jid as group_jid', 'g.name as group_name']);
        if ($row === null) {
            abort(404, 'Not found.');
        }

        return $this->presentPerson($row, $this->lastDeliveries(array_filter([$row->group_id])));
    }

    /**
     * @param  array<string, object>  $last
     * @return array<string,mixed>
     */
    private function presentPerson(object $row, array $last): array
    {
        $delivery = $row->group_id !== null ? ($last[(string) $row->group_id] ?? null) : null;

        return [
            'id' => (string) $row->id,
            'name' => (string) $row->full_name,
            'group' => $row->group_id === null ? null : [
                'id' => (string) $row->group_id,
                'jid' => (string) $row->group_jid,
                'name' => (string) $row->group_name,
                'last_status' => $delivery?->status,
                'last_error' => $delivery?->error,
                'last_at' => $delivery !== null ? $this->iso($delivery->updated_at) : null,
            ],
        ];
    }

    /**
     * The most recent message that settled, per group — "is this group actually receiving them?".
     *
     * @param  list<mixed>  $groupIds
     * @return array<string, object>
     */
    private function lastDeliveries(array $groupIds): array
    {
        if ($groupIds === []) {
            return [];
        }

        return DB::table('whatsapp_group_alerts')
            ->whereIn('group_id', $groupIds)
            ->whereIn('event_type', [...GroupAlertCatalog::LESSON_REMINDERS, GroupAlertCatalog::TEST])
            ->whereIn('status', ['SENT', 'DELIVERED', 'FAILED', 'EXPIRED'])
            ->orderBy('group_id')
            ->orderByDesc('updated_at')
            ->select(DB::raw('distinct on (group_id) group_id, status, error, updated_at'))
            ->get()
            ->keyBy(fn (object $r) => (string) $r->group_id)
            ->all();
    }

    /**
     * Roughly how many reminders the next 24 hours will take: every private lesson, once per distinct
     * group it reaches, per stage switched on. So the screen can warn before the number's daily cap
     * is hit, not after.
     *
     * @param  array{lead_minutes: int, at_start: bool, language: string}  $settings
     */
    private function expectedNextDay(string $academyId, array $settings): int
    {
        $now = CarbonImmutable::now();
        $row = DB::selectOne(<<<'SQL'
            select count(*) as n
              from sessions se
              join students st on st.id = se.student_id and st.deleted_at is null
              left join teachers te on te.id = se.teacher_id and te.deleted_at is null
             cross join lateral (
               select distinct g from unnest(array[st.whatsapp_group_id, te.whatsapp_group_id]) as g where g is not null
             ) target
             where se.academy_id = ?
               and se.status = 'SCHEDULED'
               and se.hidden_at is null
               and se.scheduled_at_utc >= ?::timestamptz
               and se.scheduled_at_utc < ?::timestamptz
        SQL, [$academyId, $now->format(self::TS), $now->addDay()->format(self::TS)]);

        return (int) $row->n * (($settings['lead_minutes'] > 0 ? 1 : 0) + ($settings['at_start'] ? 1 : 0));
    }

    /** @return array{assigned: int, total: int} */
    private function tally(string $table): array
    {
        $row = DB::table($table)->whereNull('deleted_at')
            ->selectRaw('count(*) as total, count(whatsapp_group_id) as assigned')
            ->first();

        return ['assigned' => (int) $row->assigned, 'total' => (int) $row->total];
    }

    private function mayAssign(AuthContext $ctx): bool
    {
        return $ctx->can('student.update') || $ctx->can('teacher.update');
    }

    private function iso(mixed $value): ?string
    {
        return $value !== null ? CarbonImmutable::parse((string) $value)->toIso8601String() : null;
    }

    private function context(): AuthContext
    {
        $ctx = app(AuthContext::class);
        if ($ctx->academyId === null) {
            abort(403, 'Enter an academy to manage its lesson reminders.');
        }

        return $ctx;
    }
}
