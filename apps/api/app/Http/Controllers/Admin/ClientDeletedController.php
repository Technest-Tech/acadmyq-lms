<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\ClientDeleted;
use App\Support\PreviewRolledBack;
use App\Support\Tenancy;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Super Admin → client page → Deleted (2026-11-17): everything this client deleted, and the way back.
 *
 *   GET  /admin/clients/{id}/deleted                          the recoverable items + the permanent-delete log
 *   POST /admin/clients/{id}/deleted/{kind}/{item}/restore    `apply: false` = what would come back (rolled back)
 *
 * A preview runs the very restore and rolls it back, so what it lists is what Apply will do.
 * Platform-scoped (`platform.manage`); an APPLY is audited under the admin as `client.restore`.
 */
final class ClientDeletedController extends Controller
{
    /** GET /api/admin/clients/{id}/deleted */
    public function index(string $id): JsonResponse
    {
        Gate::authorize('platform.manage');
        $this->academyOrFail($id);

        return response()->json($this->inClient($id, fn () => ClientDeleted::list($id)));
    }

    /** POST /api/admin/clients/{id}/deleted/{kind}/{item}/restore */
    public function restore(Request $request, string $id, string $kind, string $item): JsonResponse
    {
        Gate::authorize('platform.manage');
        $this->academyOrFail($id);
        abort_unless(array_key_exists($kind, ClientDeleted::KINDS), 404, 'Nothing of that kind can be restored.');

        $apply = $request->boolean('apply');
        $ctx = app(AuthContext::class);

        try {
            $report = $this->inClient($id, function () use ($kind, $id, $item, $apply, $ctx) {
                $report = ClientDeleted::restore($kind, $id, $item, $ctx->userId);
                if (! $apply) {
                    throw new PreviewRolledBack($report);
                }
                Audit::log('client.restore', 'academy', $id, $id, $ctx->userId, 'SUPER_ADMIN', after: ['kind' => $kind, 'item' => $item] + $report);

                return $report;
            });
        } catch (PreviewRolledBack $preview) {
            $report = $preview->report;
        }

        return response()->json(['applied' => $apply] + $report);
    }

    /** Inside the client's own tenant context, in one transaction; the caller's context comes back after. */
    private function inClient(string $academyId, callable $fn): mixed
    {
        $ctx = app(AuthContext::class);
        $target = new AuthContext(userId: $ctx->userId, academyId: $academyId, role: 'SUPER_ADMIN', permissions: $ctx->permissions);

        try {
            return Tenancy::withContext($target, $fn);
        } finally {
            TenantContext::apply($ctx->userId, $ctx->academyId, $ctx->role, local: true);
        }
    }

    private function academyOrFail(string $id): void
    {
        // `academies` admits a Super Admin to every row: always ask for THIS one by id.
        abort_unless(DB::table('academies')->where('id', $id)->exists(), 404, 'Client not found.');
    }
}
