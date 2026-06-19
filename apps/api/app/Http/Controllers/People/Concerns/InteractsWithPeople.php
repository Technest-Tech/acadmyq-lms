<?php

declare(strict_types=1);

namespace App\Http\Controllers\People\Concerns;

use App\Support\AuthContext;
use App\Support\Entitlement;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

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
        return (string) (DB::table('academies')->where('id', $academyId)->value('default_currency') ?? 'EGP');
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

    /**
     * Enforce a plan-defined numeric cap at create time (Sprint 9 §4.3, AC-9.2). Counts the
     * academy's current active rows of $table and, if the plan caps it and the cap is reached,
     * throws a 422 carrying an `upgrade` payload + bilingual at-limit messaging — distinct from
     * a 403 (permission) and consistent with the create-flow's other validation failures.
     * A plan with no cap for $limitKey is unlimited (fail open), so uncapped academies are
     * never blocked (TC-9.2 PRO branch).
     *
     * @return never|void
     */
    protected function enforceLimit(string $academyId, string $table, string $limitKey, string $resource): void
    {
        $ctx = $this->ctx();
        $current = (int) DB::table($table)->where('academy_id', $academyId)->whereNull('deleted_at')->count();

        if (Entitlement::withinLimit($ctx, $limitKey, $current)) {
            return;
        }

        $cap = Entitlement::limit($ctx, $limitKey);
        $plan = Entitlement::resolve($academyId)['plan'];

        throw ValidationException::withMessages([
            $resource => [json_encode([
                'error' => 'plan_limit_reached',
                'resource' => $resource,
                'limit' => $cap,
                'current' => $current,
                'plan' => $plan,
                'message_en' => "You've reached your plan's limit of {$cap} {$resource}. Upgrade your plan to add more.",
                'message_ar' => "لقد وصلت إلى الحد الأقصى لباقتك وهو {$cap} {$resource}. قم بترقية باقتك لإضافة المزيد.",
            ])],
        ]);
    }
}
