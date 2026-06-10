<?php

declare(strict_types=1);

namespace App\Http\Controllers\People\Concerns;

use App\Support\AuthContext;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Shared helpers for the Sprint 4 people controllers (guardians/students/teachers). They all
 * operate inside the CURRENT request's tenant context (the Owner's academy, or the academy a
 * Super Admin has entered) — never cross-tenant — so unlike the Sprint 3 AcademyController
 * they need no Tenancy::withContext switch: the middleware's GUCs already point at the right
 * academy and RLS is the backstop on every write.
 */
trait InteractsWithPeople
{
    protected function ctx(): AuthContext
    {
        return app(AuthContext::class);
    }

    /** The academy this request is scoped to (Owner's home, or the entered academy). */
    protected function currentAcademyId(): string
    {
        $id = $this->ctx()->academyId;
        if ($id === null) {
            // People are always tenant-scoped; a contextless caller cannot manage them.
            abort(403, 'Enter an academy to manage its people.');
        }

        return $id;
    }

    /**
     * The academy's configured default currency (Sprint 3), used when a guardian/student/
     * subscription/teacher does not override it (R-INV-7, AC-4.6). Readable here because the
     * academies RLS select policy admits the caller's own academy row.
     */
    protected function academyDefaultCurrency(string $academyId): string
    {
        return (string) (DB::table('academies')->where('id', $academyId)->value('default_currency') ?? 'USD');
    }

    /**
     * Default list views hide soft-deleted (deactivated) people; `filter[status]=inactive`
     * shows only them and `=all` shows both (AC-4.7 / TC-4.5). A deactivated person stays in
     * the database — every historical reference remains intact — they are merely hidden.
     */
    protected function applyActiveScope(Builder $query, Request $request, string $column = 'deleted_at'): void
    {
        $status = (string) (((array) $request->query('filter', []))['status'] ?? 'active');

        match ($status) {
            'inactive' => $query->whereNotNull($column),
            'all' => null,
            default => $query->whereNull($column),
        };
    }
}
