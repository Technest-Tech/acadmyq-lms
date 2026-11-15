<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\FinanceLedger;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\ClientAttention;
use App\Support\SystemHealth;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Super Admin → System health (2026-11-15). Two questions the panel could not answer without SSH:
 *
 *   is the machine running?         GET /admin/system/health   (cron, queue, scheduled jobs, gateway)
 *   which clients need me, and why? GET /admin/system/attention
 *
 * plus the two things one does about a dead job: run it again, or dismiss it. Platform-scoped
 * (`platform.manage`); the cross-tenant read goes through the audited SECURITY DEFINER hatch
 * app.admin_client_health(), which re-asserts SUPER_ADMIN itself.
 */
final class SystemHealthController extends Controller
{
    /** GET /api/admin/system/health */
    public function health(SystemHealth $health): JsonResponse
    {
        Gate::authorize('platform.manage');

        return response()->json($health->snapshot());
    }

    /** GET /api/admin/system/attention — every client with something wrong, worst first. */
    public function attention(FinanceLedger $ledger): JsonResponse
    {
        Gate::authorize('platform.manage');

        $facts = json_decode((string) DB::selectOne('select app.admin_client_health() as h')->h, true);

        return response()->json(ClientAttention::inbox(
            is_array($facts) ? $facts : [],
            $ledger->summariesByAcademy(),
        ) + ['checked_at' => now()->utc()->toIso8601String()]);
    }

    /** POST /api/admin/system/failed-jobs/{uuid}/retry — put a dead job back on the queue. */
    public function retry(string $uuid): JsonResponse
    {
        Gate::authorize('platform.manage');
        $job = $this->failedJob($uuid);

        Artisan::call('queue:retry', ['id' => [$uuid]]);
        $this->audit('system.job_retried', $uuid, $job);

        return response()->json(['ok' => true]);
    }

    /** DELETE /api/admin/system/failed-jobs/{uuid} — dismiss a dead job without running it. */
    public function forget(string $uuid): JsonResponse
    {
        Gate::authorize('platform.manage');
        $job = $this->failedJob($uuid);

        Artisan::call('queue:forget', ['id' => $uuid]);
        $this->audit('system.job_dismissed', $uuid, $job);

        return response()->json(['ok' => true]);
    }

    private function failedJob(string $uuid): string
    {
        $row = DB::table('failed_jobs')->where('uuid', $uuid)->first(['payload']);
        abort_if($row === null, 404, 'That failed job no longer exists.');

        $payload = json_decode((string) $row->payload, true);

        return is_array($payload) ? (string) ($payload['displayName'] ?? '') : '';
    }

    private function audit(string $action, string $uuid, string $job): void
    {
        $ctx = app(AuthContext::class);
        Audit::log($action, 'platform', null, null, $ctx->userId, 'SUPER_ADMIN', after: ['uuid' => $uuid, 'job' => $job]);
    }
}
