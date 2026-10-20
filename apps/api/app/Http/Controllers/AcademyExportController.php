<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\AcademyExport;
use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;

/**
 * Settings → Export data: the academy's records as sheets (see {@see AcademyExport}). The web asks
 * for the list with row counts, then each chosen sheet, and builds one styled workbook.
 *
 * Admins only (ACADEMY_OWNER, or a Super Admin who entered the academy): the export carries
 * every phone number, salary and invoice the academy holds, which is more than any delegated
 * role — even one handed settings.manage — is meant to walk away with.
 */
final class AcademyExportController extends Controller
{
    /** GET /api/academy/export — the sheets on offer and how many rows each holds. */
    public function index(): JsonResponse
    {
        $academyId = $this->authorizeAdmin();

        return response()->json(['datasets' => AcademyExport::forAcademy($academyId)->counts()]);
    }

    /** GET /api/academy/export/{dataset} — one sheet: title, columns, rows. */
    public function show(string $dataset): JsonResponse
    {
        if (! in_array($dataset, AcademyExport::DATASETS, true)) {
            abort(404, 'Unknown dataset.');
        }
        $academyId = $this->authorizeAdmin();

        $sheet = AcademyExport::forAcademy($academyId)->sheet($dataset);

        $ctx = app(AuthContext::class);
        Audit::log('academy.data_exported', 'academy', $academyId, $academyId, $ctx->userId, $ctx->role,
            after: ['dataset' => $dataset, 'rows' => count($sheet['rows'])]);

        return response()->json($sheet);
    }

    private function authorizeAdmin(): string
    {
        $ctx = app(AuthContext::class);
        if ($ctx->academyId === null) {
            abort(403, 'Enter an academy to export its data.');
        }
        if (! in_array($ctx->role, ['ACADEMY_OWNER', 'SUPER_ADMIN'], true)) {
            abort(403, 'Only the academy admins can export its data.');
        }

        return $ctx->academyId;
    }
}
