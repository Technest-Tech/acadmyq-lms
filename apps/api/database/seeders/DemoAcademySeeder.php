<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Services\AcademyBilling;
use App\Support\FeatureCatalog;
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
            $this->seedPaymentSettings();
            $this->seedFinanceDemo();
            // Sync the demo academy's subscription snapshot to its (PRO) plan price so a re-seed
            // after a plan-price change never leaves a stale total.
            app(AcademyBilling::class)->recomputeTotals(self::ACADEMY_ID);
        } finally {
            TenantContext::clear();
        }
    }

    /**
     * The Qur'an academy-type report-field template (Sprint 3 §5). Stored on the
     * `academy_types` row as data, then COPIED into a new academy's
     * `report_field_definitions` at provisioning — so adding a type is a catalog change with
     * no code touch to the report engine (R-CRF, TC-3.27/3.28). Shape mirrors what the
     * provisioning endpoint reads: [key, label_ar, label_en, field_type, options, is_required].
     *
     * @return list<array<string,mixed>>
     */
    public static function quranReportFieldTemplate(): array
    {
        return [
            ['key' => 'surah_from', 'label_ar' => 'من سورة / آية', 'label_en' => 'From surah / ayah', 'field_type' => 'TEXT', 'options' => null, 'is_required' => true],
            ['key' => 'surah_to', 'label_ar' => 'إلى سورة / آية', 'label_en' => 'To surah / ayah', 'field_type' => 'TEXT', 'options' => null, 'is_required' => true],
            ['key' => 'tajweed_rating', 'label_ar' => 'تقييم التجويد', 'label_en' => 'Tajweed rating', 'field_type' => 'SELECT', 'options' => ['ممتاز', 'جيد جداً', 'جيد'], 'is_required' => false],
            ['key' => 'next_assignment', 'label_ar' => 'الوِرد القادم', 'label_en' => 'Next assignment', 'field_type' => 'TEXT', 'options' => null, 'is_required' => false],
            ['key' => 'notes', 'label_ar' => 'ملاحظات للأهل', 'label_en' => 'Notes for family', 'field_type' => 'TEXTAREA', 'options' => null, 'is_required' => false],
        ];
    }

    private function seedPlatformCatalog(): void
    {
        DB::table('academy_types')->updateOrInsert(
            ['code' => 'QURAN'],
            [
                'name' => "Qur'an",
                'description' => "Qur'an memorization & tajweed",
                'report_field_template' => json_encode(self::quranReportFieldTemplate()),
            ]
        );

        // `plans.features` follows the Sprint-9 documented shape:
        //   { capabilities: string[], limits: { maxStudents?, maxTeachers? } }
        // The commercial catalog (EGP) sold in the Egyptian market:
        //   FREE  — NOT a free tier: it is the 5-day FREE TRIAL. Every feature, tiny caps
        //           (2 teachers / 5 students); a FREE academy is provisioned on status=TRIAL so
        //           the subscription expires after config('billing.trial_days')=5 days and the
        //           academy is suspended until it converts to a paid plan. The paid plans below
        //           are provisioned ACTIVE — they get NO free trial.
        //   BASIC — core operations only: invoicing + payroll + WhatsApp automation. Staff,
        //           certificates, student reports, full audit and custom report fields are PRO.
        //   PRO   — every feature, with generous caps (15 teachers / 60 students).
        // Prices are in minor units (piastres): 699 EGP = 69900, 999 EGP = 99900. Moving a
        // feature between tiers is an edit here — not a code change (§3.1, TC-9.5).
        $allCapabilities = array_keys(FeatureCatalog::CAPABILITIES);
        foreach ([
            ['code' => 'FREE', 'name' => 'Free Trial', 'price_minor' => 0, 'features' => json_encode([
                'capabilities' => $allCapabilities,
                'limits' => ['maxStudents' => 5, 'maxTeachers' => 2],
            ])],
            ['code' => 'BASIC', 'name' => 'Basic', 'price_minor' => 69900, 'features' => json_encode([
                'capabilities' => ['invoicing', 'payroll', 'whatsapp.automation'],
                'limits' => ['maxStudents' => 25, 'maxTeachers' => 5],
            ])],
            ['code' => 'PRO', 'name' => 'Pro', 'price_minor' => 99900, 'features' => json_encode([
                'capabilities' => $allCapabilities,
                'limits' => ['maxStudents' => 60, 'maxTeachers' => 15],
            ])],
        ] as $plan) {
            DB::table('plans')->updateOrInsert(
                ['code' => $plan['code']],
                [
                    'name' => $plan['name'],
                    'price_minor' => $plan['price_minor'],
                    'currency' => 'EGP',
                    'features' => $plan['features'],
                    'is_active' => true,
                ]
            );
        }

        // Video classroom add-on (docs/video-platform §5). Sold standalone OR bundled: it is
        // already in every PRO/FREE plan above (PRO uses the full FeatureCatalog), and these
        // per-currency add-on rows let a BASIC / video-only academy buy it à la carte. Money never
        // converts (MoneyMinorUnits), so there is one priced row per currency, all unlocking the
        // same `video.conferencing` feature_key; the grant picks the row matching the academy's plan.
        foreach ([
            ['code' => 'VIDEO_EGP', 'price_minor' => 49900, 'currency' => 'EGP'],
            ['code' => 'VIDEO_USD', 'price_minor' => 1500,  'currency' => 'USD'],
            ['code' => 'VIDEO_GBP', 'price_minor' => 1200,  'currency' => 'GBP'],
            ['code' => 'VIDEO_SAR', 'price_minor' => 5600,  'currency' => 'SAR'],
            ['code' => 'VIDEO_AED', 'price_minor' => 5500,  'currency' => 'AED'],
            ['code' => 'VIDEO_EUR', 'price_minor' => 1400,  'currency' => 'EUR'],
        ] as $addOn) {
            DB::table('add_ons')->updateOrInsert(
                ['code' => $addOn['code']],
                [
                    'name' => 'Video Classroom',
                    'price_minor' => $addOn['price_minor'],
                    'currency' => $addOn['currency'],
                    'feature_key' => 'video.conferencing',
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

    /** Seed the demo academy's report fields by copying the Qur'an type template (§5). */
    private function seedReportFields(): void
    {
        foreach (self::quranReportFieldTemplate() as $i => $field) {
            DB::table('report_field_definitions')->updateOrInsert(
                ['academy_id' => self::ACADEMY_ID, 'key' => $field['key']],
                [
                    'label_ar' => $field['label_ar'],
                    'label_en' => $field['label_en'],
                    'field_type' => $field['field_type'],
                    'options' => $field['options'] !== null ? json_encode($field['options']) : null,
                    'sort_order' => $i + 1,
                    'is_required' => $field['is_required'],
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

    private function seedPaymentSettings(): void
    {
        $methods = [
            [
                'method' => 'BANK_TRANSFER',
                'is_active' => true,
                'config' => json_encode([
                    'account_number' => '1234567890',
                    'account_holder' => 'Demo Academy',
                    'bank_name' => 'Al Rajhi Bank',
                    'iban' => 'SA00 0000 0000 0000 0000 0000',
                ]),
            ],
            [
                'method' => 'PAYPAL',
                'is_active' => false,
                'config' => json_encode([
                    'email' => 'payments@demo-academy.com',
                    'mode' => 'live',
                ]),
            ],
            [
                'method' => 'XPAY',
                'is_active' => false,
                'config' => json_encode([]),
            ],
        ];

        foreach ($methods as $row) {
            DB::table('academy_payment_settings')->updateOrInsert(
                ['academy_id' => self::ACADEMY_ID, 'method' => $row['method']],
                array_merge($row, ['academy_id' => self::ACADEMY_ID, 'id' => (string) Str::uuid()]),
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

    /**
     * A richer, multi-currency demo so the academy dashboard's financial KPIs (Collected,
     * Billed, Outstanding, Due) read as real numbers (TC-9.x demo). Families are billed in
     * their own currency (USD/EUR/GBP/SAR/AED/EGP) — no FX, every figure stays grouped per
     * currency exactly as the invoice-summary endpoint aggregates it. USD is deliberately the
     * largest-billed currency so the headline cards render in USD with >$3,000 collected.
     *
     * Teacher SALARIES stay EGP-only (payouts below) — only family billing is multi-currency.
     *
     * Everything is keyed on a stable UUID / (payer, period) so a re-seed upserts in place;
     * invoices are inserted with their final status, sidestepping the closed-invoice
     * immutability trigger (which only guards UPDATEs and line-item inserts).
     */
    private function seedFinanceDemo(): void
    {
        $p = '0a000000-0000-7000-8000-';

        // ── Guardians, each invoiced in their own currency ──────────────────────
        // [id, name, phone, country, currency]
        $guardians = [
            [$p.'000000000101', 'James Carter', '+14155550101', 'US', 'USD'],
            [$p.'000000000102', 'Sophie Dubois', '+33155550102', 'FR', 'EUR'],
            [$p.'000000000103', 'Oliver Smith', '+44155550103', 'GB', 'GBP'],
            [$p.'000000000104', 'Abdullah Al-Saud', '+966555550104', 'SA', 'SAR'],
            [$p.'000000000105', 'Khalid Al-Maktoum', '+971555550105', 'AE', 'AED'],
        ];
        foreach ($guardians as [$id, $name, $phone, $country, $cur]) {
            DB::table('guardians')->updateOrInsert(
                ['id' => $id],
                [
                    'academy_id' => self::ACADEMY_ID,
                    'full_name' => $name,
                    'whatsapp_phone' => $phone,
                    'country' => $country,
                    'currency' => $cur,
                ]
            );
        }

        // ── Students (+ one active teacher assignment + a subscription each) ─────
        // [id, guardianId, name, subscriptionCurrency, pricePerMonthMinor, teacherId]
        $students = [
            [$p.'000000000111', $p.'000000000101', 'Adam Carter', 'USD', 30000, self::TEACHER1_ID],
            [$p.'000000000112', $p.'000000000101', 'Layla Carter', 'USD', 25000, self::TEACHER2_ID],
            [$p.'000000000113', $p.'000000000102', 'Hugo Dubois', 'EUR', 28000, self::TEACHER1_ID],
            [$p.'000000000114', $p.'000000000102', 'Emma Dubois', 'EUR', 24000, self::TEACHER2_ID],
            [$p.'000000000115', $p.'000000000103', 'Jack Smith', 'GBP', 26000, self::TEACHER1_ID],
            [$p.'000000000116', $p.'000000000103', 'Lily Smith', 'GBP', 22000, self::TEACHER2_ID],
            [$p.'000000000117', $p.'000000000104', 'Omar Al-Saud', 'SAR', 70000, self::TEACHER1_ID],
            [$p.'000000000118', $p.'000000000104', 'Sara Al-Saud', 'SAR', 60000, self::TEACHER2_ID],
            [$p.'000000000119', $p.'000000000105', 'Yousef Al-Maktoum', 'AED', 65000, self::TEACHER1_ID],
            [$p.'00000000011a', $p.'000000000105', 'Noor Al-Maktoum', 'AED', 55000, self::TEACHER2_ID],
            [$p.'00000000011b', self::GUARDIAN_ID, 'Khadija Hassan', 'EGP', 80000, self::TEACHER1_ID],
            [$p.'00000000011c', self::GUARDIAN_ID, 'Bilal Hassan', 'EGP', 60000, self::TEACHER2_ID],
        ];
        foreach ($students as [$id, $gid, $name, $cur, $price, $teacherId]) {
            DB::table('students')->updateOrInsert(
                ['id' => $id],
                [
                    'academy_id' => self::ACADEMY_ID,
                    'guardian_id' => $gid,
                    'full_name' => $name,
                    'status' => 'REGULAR',
                ]
            );
            DB::table('student_teacher_assignments')->updateOrInsert(
                ['academy_id' => self::ACADEMY_ID, 'student_id' => $id, 'ended_at' => null],
                ['teacher_id' => $teacherId]
            );
            DB::table('subscriptions')->updateOrInsert(
                ['academy_id' => self::ACADEMY_ID, 'student_id' => $id, 'plan_label' => 'Monthly · '.$cur],
                [
                    'sessions_per_month' => 8,
                    'price_minor' => $price,
                    'currency' => $cur,
                    'price_basis' => 'PER_MONTH',
                    'status' => 'ACTIVE',
                    'start_date' => '2026-01-01',
                ]
            );
        }

        // ── Monthly invoices (PER_GUARDIAN). Mix of statuses drives the KPIs:
        //   PAID            → Collected
        //   PARTIALLY_PAID  → Collected (part) + Outstanding + Due
        //   CLOSED (unpaid) → Outstanding + Due
        //   OPEN   (unpaid) → Due only
        // [guardianId, currency, [ [year, month, totalMinor, paidMinor, status], ... ]]
        $invoices = [
            [$p.'000000000101', 'USD', [[2026, 4, 180000, 180000, 'PAID'], [2026, 5, 200000, 200000, 'PAID'], [2026, 6, 220000, 120000, 'PARTIALLY_PAID']]],
            [$p.'000000000102', 'EUR', [[2026, 4, 90000, 90000, 'PAID'], [2026, 5, 100000, 100000, 'PAID'], [2026, 6, 110000, 0, 'CLOSED']]],
            [$p.'000000000103', 'GBP', [[2026, 4, 80000, 80000, 'PAID'], [2026, 5, 80000, 80000, 'PAID'], [2026, 6, 90000, 0, 'OPEN']]],
            [$p.'000000000104', 'SAR', [[2026, 4, 130000, 130000, 'PAID'], [2026, 5, 140000, 140000, 'PAID'], [2026, 6, 150000, 0, 'CLOSED']]],
            [$p.'000000000105', 'AED', [[2026, 4, 120000, 120000, 'PAID'], [2026, 5, 130000, 130000, 'PAID'], [2026, 6, 140000, 60000, 'PARTIALLY_PAID']]],
            [self::GUARDIAN_ID, 'EGP', [[2026, 4, 80000, 80000, 'PAID'], [2026, 5, 80000, 80000, 'PAID'], [2026, 6, 80000, 0, 'CLOSED']]],
        ];
        foreach ($invoices as [$gid, $cur, $rows]) {
            foreach ($rows as [$year, $month, $total, $paid, $status]) {
                $isClosed = in_array($status, ['CLOSED', 'PAID', 'PARTIALLY_PAID'], true);
                $mm = sprintf('%02d', $month);
                DB::table('invoices')->updateOrInsert(
                    ['academy_id' => self::ACADEMY_ID, 'guardian_id' => $gid, 'period_year' => $year, 'period_month' => $month],
                    [
                        'student_id' => null,
                        'status' => $status,
                        'currency' => $cur,
                        'subtotal_minor' => $total,
                        'total_minor' => $total,
                        'amount_paid_minor' => $paid,
                        'public_token' => sprintf('demo-%s-%d-%s', substr($gid, -3), $year, $mm),
                        'closed_at' => $isClosed ? "$year-$mm-05 12:00:00+00" : null,
                        'paid_at' => $status === 'PAID' ? "$year-$mm-07 12:00:00+00" : null,
                        'payment_method' => in_array($status, ['PAID', 'PARTIALLY_PAID'], true) ? 'BANK_TRANSFER' : null,
                    ]
                );
            }
        }

        // ── Teacher payouts — ALWAYS EGP (salaries are single-currency) ─────────
        // [teacherId, [ [year, month, totalMinor], ... ]]
        $payouts = [
            [self::TEACHER1_ID, [[2026, 4, 100000], [2026, 5, 110000], [2026, 6, 120000]]],
            [self::TEACHER2_ID, [[2026, 4, 80000], [2026, 5, 85000], [2026, 6, 90000]]],
        ];
        foreach ($payouts as [$teacherId, $rows]) {
            foreach ($rows as [$year, $month, $total]) {
                $mm = sprintf('%02d', $month);
                DB::table('payouts')->updateOrInsert(
                    ['academy_id' => self::ACADEMY_ID, 'teacher_id' => $teacherId, 'period_year' => $year, 'period_month' => $month],
                    ['total_minor' => $total, 'currency' => 'EGP', 'finalized_at' => "$year-$mm-28 12:00:00+00"]
                );
            }
        }
    }
}
