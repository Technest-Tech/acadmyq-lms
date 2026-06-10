<?php

declare(strict_types=1);

namespace Tests\Concerns;

use Illuminate\Support\Facades\DB;

/**
 * Test-only stand-in for the production TenantContextMiddleware (Sprint 2).
 *
 * Sets the three RLS session GUCs *transaction-locally* (set_config(..., is_local =>
 * true)) so they live only for the current request/transaction. Under Pest's
 * RefreshDatabase every test body runs inside one transaction, and every query on the
 * default connection runs on that same connection — so a context set here is exactly
 * the context the subsequent queries are evaluated against. This is the harness the
 * sprint's risk note (§12) requires: GUCs set in the same tx as the query.
 *
 * Re-calling any setter simply overwrites the GUC within the same tx, so a single test
 * can act as Academy A, then B, then "no context", to prove isolation end to end.
 */
trait InteractsWithTenancy
{
    /** Set the full tenant context. Pass null to leave a value unset (→ NULL → fail closed). */
    protected function setTenantContext(?string $academyId, ?string $role = null, ?string $userId = null): void
    {
        DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId ?? '']);
        DB::statement("select set_config('app.current_role', ?, true)", [$role ?? '']);
        DB::statement("select set_config('app.current_user_id', ?, true)", [$userId ?? '']);
    }

    /** Operate inside a single academy as a normal (non-super-admin) role. */
    protected function asAcademy(string $academyId, string $role = 'ACADEMY_OWNER', ?string $userId = null): void
    {
        $this->setTenantContext($academyId, $role, $userId);
    }

    /** Super Admin who has NOT entered any academy: normal queries must see nothing. */
    protected function asSuperAdmin(?string $userId = null): void
    {
        $this->setTenantContext(null, 'SUPER_ADMIN', $userId);
    }

    /** Super Admin who has explicitly "entered" an academy (the audited cross-tenant path). */
    protected function enterAcademyAsSuperAdmin(string $academyId, ?string $userId = null): void
    {
        $this->setTenantContext($academyId, 'SUPER_ADMIN', $userId);
    }

    /** No tenant context at all — the fail-closed / public-page state. */
    protected function clearTenantContext(): void
    {
        $this->setTenantContext(null, null, null);
    }
}
