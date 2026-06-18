<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Super Admin platform settings + feature flags (admin panel — Phase 6), gated by
 * `platform.manage`. Both are platform-level catalog tables (no academy_id): the Gate is the
 * app-layer control and the catalog RLS policies (`is_super_admin()`) are the DB backstop, so
 * the two layers agree. A disabled feature flag is a kill-switch consulted by
 * App\Support\Entitlement::resolve — it removes a capability platform-wide. Every write is
 * audited at the platform scope (academy_id = null).
 */
final class SettingsController extends Controller
{
    /** GET /api/admin/feature-flags — the kill-switch catalog. */
    public function flags(): JsonResponse
    {
        Gate::authorize('platform.manage');

        return response()->json([
            'flags' => DB::table('feature_flags')
                ->orderBy('key')
                ->get(['id', 'key', 'description', 'enabled']),
        ]);
    }

    /** PATCH /api/admin/feature-flags/{key} — toggle / re-describe a flag (audited). */
    public function updateFlag(Request $request, string $key): JsonResponse
    {
        Gate::authorize('platform.manage');

        $flag = DB::table('feature_flags')->where('key', $key)->first();
        if ($flag === null) {
            abort(404, 'Feature flag not found.');
        }

        $data = $request->validate([
            'enabled' => ['sometimes', 'boolean'],
            'description' => ['sometimes', 'nullable', 'string', 'max:255'],
        ]);

        if ($data === []) {
            return response()->json(['ok' => true]);
        }

        DB::table('feature_flags')->where('key', $key)->update($data + ['updated_at' => now()]);

        $ctx = app(AuthContext::class);
        Audit::log('platform.feature_flag', 'feature_flag', $flag->id, null, $ctx->userId, $ctx->role,
            after: $data, before: ['enabled' => (bool) $flag->enabled]);

        return response()->json(['ok' => true]);
    }

    /** GET /api/admin/settings — every platform setting as a key/value map. */
    public function settings(): JsonResponse
    {
        Gate::authorize('platform.manage');

        $rows = DB::table('platform_settings')->get(['key', 'value']);
        $settings = [];
        foreach ($rows as $row) {
            $settings[$row->key] = json_decode($row->value, true);
        }

        return response()->json(['settings' => $settings]);
    }

    /** PATCH /api/admin/settings — upsert a batch of settings (audited). */
    public function updateSettings(Request $request): JsonResponse
    {
        Gate::authorize('platform.manage');

        $data = $request->validate([
            'settings' => ['required', 'array'],
        ]);

        $ctx = app(AuthContext::class);

        foreach ($data['settings'] as $key => $value) {
            DB::table('platform_settings')->updateOrInsert(
                ['key' => (string) $key],
                ['value' => json_encode($value), 'updated_at' => now()],
            );
        }

        Audit::log('platform.settings', 'platform_settings', null, null, $ctx->userId, $ctx->role,
            after: ['keys' => array_keys($data['settings'])]);

        return response()->json(['ok' => true]);
    }
}
