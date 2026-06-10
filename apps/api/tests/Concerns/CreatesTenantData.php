<?php

declare(strict_types=1);

namespace Tests\Concerns;

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

    protected function createAcademy(?string $id = null, ?string $typeId = null, array $overrides = []): string
    {
        $id ??= (string) Str::uuid();
        $typeId ??= $this->createAcademyType();
        $this->asSuperAdmin();
        DB::table('academies')->insert(array_merge([
            'id' => $id,
            'name' => 'Academy '.substr($id, 0, 8),
            'academy_type_id' => $typeId,
            'status' => 'ACTIVE',
            'default_currency' => 'EGP',
            'timezone' => 'Africa/Cairo',
            'invoice_grouping' => 'PER_GUARDIAN',
        ], $overrides));

        return $id;
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
