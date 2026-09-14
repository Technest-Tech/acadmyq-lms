<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\Whatsapp\GroupAlertCatalog;
use App\Services\Whatsapp\GroupAlerts;
use App\Services\Whatsapp\WasenderClient;
use App\Services\Whatsapp\WhatsAppSender;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Tenancy;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Super Admin: a client's WhatsApp staff groups and the alerts each receives (gate `automation.manage`).
 *
 * A group can only be linked while the client's number is connected AND is a member that may post
 * there — the gateway is asked at link time, so a group that would silently swallow our messages
 * (an admins-only group, a group the number left) is refused up front rather than discovered when the
 * first alert goes nowhere.
 */
final class WhatsAppGroupController extends Controller
{
    public function __construct(
        private readonly WasenderClient $client,
        private readonly WhatsAppSender $sender,
        private readonly GroupAlerts $alerts,
    ) {}

    /** GET /admin/academies/{id}/whatsapp/groups — linked groups, their recent alerts, and the catalog. */
    public function index(string $id): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);

        $groups = $this->inAcademyContext($id, function () use ($id): array {
            $rows = DB::table('whatsapp_groups')->where('academy_id', $id)->orderBy('created_at')->get();
            if ($rows->isEmpty()) {
                return [];
            }

            $recent = collect(DB::select(<<<'SQL'
                select * from (
                  select a.*, row_number() over (partition by a.group_id order by a.created_at desc) as rn
                    from whatsapp_group_alerts a
                   where a.academy_id = ?
                ) x
                where x.rn <= 10
                order by x.created_at desc
            SQL, [$id]))->groupBy('group_id');

            $counts = DB::table('whatsapp_group_alerts')
                ->where('academy_id', $id)
                ->where('created_at', '>=', CarbonImmutable::now()->subDay()->toIso8601String())
                ->groupBy('group_id', 'status')
                ->get(['group_id', 'status', DB::raw('count(*) as n')])
                ->groupBy('group_id');

            return $rows->map(fn (object $g): array => $this->presentGroup(
                $g,
                ($recent[(string) $g->id] ?? collect())->all(),
                ($counts[(string) $g->id] ?? collect())->mapWithKeys(fn (object $c) => [(string) $c->status => (int) $c->n])->all(),
            ))->all();
        });

        return response()->json([
            'groups' => $groups,
            'catalog' => [
                'categories' => GroupAlertCatalog::CATEGORIES,
                'default_settings' => GroupAlertCatalog::DEFAULT_SETTINGS,
                'setting_bounds' => GroupAlertCatalog::SETTING_BOUNDS,
                'max_attempts' => GroupAlerts::MAX_ATTEMPTS,
            ],
        ]);
    }

    /** GET /admin/academies/{id}/whatsapp/groups/available — the groups the linked number is in. */
    public function available(string $id): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);

        $listing = $this->listFromGateway($id);
        if ($listing instanceof JsonResponse) {
            return $listing;
        }

        $linked = $this->inAcademyContext($id, fn () => DB::table('whatsapp_groups')
            ->where('academy_id', $id)->pluck('jid')->map(fn ($j) => (string) $j)->all());

        return response()->json([
            'groups' => array_map(fn (array $g): array => $g + ['linked' => in_array($g['id'], $linked, true)], $listing),
        ]);
    }

    /** POST /admin/academies/{id}/whatsapp/groups — link a group and choose its alerts. */
    public function store(Request $request, string $id): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);

        $data = $request->validate([
            'jid' => ['required', 'string', 'max:100', 'regex:/^[0-9-]+@g\.us$/'],
            ...$this->editableRules(),
        ]);

        $listing = $this->listFromGateway($id);
        if ($listing instanceof JsonResponse) {
            return $listing;
        }

        $match = collect($listing)->firstWhere('id', $data['jid']);
        if ($match === null) {
            return response()->json([
                'error' => 'not_a_member',
                'message' => 'The connected WhatsApp number is not a member of that group. Add the number to the group, then try again.',
            ], 422);
        }
        if (! $match['can_send']) {
            return response()->json([
                'error' => 'admins_only',
                'message' => 'Only admins can post in that group. Make the connected number a group admin, or allow all members to send.',
            ], 422);
        }

        $ctx = app(AuthContext::class);
        $now = CarbonImmutable::now();
        $events = GroupAlertCatalog::normaliseEvents($data['events'] ?? []);

        $group = $this->inAcademyContext($id, function () use ($id, $data, $match, $events, $ctx, $now): ?object {
            if (DB::table('whatsapp_groups')->where('academy_id', $id)->where('jid', $data['jid'])->exists()) {
                return null;
            }

            $groupId = (string) Str::uuid();
            DB::table('whatsapp_groups')->insert([
                'id' => $groupId,
                'academy_id' => $id,
                'jid' => $data['jid'],
                'name' => $match['subject'] !== '' ? $match['subject'] : $data['jid'],
                'label' => $this->cleanLabel($data['label'] ?? null),
                'language' => $data['language'] ?? 'ar',
                'events' => json_encode($events),
                'event_since' => json_encode(array_fill_keys($events, $now->toIso8601String())),
                'settings' => json_encode(GroupAlertCatalog::settings($data['settings'] ?? null)),
                'is_active' => $data['is_active'] ?? true,
                'created_by' => $this->realUserId($ctx),
                'created_at' => $now->toIso8601String(),
                'updated_at' => $now->toIso8601String(),
            ]);

            Audit::log('whatsapp.group_linked', 'academy', $id, $id, $ctx->userId, 'SUPER_ADMIN', after: [
                'group_id' => $groupId, 'name' => $match['subject'], 'events' => $events,
            ]);

            return DB::table('whatsapp_groups')->where('id', $groupId)->first();
        });

        if ($group === null) {
            return response()->json(['error' => 'already_linked', 'message' => 'That group is already linked to this client.'], 422);
        }

        return response()->json(['group' => $this->presentGroup($group, [], [])], 201);
    }

    /** PUT /admin/academies/{id}/whatsapp/groups/{groupId} — change its label, alerts, timings, on/off. */
    public function update(Request $request, string $id, string $groupId): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);

        $data = $request->validate($this->editableRules());
        $ctx = app(AuthContext::class);
        $now = CarbonImmutable::now()->toIso8601String();

        $group = $this->inAcademyContext($id, function () use ($id, $groupId, $data, $ctx, $now): ?object {
            $row = DB::table('whatsapp_groups')->where('academy_id', $id)->where('id', $groupId)->first();
            if ($row === null) {
                return null;
            }

            $oldEvents = GroupAlertCatalog::decodeEvents($row->events);
            $since = json_decode((string) $row->event_since, true) ?: [];
            $fields = [];

            if (array_key_exists('label', $data)) {
                $fields['label'] = $this->cleanLabel($data['label']);
            }
            if (array_key_exists('language', $data)) {
                $fields['language'] = $data['language'];
            }
            if (array_key_exists('settings', $data)) {
                $current = GroupAlertCatalog::decodeSettings($row->settings);
                $fields['settings'] = json_encode(GroupAlertCatalog::settings(array_merge($current, (array) $data['settings'])));
            }

            $events = $oldEvents;
            if (array_key_exists('events', $data)) {
                $events = GroupAlertCatalog::normaliseEvents($data['events'] ?? []);
                // A newly ticked alert starts from now; an unticked one forgets its start.
                $since = array_intersect_key($since, array_flip($events));
                foreach (array_diff($events, $oldEvents) as $added) {
                    $since[$added] = $now;
                }
                $fields['events'] = json_encode($events);
            }

            if (array_key_exists('is_active', $data)) {
                $active = (bool) $data['is_active'];
                // Resuming a paused group reports what happens from now on, not what it missed.
                if ($active && ! $row->is_active) {
                    $since = array_fill_keys($events, $now);
                }
                $fields['is_active'] = $active;
            }

            $fields['event_since'] = json_encode((object) $since);

            DB::table('whatsapp_groups')->where('id', $groupId)->update($fields + ['updated_at' => $now]);

            // Alerts still waiting to go out for a group that was just paused, or for a type that was
            // just unticked, must not surface later as stale news when things are switched back on.
            $paused = array_key_exists('is_active', $data) && ! $data['is_active'];
            DB::table('whatsapp_group_alerts')
                ->where('group_id', $groupId)
                ->whereIn('status', ['PENDING', 'FAILED'])
                ->where('attempts', '<', GroupAlerts::MAX_ATTEMPTS)
                ->when(! $paused, fn ($q) => $q->whereNotIn('event_type', [...$events, GroupAlertCatalog::TEST]))
                ->update(['status' => 'SKIPPED', 'error' => 'alert_turned_off', 'updated_at' => $now]);
            Audit::log('whatsapp.group_updated', 'academy', $id, $id, $ctx->userId, 'SUPER_ADMIN', after: [
                'group_id' => $groupId, 'fields' => array_keys($data),
            ]);

            return DB::table('whatsapp_groups')->where('id', $groupId)->first();
        });

        if ($group === null) {
            abort(404, 'Group not found.');
        }

        return response()->json(['group' => $this->presentGroup($group, [], [])]);
    }

    /** DELETE /admin/academies/{id}/whatsapp/groups/{groupId} — unlink (its alert history goes with it). */
    public function destroy(string $id, string $groupId): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);
        $ctx = app(AuthContext::class);

        $deleted = $this->inAcademyContext($id, function () use ($id, $groupId, $ctx): int {
            $n = DB::table('whatsapp_groups')->where('academy_id', $id)->where('id', $groupId)->delete();
            if ($n > 0) {
                Audit::log('whatsapp.group_unlinked', 'academy', $id, $id, $ctx->userId, 'SUPER_ADMIN', after: ['group_id' => $groupId]);
            }

            return $n;
        });

        if ($deleted === 0) {
            abort(404, 'Group not found.');
        }

        return response()->json(['ok' => true]);
    }

    /** POST /admin/academies/{id}/whatsapp/groups/{groupId}/test — send a test into the group now. */
    public function test(string $id, string $groupId): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);
        $ctx = app(AuthContext::class);

        $res = $this->alerts->sendTest($id, $groupId, null, CarbonImmutable::now());

        if ($res['error'] === 'not_connected') {
            return response()->json(['error' => 'not_connected', 'message' => 'WhatsApp is not connected for this client.'], 409);
        }
        if ($res['error'] === 'group_inactive') {
            return response()->json(['error' => 'group_inactive', 'message' => 'Turn the group on before sending a test.'], 422);
        }

        $this->inAcademyContext($id, fn () => Audit::log('whatsapp.group_test', 'academy', $id, $id, $ctx->userId, 'SUPER_ADMIN', after: [
            'group_id' => $groupId, 'ok' => $res['ok'], 'error' => $res['error'],
        ]));

        return response()->json([
            'ok' => $res['ok'],
            'error' => $res['error'],
            'message' => $res['ok'] ? null : 'The WhatsApp service did not accept the test message ('.($res['error'] ?? 'send_failed').'). It will be retried automatically.',
            'alert' => $res['alert'] !== null ? $this->presentAlert($res['alert']) : null,
        ], $res['ok'] ? 200 : 502);
    }

    /** GET /admin/academies/{id}/whatsapp/groups/{groupId}/alerts — the group's recent alerts. */
    public function alerts(Request $request, string $id, string $groupId): JsonResponse
    {
        Gate::authorize('automation.manage');
        $this->assertAcademy($id);
        $limit = max(1, min(100, (int) $request->query('limit', 30)));

        $rows = $this->inAcademyContext($id, fn () => DB::table('whatsapp_group_alerts')
            ->where('academy_id', $id)
            ->where('group_id', $groupId)
            ->orderByDesc('created_at')
            ->limit($limit)
            ->get());

        return response()->json(['alerts' => $rows->map(fn (object $a): array => $this->presentAlert($a))->all()]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** @return array<string, list<mixed>> */
    private function editableRules(): array
    {
        return [
            'label' => ['sometimes', 'nullable', 'string', 'max:60'],
            'language' => ['sometimes', Rule::in(['ar', 'en'])],
            'events' => ['sometimes', 'array'],
            'events.*' => ['string', Rule::in(GroupAlertCatalog::selectable())],
            'settings' => ['sometimes', 'array'],
            'settings.not_marked_after_minutes' => ['sometimes', 'integer', 'min:1', 'max:240'],
            'settings.report_overdue_hours' => ['sometimes', 'integer', 'min:1', 'max:72'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    /**
     * The number's groups from the gateway, or the response that explains why they cannot be listed.
     *
     * @return list<array{id: string, subject: string, size: int, announce: bool, is_admin: bool, can_send: bool}>|JsonResponse
     */
    private function listFromGateway(string $academyId): array|JsonResponse
    {
        $token = $this->inAcademyContext($academyId, fn () => $this->sender->tokenFor($academyId));
        if ($token === null) {
            return response()->json(['error' => 'not_connected', 'message' => 'Connect this client\'s WhatsApp first.'], 409);
        }

        $res = $this->client->listGroups($token);
        if (! $res['ok']) {
            $notConnected = str_starts_with((string) $res['error'], 'http_409');

            return response()->json([
                'error' => $notConnected ? 'not_connected' : 'gateway_unavailable',
                'message' => $notConnected
                    ? 'WhatsApp is not connected for this client — reconnect it, then list the groups again.'
                    : 'Could not reach the WhatsApp service to list groups. Please retry.',
            ], $notConnected ? 409 : 502);
        }

        return $res['groups'];
    }

    /**
     * @param  list<object>  $recent
     * @param  array<string,int>  $counts
     * @return array<string,mixed>
     */
    private function presentGroup(object $g, array $recent, array $counts): array
    {
        return [
            'id' => (string) $g->id,
            'jid' => (string) $g->jid,
            'name' => (string) $g->name,
            'label' => $g->label,
            'language' => (string) $g->language,
            'events' => GroupAlertCatalog::decodeEvents($g->events),
            'settings' => GroupAlertCatalog::decodeSettings($g->settings),
            'is_active' => (bool) $g->is_active,
            'created_at' => $this->iso($g->created_at),
            'last_24h' => (object) $counts,
            'recent' => array_map(fn (object $a): array => $this->presentAlert($a), $recent),
        ];
    }

    /** @return array<string,mixed> */
    private function presentAlert(object $a): array
    {
        return [
            'id' => (string) $a->id,
            'group_id' => (string) $a->group_id,
            'event_type' => (string) $a->event_type,
            'status' => (string) $a->status,
            'attempts' => (int) $a->attempts,
            'error' => $a->error,
            'payload' => json_decode((string) $a->payload, true) ?: (object) [],
            'due_at' => $this->iso($a->due_at),
            'queued_at' => $this->iso($a->queued_at),
            'sent_at' => $this->iso($a->sent_at),
            'delivered_at' => $this->iso($a->delivered_at),
            'read_at' => $this->iso($a->read_at),
            'created_at' => $this->iso($a->created_at),
        ];
    }

    private function iso(mixed $value): ?string
    {
        return $value !== null ? CarbonImmutable::parse((string) $value)->toIso8601String() : null;
    }

    private function cleanLabel(mixed $label): ?string
    {
        $clean = trim((string) $label);

        return $clean !== '' ? $clean : null;
    }

    /** created_by FKs to users; the scheduler's sentinel id is not a row there. */
    private function realUserId(AuthContext $ctx): ?string
    {
        return $ctx->userId !== '' && $ctx->userId !== '00000000-0000-0000-0000-000000000000' ? $ctx->userId : null;
    }

    private function assertAcademy(string $id): void
    {
        if (! Str::isUuid($id) || DB::table('academies')->where('id', $id)->doesntExist()) {
            abort(404, 'Academy not found.');
        }
    }

    /**
     * @template T
     *
     * @param  callable():T  $fn
     * @return T
     */
    private function inAcademyContext(string $academyId, callable $fn): mixed
    {
        $ctx = app(AuthContext::class);

        return Tenancy::withContext(new AuthContext(
            userId: $ctx->userId,
            academyId: $academyId,
            role: 'SUPER_ADMIN',
            permissions: $ctx->permissions,
        ), $fn);
    }
}
