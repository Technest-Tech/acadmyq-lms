<?php

declare(strict_types=1);

namespace Tests\Concerns;

use App\Support\FeatureCatalog;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Fixture helpers for RLS tests. Each helper sets exactly the context its write needs
 * (Super Admin for academies/catalog, the owning academy for tenant rows) so inserts
 * pass the policies' `with check`. After calling these, a test sets the *query* context
 * it wants to assert under (asAcademy / clearTenantContext). Requires InteractsWithTenancy.
 */
trait CreatesTenantData
{
    protected function createAcademyType(?string $code = null): string
    {
        $id = (string) Str::uuid();
        $this->asSuperAdmin();
        DB::table('academy_types')->insert([
            'id' => $id,
            'code' => $code ?? 'TYPE-'.substr($id, 0, 8),
            'name' => 'Test Type',
        ]);

        return $id;
    }

    /**
     * A client fixture. Since 05-MODULES-NOT-PACKAGES a client is a TYPE holding MODULES, so this
     * also provisions the type's primary module subscription — without it the academy would carry
     * no modules at all and every gated feature would 402, which is not what any test means by
     * "an academy". Pass `modules: []` for a deliberately module-less client.
     *
     * @param  array<string,mixed>  $overrides
     * @param  list<string>|null  $modules  extra modules to enable alongside the type's own
     */
    protected function createAcademy(?string $id = null, ?string $typeId = null, array $overrides = [], ?array $modules = null): string
    {
        $id ??= (string) Str::uuid();
        $typeId ??= $this->createAcademyType();
        $this->asSuperAdmin();
        DB::table('academies')->insert(array_merge([
            'id' => $id,
            'name' => 'Academy '.substr($id, 0, 8),
            'academy_type_id' => $typeId,
            'client_type' => 'MANAGEMENT',
            'status' => 'ACTIVE',
            'default_currency' => 'EGP',
            'timezone' => 'Africa/Cairo',
            'invoice_grouping' => 'PER_GUARDIAN',
        ], $overrides));

        $type = (string) ($overrides['client_type'] ?? 'MANAGEMENT');
        $wanted = $modules ?? [FeatureCatalog::CLIENT_TYPE_PRIMARY[$type] ?? 'MANAGEMENT'];

        foreach ($wanted as $module) {
            $this->createModuleSubscription($id, $module, [
                'currency' => (string) ($overrides['default_currency'] ?? 'EGP'),
            ]);
        }

        return $id;
    }

    /** One live module subscription for a client (ACTIVE, unpriced, uncapped by default). */
    protected function createModuleSubscription(string $academyId, string $module, array $overrides = []): string
    {
        $subId = (string) Str::uuid();
        $this->asAcademy($academyId);
        DB::table('module_subscriptions')->insert(array_merge([
            'id' => $subId,
            'academy_id' => $academyId,
            'module' => $module,
            'status' => 'ACTIVE',
            'is_trial' => false,
            'activated_at' => now(),
            'billing_interval' => 'MONTHLY',
            'base_price_minor' => 0,
            'addons_price_minor' => 0,
            'total_cost_minor' => 0,
            'currency' => 'EGP',
        ], $overrides));
        $this->asSuperAdmin();

        return $subId;
    }

    protected function createGuardian(string $academyId, array $overrides = []): string
    {
        $id = (string) Str::uuid();
        $this->asAcademy($academyId);
        DB::table('guardians')->insert(array_merge([
            'id' => $id,
            'academy_id' => $academyId,
            'full_name' => 'Guardian '.substr($id, 0, 8),
            'whatsapp_phone' => '+200000000000',
            'currency' => 'EGP',
        ], $overrides));

        return $id;
    }

    protected function createStudent(string $academyId, ?string $guardianId = null, array $overrides = []): string
    {
        $guardianId ??= $this->createGuardian($academyId);
        $id = (string) Str::uuid();
        $this->asAcademy($academyId);
        DB::table('students')->insert(array_merge([
            'id' => $id,
            'academy_id' => $academyId,
            'guardian_id' => $guardianId,
            'full_name' => 'Student '.substr($id, 0, 8),
        ], $overrides));

        return $id;
    }

    protected function createTeacher(string $academyId, array $overrides = []): string
    {
        $id = (string) Str::uuid();
        $this->asAcademy($academyId);
        DB::table('teachers')->insert(array_merge([
            'id' => $id,
            'academy_id' => $academyId,
            'full_name' => 'Teacher '.substr($id, 0, 8),
            'session_rate_minor' => 5000,
            'currency' => 'EGP',
        ], $overrides));

        return $id;
    }

    protected function createSession(string $academyId, string $studentId, string $teacherId, array $overrides = []): string
    {
        $id = (string) Str::uuid();
        $this->asAcademy($academyId);
        DB::table('sessions')->insert(array_merge([
            'id' => $id,
            'academy_id' => $academyId,
            'student_id' => $studentId,
            'teacher_id' => $teacherId,
            'scheduled_at_utc' => '2026-05-01 15:00:00+00',
            'duration_minutes' => 30,
            'status' => 'ATTENDED',
        ], $overrides));

        return $id;
    }

    /**
     * @return array{0: string, 1: string} [invoiceId, publicToken]
     */
    protected function createInvoice(string $academyId, ?string $guardianId = null, array $overrides = []): array
    {
        $guardianId ??= $this->createGuardian($academyId);
        $id = (string) Str::uuid();
        $token = Str::random(40);
        $this->asAcademy($academyId);
        DB::table('invoices')->insert(array_merge([
            'id' => $id,
            'academy_id' => $academyId,
            'guardian_id' => $guardianId,
            'period_year' => 2026,
            'period_month' => 5,
            'status' => 'OPEN',
            'currency' => 'EGP',
            'public_token' => $token,
        ], $overrides));

        return [$id, $token];
    }
}
