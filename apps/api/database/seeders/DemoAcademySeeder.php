<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Support\PermissionCatalog;
use App\Support\TenantContext;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Demo Qur'an academy (§9). Repeatable: every row is keyed by a stable UUID/code so
 * re-running upserts in place (TC-1.31/1.32 — identical counts on a second run).
 *
 * The seeder inserts UNDER RLS to prove the policies admit legitimate writes: it sets a
 * SUPER_ADMIN context already "inside" the demo academy, which satisfies both the
 * super-admin-only platform/academies writes and the tenant `with check` on every
 * academy-scoped table (academy_id = current_academy_id()). Context is cleared at the end.
 */
class DemoAcademySeeder extends Seeder
{
    // Stable identifiers (idempotency keys).
    private const ACADEMY_ID = '0a000000-0000-7000-8000-000000000001';

    private const OWNER_USER_ID = '0a000000-0000-7000-8000-000000000010';

    private const TEACHER1_USER_ID = '0a000000-0000-7000-8000-000000000011';

    private const TEACHER2_USER_ID = '0a000000-0000-7000-8000-000000000012';

    private const TEACHER1_ID = '0a000000-0000-7000-8000-000000000021';

    private const TEACHER2_ID = '0a000000-0000-7000-8000-000000000022';

    private const GUARDIAN_ID = '0a000000-0000-7000-8000-000000000031';

    private const STUDENT1_ID = '0a000000-0000-7000-8000-000000000041';

    private const STUDENT2_ID = '0a000000-0000-7000-8000-000000000042';

    private const SUPER_ADMIN_USER_ID = '0a000000-0000-7000-8000-000000000001';

    public function run(): void
    {
        // Operate as a Super Admin already inside the demo academy (session scope — the
        // seeder is not wrapped in the request middleware's transaction).
        TenantContext::apply(
            userId: self::OWNER_USER_ID,
            academyId: self::ACADEMY_ID,
            role: 'SUPER_ADMIN',
            local: false,
        );

        try {
            $this->seedPlatformCatalog();
            $this->seedAcademy();
            $this->seedUsersAndPeople();
            $this->seedReportFields();
            $this->seedEnrollment();
            $this->seedScheduleAndSessions();
        } finally {
            TenantContext::clear();
        }
    }

    private function seedPlatformCatalog(): void
    {
        DB::table('academy_types')->updateOrInsert(
            ['code' => 'QURAN'],
            ['name' => "Qur'an", 'description' => "Qur'an memorization & tajweed"]
        );

        foreach ([
            ['code' => 'BASIC', 'name' => 'Basic', 'price_minor' => 0, 'features' => '{"max_students":50}'],
            ['code' => 'PRO', 'name' => 'Pro', 'price_minor' => 4900, 'features' => '{"max_students":1000,"payroll":true}'],
        ] as $plan) {
            DB::table('plans')->updateOrInsert(
                ['code' => $plan['code']],
                [
                    'name' => $plan['name'],
                    'price_minor' => $plan['price_minor'],
                    'currency' => 'USD',
                    'features' => $plan['features'],
                    'is_active' => true,
                ]
            );
        }

        // Full §5.3 capability catalog + §5.4 role mapping, sourced from PermissionCatalog
        // so the seed and any test that asserts the mapping share one definition.
        foreach (PermissionCatalog::PERMISSIONS as $code) {
            DB::table('permissions')->updateOrInsert(['code' => $code], ['description' => $code]);
        }

        $permIds = DB::table('permissions')->pluck('id', 'code');
        foreach (PermissionCatalog::roleMap() as $role => $codes) {
            foreach ($codes as $code) {
                DB::table('role_permissions')->updateOrInsert(
                    ['role' => $role, 'permission_id' => $permIds[$code]],
                    []
                );
            }
        }
    }

    private function seedAcademy(): void
    {
        $quranTypeId = DB::table('academy_types')->where('code', 'QURAN')->value('id');
        $proPlanId = DB::table('plans')->where('code', 'PRO')->value('id');

        DB::table('academies')->updateOrInsert(
            ['id' => self::ACADEMY_ID],
            [
                'name' => "Noor Al-Qur'an Academy",
                'academy_type_id' => $quranTypeId,
                'status' => 'ACTIVE',
                'plan_id' => $proPlanId,
                'default_currency' => 'EGP',
                'timezone' => 'Africa/Cairo',
                'invoice_grouping' => 'PER_GUARDIAN',
                'billing_day' => 1,
                'subdomain' => 'noor',
            ]
        );
    }

    private function seedUsersAndPeople(): void
    {
        $password = Hash::make('password');

        // Platform Super Admin — no home academy (academy_id NULL, §3.5).
        DB::table('users')->updateOrInsert(
            ['id' => self::SUPER_ADMIN_USER_ID],
            [
                'academy_id' => null,
                'full_name' => 'Platform Admin',
                'email' => 'admin@academiq.test',
                'password' => $password,
                'is_active' => true,
                'email_verified_at' => now(),
            ]
        );
        DB::table('user_roles')->updateOrInsert(
            ['user_id' => self::SUPER_ADMIN_USER_ID, 'academy_id' => null, 'role' => 'SUPER_ADMIN'],
            []
        );
        // No audit row for the platform-level (academy_id NULL) assignment: such rows are
        // unreadable under any tenant context (the select policy compares academy_id to a
        // non-NULL current_academy_id()), so the idempotency guard could never see them.

        DB::table('users')->updateOrInsert(
            ['id' => self::OWNER_USER_ID],
            [
                'academy_id' => self::ACADEMY_ID,
                'full_name' => 'Owner Noor',
                'email' => 'owner@noor.test',
                'password' => $password,
                'is_active' => true,
                'email_verified_at' => now(),
            ]
        );
        DB::table('user_roles')->updateOrInsert(
            ['user_id' => self::OWNER_USER_ID, 'academy_id' => self::ACADEMY_ID, 'role' => 'ACADEMY_OWNER'],
            []
        );
        $this->auditRoleAssigned(self::OWNER_USER_ID, self::ACADEMY_ID, 'ACADEMY_OWNER');

        $teachers = [
            [self::TEACHER1_USER_ID, self::TEACHER1_ID, 'Ustadh Ali', 'ali@noor.test'],
            [self::TEACHER2_USER_ID, self::TEACHER2_ID, 'Ustadha Fatima', 'fatima@noor.test'],
        ];
        foreach ($teachers as [$userId, $teacherId, $name, $email]) {
            DB::table('users')->updateOrInsert(
                ['id' => $userId],
                [
                    'academy_id' => self::ACADEMY_ID,
                    'full_name' => $name,
                    'email' => $email,
                    'password' => $password,
                    'is_active' => true,
                    'email_verified_at' => now(),
                ]
            );
            DB::table('user_roles')->updateOrInsert(
                ['user_id' => $userId, 'academy_id' => self::ACADEMY_ID, 'role' => 'TEACHER'],
                []
            );
            $this->auditRoleAssigned($userId, self::ACADEMY_ID, 'TEACHER');
            DB::table('teachers')->updateOrInsert(
                ['id' => $teacherId],
                [
                    'academy_id' => self::ACADEMY_ID,
                    'user_id' => $userId,
                    'full_name' => $name,
                    'specialization' => 'Hifz & Tajweed',
                    'session_rate_minor' => 5000, // 50.00 EGP / session
                    'currency' => 'EGP',
                    'is_active' => true,
                ]
            );
        }

        DB::table('guardians')->updateOrInsert(
            ['id' => self::GUARDIAN_ID],
            [
                'academy_id' => self::ACADEMY_ID,
                'full_name' => 'Mohamed',
                'whatsapp_phone' => '+201000000000',
                'country' => 'EG',
                'currency' => 'EGP',
            ]
        );

        $students = [
            [self::STUDENT1_ID, 'Yusuf'],
            [self::STUDENT2_ID, 'Maryam'],
        ];
        foreach ($students as [$studentId, $name]) {
            DB::table('students')->updateOrInsert(
                ['id' => $studentId],
                [
                    'academy_id' => self::ACADEMY_ID,
                    'guardian_id' => self::GUARDIAN_ID,
                    'full_name' => $name,
                    'status' => 'REGULAR',
                ]
            );
        }

        // Active teacher assignments (one per student) — keyed by student so re-runs
        // don't trip the one-active-assignment partial unique index.
        DB::table('student_teacher_assignments')->updateOrInsert(
            ['academy_id' => self::ACADEMY_ID, 'student_id' => self::STUDENT1_ID, 'ended_at' => null],
            ['teacher_id' => self::TEACHER1_ID]
        );
        DB::table('student_teacher_assignments')->updateOrInsert(
            ['academy_id' => self::ACADEMY_ID, 'student_id' => self::STUDENT2_ID, 'ended_at' => null],
            ['teacher_id' => self::TEACHER2_ID]
        );
    }

    /**
     * Append an idempotent `role.assigned` audit entry (R-AUD-1). Keyed on
     * (action, entity_id, after->role) so re-running the seeder does not duplicate it.
     */
    private function auditRoleAssigned(string $userId, ?string $academyId, string $role): void
    {
        $exists = DB::table('audit_log')
            ->where('action', 'role.assigned')
            ->where('entity_type', 'user_role')
            ->where('entity_id', $userId)
            ->where('after->role', $role)
            ->exists();

        if ($exists) {
            return;
        }

        DB::table('audit_log')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $academyId,
            'actor_user_id' => self::SUPER_ADMIN_USER_ID,
            'actor_role' => 'SUPER_ADMIN',
            'action' => 'role.assigned',
            'entity_type' => 'user_role',
            'entity_id' => $userId,
            'after' => json_encode(['role' => $role, 'academy_id' => $academyId]),
            'created_at' => now(),
        ]);
    }

    private function seedReportFields(): void
    {
        $fields = [
            ['surah_from', 'من سورة', 'Surah from', 'TEXT', null, 1, true],
            ['surah_to', 'إلى سورة', 'Surah to', 'TEXT', null, 2, true],
            ['tajweed_rating', 'تقييم التجويد', 'Tajweed rating', 'SELECT',
                '["excellent","good","needs_work"]', 3, false],
            ['next_assignment', 'الواجب القادم', 'Next assignment', 'TEXT', null, 4, false],
            ['notes', 'ملاحظات', 'Notes', 'TEXTAREA', null, 5, false],
        ];
        foreach ($fields as [$key, $ar, $en, $type, $options, $order, $required]) {
            DB::table('report_field_definitions')->updateOrInsert(
                ['academy_id' => self::ACADEMY_ID, 'key' => $key],
                [
                    'label_ar' => $ar,
                    'label_en' => $en,
                    'field_type' => $type,
                    'options' => $options,
                    'sort_order' => $order,
                    'is_required' => $required,
                    'is_active' => true,
                ]
            );
        }
    }

    private function seedEnrollment(): void
    {
        $subs = [
            [self::STUDENT1_ID, '8 sessions/month', 8, 80000], // 800.00 EGP
            [self::STUDENT2_ID, '4 sessions/month', 4, 40000],
        ];
        foreach ($subs as [$studentId, $label, $perMonth, $priceMinor]) {
            DB::table('subscriptions')->updateOrInsert(
                ['academy_id' => self::ACADEMY_ID, 'student_id' => $studentId, 'plan_label' => $label],
                [
                    'sessions_per_month' => $perMonth,
                    'price_minor' => $priceMinor,
                    'currency' => 'EGP',
                    'price_basis' => 'PER_MONTH',
                    'status' => 'ACTIVE',
                    'start_date' => '2026-01-01',
                ]
            );
        }
    }

    private function seedScheduleAndSessions(): void
    {
        // One weekly schedule per student (deterministic id derived from the student).
        $schedules = [
            ['0a000000-0000-7000-8000-000000000051', self::STUDENT1_ID, self::TEACHER1_ID, [1, 3]], // Mon, Wed
            ['0a000000-0000-7000-8000-000000000052', self::STUDENT2_ID, self::TEACHER2_ID, [6]],     // Sat
        ];
        foreach ($schedules as [$scheduleId, $studentId, $teacherId, $weekdays]) {
            DB::table('schedules')->updateOrInsert(
                ['id' => $scheduleId],
                [
                    'academy_id' => self::ACADEMY_ID,
                    'student_id' => $studentId,
                    'teacher_id' => $teacherId,
                    'timezone' => 'Africa/Cairo',
                    'is_active' => true,
                ]
            );
            foreach ($weekdays as $weekday) {
                DB::table('schedule_slots')->updateOrInsert(
                    ['schedule_id' => $scheduleId, 'weekday' => $weekday, 'start_time_local' => '17:00:00'],
                    ['academy_id' => self::ACADEMY_ID, 'duration_minutes' => 30]
                );
            }
        }

        // A handful of past sessions in varied statuses (so later sprints are demoable).
        $sessions = [
            ['0a000000-0000-7000-8000-000000000061', self::STUDENT1_ID, self::TEACHER1_ID, '2026-05-04 15:00:00+00', 'ATTENDED'],
            ['0a000000-0000-7000-8000-000000000062', self::STUDENT1_ID, self::TEACHER1_ID, '2026-05-06 15:00:00+00', 'ABSENT_UNEXCUSED'],
            ['0a000000-0000-7000-8000-000000000063', self::STUDENT2_ID, self::TEACHER2_ID, '2026-05-09 15:00:00+00', 'ATTENDED'],
            ['0a000000-0000-7000-8000-000000000064', self::STUDENT2_ID, self::TEACHER2_ID, '2026-05-16 15:00:00+00', 'CANCELLED_BY_STUDENT'],
        ];
        foreach ($sessions as [$sessionId, $studentId, $teacherId, $at, $status]) {
            DB::table('sessions')->updateOrInsert(
                ['id' => $sessionId],
                [
                    'academy_id' => self::ACADEMY_ID,
                    'student_id' => $studentId,
                    'teacher_id' => $teacherId,
                    'scheduled_at_utc' => $at,
                    'duration_minutes' => 30,
                    'status' => $status,
                ]
            );
        }
    }
}
