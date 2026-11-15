<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\ClientTools;
use App\Support\Entitlement;
use App\Support\Tenancy;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Super Admin → client page → Maintenance (2026-11-15): the repair commands, for this one client,
 * without an SSH session. Look first (the command's own listing), then apply.
 *
 *   GET  /admin/clients/{id}/tools          which tools this client is offered
 *   POST /admin/clients/{id}/tools/{tool}   run one — `apply: false` only lists
 *
 * Platform-scoped (`platform.manage`). Every APPLY is audited under the admin who pressed it; the
 * commands write their own per-record audit rows as they always did.
 */
final class ClientToolController extends Controller
{
    /** GET /api/admin/clients/{id}/tools */
    public function index(string $id): JsonResponse
    {
        Gate::authorize('platform.manage');
        $academy = $this->academy($id);

        return response()->json([
            'tools' => ClientTools::for($this->isCentre($id)),
            // The commands only ever act on an ACTIVE client; say so instead of running to no effect.
            'runnable' => $academy->status === 'ACTIVE',
        ]);
    }

    /** POST /api/admin/clients/{id}/tools/{tool} */
    public function run(Request $request, string $id, string $tool): JsonResponse
    {
        Gate::authorize('platform.manage');
        $academy = $this->academy($id);

        $definition = ClientTools::TOOLS[$tool] ?? null;
        abort_if($definition === null, 404, 'No such tool.');
        abort_if($definition['centre'] && ! $this->isCentre($id), 404, 'That tool is not offered to this client.');
        abort_if($academy->status !== 'ACTIVE', 409, 'Maintenance tools only run on an active client.');

        $apply = $request->boolean('apply');
        // A tool with nothing to preview has only one thing it can do; asking it to "only list"
        // would run it for real, so it is refused rather than quietly applied.
        abort_if(! $definition['preview'] && ! $apply, 422, 'This tool has no preview: it can only be run.');

        $ctx = app(AuthContext::class);
        $result = ClientTools::run($tool, $id, $apply, $ctx);

        if ($apply) {
            Audit::log('client.tool_run', 'academy', $id, $id, $ctx->userId, 'SUPER_ADMIN', after: [
                'tool' => $tool,
                'command' => $definition['command'],
                'exit_code' => $result['exit_code'],
            ]);
        }

        return response()->json([
            'ok' => $result['exit_code'] === 0,
            'applied' => $apply,
            'output' => $result['output'],
        ]);
    }

    private function academy(string $id): object
    {
        // `academies` admits a Super Admin to every row: always ask for THIS one by id.
        $academy = DB::table('academies')->where('id', $id)->first(['id', 'status']);
        abort_if($academy === null, 404, 'Client not found.');

        return $academy;
    }

    /** Asked inside the client's own context: its modules are tenant rows. */
    private function isCentre(string $id): bool
    {
        $ctx = app(AuthContext::class);
        $target = new AuthContext(userId: $ctx->userId, academyId: $id, role: 'SUPER_ADMIN', permissions: $ctx->permissions);

        try {
            return (bool) Tenancy::withContext($target, fn () => Entitlement::hasCapability($id, 'centre'));
        } finally {
            TenantContext::apply($ctx->userId, $ctx->academyId, $ctx->role, local: true);
        }
    }
}
