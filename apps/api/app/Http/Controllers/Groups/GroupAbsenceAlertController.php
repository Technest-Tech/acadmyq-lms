<?php

declare(strict_types=1);

namespace App\Http\Controllers\Groups;

use App\Http\Controllers\Controller;
use App\Services\Whatsapp\GroupAbsenceAlert;
use App\Support\Audit;
use App\Support\AuthContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

/**
 * Settings → WhatsApp → "تنبيه الغياب لولي الأمر" (a centre's, `entitled:centre` + `entitled:groups`):
 * the switch that lets {@see GroupAbsenceAlert} message a family when their child is marked absent
 * on a group sheet, and the wording it sends. `settings.manage` — the academy's own settings.
 *
 * The wording is the centre's to edit; an empty message means "follow the platform default", which
 * the screen shows so nobody writes one blind.
 */
final class GroupAbsenceAlertController extends Controller
{
    private const TS = 'Y-m-d\TH:i:s.uP';

    public function __construct(private readonly GroupAbsenceAlert $alert) {}

    /** GET /api/group-absence-alert — the switch, the wording and a rendered sample. */
    public function show(): JsonResponse
    {
        Gate::authorize('settings.manage');
        $academyId = $this->academyId();

        $settings = $this->alert->settings($academyId);

        return response()->json([
            ...$settings,
            'placeholders' => GroupAbsenceAlert::PLACEHOLDERS,
            'sample' => $this->alert->sample($academyId, $settings['message']),
        ]);
    }

    /** PUT /api/group-absence-alert — turn it on or off, and set the wording (null = default). */
    public function update(Request $request): JsonResponse
    {
        Gate::authorize('settings.manage');
        $academyId = $this->academyId();
        $ctx = app(AuthContext::class);

        $data = $request->validate([
            'enabled' => ['required', 'boolean'],
            'message' => ['present', 'nullable', 'string', 'max:2000'],
        ]);
        $message = trim((string) ($data['message'] ?? ''));

        $before = $this->alert->settings($academyId);
        $now = CarbonImmutable::now()->format(self::TS);
        $fields = [
            'group_absence_alert_enabled' => (bool) $data['enabled'],
            'group_absence_alert_message' => $message !== '' ? $message : null,
            'updated_at' => $now,
        ];

        $updated = DB::table('academy_automation_settings')->where('academy_id', $academyId)->update($fields);
        if ($updated === 0) {
            DB::table('academy_automation_settings')->insert($fields + ['id' => (string) Str::uuid(), 'academy_id' => $academyId, 'created_at' => $now]);
        }

        Audit::log('group_absence_alert.settings', 'academy', $academyId, $academyId, $ctx->userId, $ctx->role,
            after: ['enabled' => (bool) $data['enabled'], 'message' => $message !== '' ? $message : null],
            before: ['enabled' => $before['enabled'], 'message' => $before['message']]);

        return $this->show();
    }

    /** POST /api/group-absence-alert/preview — the message as a parent would read it. */
    public function preview(Request $request): JsonResponse
    {
        Gate::authorize('settings.manage');
        $data = $request->validate(['message' => ['present', 'nullable', 'string', 'max:2000']]);

        return response()->json(['sample' => $this->alert->sample($this->academyId(), $data['message'] ?? null)]);
    }

    private function academyId(): string
    {
        $academyId = app(AuthContext::class)->academyId;
        if ($academyId === null) {
            abort(403, 'Enter an academy to manage its absence alert.');
        }

        return $academyId;
    }
}
