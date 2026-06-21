<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Support\PermissionCatalog;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Marketing showcase academy — a fully-populated PRO Qur'an academy used for demos,
 * screenshots and sales. Distinct from {@see DemoAcademySeeder} (the tiny, test-bound
 * fixture): this one paints every feature with months of internally-consistent data
 * (people → schedules → sessions → reports → invoices → payouts → automation → audit).
 *
 * Run it on its own (never wired into the default DatabaseSeeder so it can't disturb the
 * test fixtures):
 *
 *     php artisan db:seed --class='Database\Seeders\ShowcaseAcademySeeder'
 *
 * Idempotency: every row carries a stable, deterministic UUID derived from a string seed,
 * so a re-run upserts in place. Immutable financial rows (CLOSED/PAID invoices, finalized
 * payouts) are created exactly once and skipped on re-run, which keeps the §7.5 immutability
 * triggers happy. All writes go in under a SUPER_ADMIN tenant context already inside the
 * showcase academy, satisfying every tenant `with check` policy.
 *
 * Login (all demo users share one password): see self::PASSWORD. Owner: owner@alfurqan.demo
 */
class ShowcaseAcademySeeder extends Seeder
{
    private const ACADEMY_ID = 'a1f00000-0000-7000-8000-000000000001';

    private const SUPER_ADMIN_USER_ID = 'a1f00000-0000-7000-8000-0000000000aa';

    private const OWNER_USER_ID = 'a1f00000-0000-7000-8000-000000000010';

    private const PASSWORD = 'Demo!2026';

    /** "Today" the dataset is built around. Sessions after this are SCHEDULED (calendar). */
    private const TODAY = '2026-06-21';

    private string $pwHash;

    /** Months (2026) we generate operational history for. June is the in-progress month. */
    private array $months = [2, 3, 4, 5, 6];

    public function run(): void
    {
        $this->pwHash = Hash::make(self::PASSWORD);

        TenantContext::apply(
            userId: self::OWNER_USER_ID,
            academyId: self::ACADEMY_ID,
            role: 'SUPER_ADMIN',
            local: false,
        );

        try {
            $this->seedPlatformCatalog();
            $this->seedAcademy();
            $this->seedUsers();
            $this->seedSpecializations();
            $this->seedReportFields();
            $this->seedTeachers();
            $this->seedCustomRolesAndStaff();
            $this->seedGuardiansAndStudents();
            $this->seedSchedules();
            $sessions = $this->seedSessions();
            $this->seedSessionReports($sessions);
            $this->seedInvoices($sessions);
            $this->seedPayouts($sessions);
            $this->seedCertificates();
            $this->seedTrials();
            $this->seedProgressAndTeacherReports();
            $this->seedNotificationsAndCancellations($sessions);
            $this->seedAutomation($sessions);
            $this->seedPaymentSettings();
            $this->seedPlatformBilling();
            $this->seedAuditLog();

            app(\App\Services\AcademyBilling::class)->recomputeTotals(self::ACADEMY_ID);
        } finally {
            TenantContext::clear();
        }

        $this->command?->info('Showcase academy seeded: "Al-Furqan Qur\'an Academy" (subdomain: alfurqan).');
        $this->command?->info('Owner login: owner@alfurqan.demo  /  '.self::PASSWORD);
    }

    // ── deterministic id helpers ─────────────────────────────────────────────

    /** Stable UUIDv7-shaped id derived from a seed string (idempotency key). */
    private function id(string $seed): string
    {
        $h = md5('showcase:'.$seed);

        return substr($h, 0, 8).'-'.substr($h, 8, 4).'-7'.substr($h, 13, 3)
            .'-8'.substr($h, 17, 3).'-'.substr($h, 20, 12);
    }

    /** Insert a row only if its id is not already present (immutable / generated rows). */
    private function insertOnce(string $table, string $id, array $row): bool
    {
        if (DB::table($table)->where('id', $id)->exists()) {
            return false;
        }
        DB::table($table)->insert(array_merge(['id' => $id], $row));

        return true;
    }

    private function ts(string $local): string
    {
        return CarbonImmutable::parse($local, 'Africa/Cairo')->utc()->toDateTimeString();
    }

    // ── platform catalog (plans / permissions) ───────────────────────────────

    private function seedPlatformCatalog(): void
    {
        DB::table('academy_types')->updateOrInsert(
            ['code' => 'QURAN'],
            [
                'name' => "Qur'an",
                'description' => "Qur'an memorization & tajweed",
                'report_field_template' => json_encode(DemoAcademySeeder::quranReportFieldTemplate()),
            ]
        );

        $allCapabilities = array_keys(\App\Support\FeatureCatalog::CAPABILITIES);
        foreach ([
            ['code' => 'FREE', 'name' => 'Free Trial', 'price_minor' => 0, 'features' => [
                'capabilities' => $allCapabilities, 'limits' => ['maxStudents' => 5, 'maxTeachers' => 2],
            ]],
            ['code' => 'BASIC', 'name' => 'Basic', 'price_minor' => 69900, 'features' => [
                'capabilities' => ['invoicing', 'payroll', 'whatsapp.automation'],
                'limits' => ['maxStudents' => 25, 'maxTeachers' => 5],
            ]],
            ['code' => 'PRO', 'name' => 'Pro', 'price_minor' => 99900, 'features' => [
                'capabilities' => $allCapabilities, 'limits' => ['maxStudents' => 60, 'maxTeachers' => 15],
            ]],
        ] as $plan) {
            DB::table('plans')->updateOrInsert(
                ['code' => $plan['code']],
                [
                    'name' => $plan['name'],
                    'price_minor' => $plan['price_minor'],
                    'currency' => 'EGP',
                    'features' => json_encode($plan['features']),
                    'is_active' => true,
                ]
            );
        }

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
                'name' => "Al-Furqan Qur'an Academy",
                'academy_type_id' => $quranTypeId,
                'status' => 'ACTIVE',
                'plan_id' => $proPlanId,
                'default_currency' => 'EGP',
                'timezone' => 'Africa/Cairo',
                'invoice_grouping' => 'PER_GUARDIAN',
                'billing_day' => 1,
                'subdomain' => 'alfurqan',
                'brand_display_name' => "Al-Furqan Academy",
                'created_at' => $this->ts('2026-01-12 09:00'),
            ]
        );
    }

    // ── users (owner + teachers + staff users) ───────────────────────────────

    private function seedUser(string $id, ?string $academyId, string $name, string $email, string $role, ?string $lastLogin = null): void
    {
        DB::table('users')->updateOrInsert(
            ['id' => $id],
            [
                'academy_id' => $academyId,
                'full_name' => $name,
                'email' => $email,
                'password' => $this->pwHash,
                'is_active' => true,
                'email_verified_at' => $this->ts('2026-01-12 09:00'),
                'preferred_locale' => 'ar',
                'last_login_at' => $lastLogin,
            ]
        );
        DB::table('user_roles')->updateOrInsert(
            ['user_id' => $id, 'academy_id' => $academyId, 'role' => $role],
            []
        );
    }

    private function seedUsers(): void
    {
        // Platform super admin (no home academy).
        DB::table('users')->updateOrInsert(
            ['id' => self::SUPER_ADMIN_USER_ID],
            [
                'academy_id' => null,
                'full_name' => 'Platform Admin',
                'email' => 'admin@academiq.app',
                'password' => $this->pwHash,
                'is_active' => true,
                'email_verified_at' => $this->ts('2026-01-01 00:00'),
            ]
        );
        DB::table('user_roles')->updateOrInsert(
            ['user_id' => self::SUPER_ADMIN_USER_ID, 'academy_id' => null, 'role' => 'SUPER_ADMIN'],
            []
        );

        $this->seedUser(self::OWNER_USER_ID, self::ACADEMY_ID, 'Ibrahim Al-Furqan', 'owner@alfurqan.demo', 'ACADEMY_OWNER', $this->ts('2026-06-21 08:30'));
    }

    private function seedSpecializations(): void
    {
        $names = ['Hifz (Memorization)', 'Tajweed', "Qira'at", 'Tafseer', 'Arabic Language', 'Noorani Qaida'];
        foreach ($names as $i => $name) {
            DB::table('specializations')->updateOrInsert(
                ['academy_id' => self::ACADEMY_ID, 'name' => $name],
                ['is_active' => true, 'sort_order' => $i]
            );
        }
    }

    private function seedReportFields(): void
    {
        foreach (DemoAcademySeeder::quranReportFieldTemplate() as $i => $field) {
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

    // ── teachers ──────────────────────────────────────────────────────────────

    /** @return list<array{0:int,1:string,2:string,3:string,4:int,5:string}> idx,name,email,spec,rate_minor(hourly),phone */
    private function teacherDefs(): array
    {
        return [
            [0, 'Sheikh Abdullah Al-Masri', 'abdullah@alfurqan.demo', 'Hifz (Memorization)', 9000, '+201010010001'],
            [1, 'Ustadh Omar Khalil', 'omar@alfurqan.demo', 'Tajweed', 7500, '+201010010002'],
            [2, 'Ustadha Aisha Rahman', 'aisha@alfurqan.demo', 'Hifz (Memorization)', 8000, '+201010010003'],
            [3, 'Ustadha Khadija Saleh', 'khadija@alfurqan.demo', "Qira'at", 8500, '+201010010004'],
            [4, 'Ustadh Yahya Idris', 'yahya@alfurqan.demo', 'Arabic Language', 7000, '+201010010005'],
            [5, 'Ustadh Bilal Toure', 'bilal@alfurqan.demo', 'Tafseer', 7500, '+201010010006'],
        ];
    }

    private function teacherId(int $idx): string
    {
        return $this->id("teacher:$idx");
    }

    private function teacherUserId(int $idx): string
    {
        return $this->id("teacher-user:$idx");
    }

    private function seedTeachers(): void
    {
        foreach ($this->teacherDefs() as [$idx, $name, $email, $spec, $rate, $phone]) {
            $userId = $this->teacherUserId($idx);
            $this->seedUser($userId, self::ACADEMY_ID, $name, $email, 'TEACHER', $this->ts('2026-06-20 19:00'));
            DB::table('teachers')->updateOrInsert(
                ['id' => $this->teacherId($idx)],
                [
                    'academy_id' => self::ACADEMY_ID,
                    'user_id' => $userId,
                    'full_name' => $name,
                    'phone' => $phone,
                    'specialization' => $spec,
                    'session_rate_minor' => $rate,
                    'currency' => 'EGP',
                    'timezone' => 'Africa/Cairo',
                    'is_active' => true,
                    'availability' => json_encode([
                        ['weekday' => 0, 'from' => '16:00', 'to' => '21:00'],
                        ['weekday' => 1, 'from' => '16:00', 'to' => '21:00'],
                        ['weekday' => 2, 'from' => '16:00', 'to' => '21:00'],
                        ['weekday' => 3, 'from' => '16:00', 'to' => '21:00'],
                        ['weekday' => 6, 'from' => '10:00', 'to' => '14:00'],
                    ]),
                ]
            );
        }
    }

    // ── custom roles + staff ──────────────────────────────────────────────────

    private function seedCustomRolesAndStaff(): void
    {
        $permIds = DB::table('permissions')->pluck('id', 'code');

        $roles = [
            [
                'code' => 'CR_'.str_replace('-', '', $this->id('role:reception')),
                'name' => 'Receptionist',
                'description' => 'Front desk — reads students, guardians, schedule and sessions.',
                'perms' => ['student.read', 'guardian.read', 'schedule.read', 'session.read', 'notification.read'],
            ],
            [
                'code' => 'CR_'.str_replace('-', '', $this->id('role:finance')),
                'name' => 'Finance Manager',
                'description' => 'Handles invoicing and payroll.',
                'perms' => ['student.read', 'guardian.read', 'invoice.read', 'invoice.create', 'invoice.close',
                    'invoice.mark_paid', 'invoice.send_link', 'payout.read', 'payout.finalize', 'payout.adjust', 'staff.read'],
            ],
        ];
        $roleId = [];
        foreach ($roles as $r) {
            $id = $this->id('academy_role:'.$r['name']);
            $roleId[$r['name']] = ['id' => $id, 'code' => $r['code']];
            DB::table('academy_roles')->updateOrInsert(
                ['id' => $id],
                [
                    'academy_id' => self::ACADEMY_ID,
                    'code' => $r['code'],
                    'name' => $r['name'],
                    'description' => $r['description'],
                    'is_active' => true,
                ]
            );
            foreach ($r['perms'] as $code) {
                if (! isset($permIds[$code])) {
                    continue;
                }
                DB::table('academy_role_permissions')->updateOrInsert(
                    ['academy_id' => self::ACADEMY_ID, 'role_id' => $id, 'permission_id' => $permIds[$code]],
                    []
                );
            }
        }

        // Staff — two carry a user login bound to a custom role; the rest are records only.
        $staff = [
            ['key' => 'reception', 'name' => 'Nada Al-Rashid', 'dept' => 'RECEPTION', 'phone' => '+201020020001',
                'salary' => 600000, 'notes' => 'Front desk, family enquiries and trial booking.',
                'email' => 'reception@alfurqan.demo', 'role' => $roleId['Receptionist']['code']],
            ['key' => 'finance', 'name' => 'Ahmed Samir', 'dept' => 'ACCOUNTING', 'phone' => '+201020020002',
                'salary' => 900000, 'notes' => 'Invoices, payroll, monthly reconciliation.',
                'email' => 'finance@alfurqan.demo', 'role' => $roleId['Finance Manager']['code']],
            ['key' => 'hr', 'name' => 'Layla Hassan', 'dept' => 'HR', 'phone' => '+201020020003',
                'salary' => 750000, 'notes' => 'Teacher contracts and performance reviews.', 'email' => null, 'role' => null],
            ['key' => 'marketing', 'name' => 'Karim Adel', 'dept' => 'MARKETING', 'phone' => '+201020020004',
                'salary' => 700000, 'notes' => 'Social media and enrolment campaigns.', 'email' => null, 'role' => null],
        ];
        foreach ($staff as $s) {
            $userId = null;
            if ($s['email'] !== null) {
                $userId = $this->id('staff-user:'.$s['key']);
                $this->seedUser($userId, self::ACADEMY_ID, $s['name'], $s['email'], $s['role'], $this->ts('2026-06-19 12:00'));
            }
            DB::table('staff')->updateOrInsert(
                ['id' => $this->id('staff:'.$s['key'])],
                [
                    'academy_id' => self::ACADEMY_ID,
                    'user_id' => $userId,
                    'full_name' => $s['name'],
                    'department' => $s['dept'],
                    'phone' => $s['phone'],
                    'salary_minor' => $s['salary'],
                    'currency' => 'EGP',
                    'notes' => $s['notes'],
                    'is_active' => true,
                ]
            );
        }
    }

    // ── guardians + students ──────────────────────────────────────────────────

    /** @return array<string,array{name:string,phone:string,self?:bool}> */
    private function guardianDefs(): array
    {
        return [
            'g1' => ['name' => 'Mahmoud Farouk', 'phone' => '+201001112233'],
            'g2' => ['name' => 'Sara Abdelrahman', 'phone' => '+201002223344'],
            'g3' => ['name' => 'Khaled Mostafa', 'phone' => '+201003334455'],
            'g4' => ['name' => 'Nourhan Adel', 'phone' => '+201004445566'],
            'g5' => ['name' => 'Tarek Hassan', 'phone' => '+201005556677'],
            'g6' => ['name' => 'Mona Saeed', 'phone' => '+201006667788'],
            'g7' => ['name' => 'Hossam Eldin', 'phone' => '+201007778899'],
            'g8' => ['name' => 'Rania Lotfy', 'phone' => '+201008889900'],
            'g9' => ['name' => 'Amir Zaki', 'phone' => '+201009990011', 'self' => true],
        ];
    }

    /**
     * @return list<array<string,mixed>> per-student config: key,name,guardian,teacher,status,
     *   basis,price,spm,days[],time,from(month),to(month|null)
     */
    private function studentDefs(): array
    {
        return [
            ['key' => 's1', 'name' => 'Yusuf Mahmoud', 'guardian' => 'g1', 'teacher' => 0, 'status' => 'REGULAR',
                'basis' => 'PER_SESSION', 'price' => 12000, 'spm' => null, 'days' => [6, 1], 'time' => '17:00', 'from' => 2, 'to' => null, 'phone' => '+201101112201'],
            ['key' => 's2', 'name' => 'Maryam Mahmoud', 'guardian' => 'g1', 'teacher' => 2, 'status' => 'REGULAR',
                'basis' => 'PER_SESSION', 'price' => 12000, 'spm' => null, 'days' => [0, 3], 'time' => '16:00', 'from' => 2, 'to' => null, 'phone' => '+201101112202'],
            ['key' => 's3', 'name' => 'Adam Abdelrahman', 'guardian' => 'g2', 'teacher' => 1, 'status' => 'REGULAR',
                'basis' => 'PER_MONTH', 'price' => 80000, 'spm' => 8, 'days' => [1, 3], 'time' => '18:00', 'from' => 2, 'to' => null, 'phone' => '+201101112203'],
            ['key' => 's4', 'name' => 'Layla Mostafa', 'guardian' => 'g3', 'teacher' => 2, 'status' => 'REGULAR',
                'basis' => 'PER_SESSION', 'price' => 13000, 'spm' => null, 'days' => [6], 'time' => '10:00', 'from' => 2, 'to' => null, 'phone' => '+201101112204'],
            ['key' => 's5', 'name' => 'Omar Adel', 'guardian' => 'g4', 'teacher' => 0, 'status' => 'REGULAR',
                'basis' => 'PER_SESSION', 'price' => 12000, 'spm' => null, 'days' => [2, 4], 'time' => '17:00', 'from' => 2, 'to' => null, 'phone' => '+201101112205'],
            ['key' => 's6', 'name' => 'Hana Hassan', 'guardian' => 'g5', 'teacher' => 3, 'status' => 'REGULAR',
                'basis' => 'PER_HOUR', 'price' => 15000, 'spm' => null, 'days' => [0], 'time' => '19:00', 'from' => 2, 'to' => null, 'phone' => '+201101112206'],
            ['key' => 's7', 'name' => 'Zaid Saeed', 'guardian' => 'g6', 'teacher' => 4, 'status' => 'REGULAR',
                'basis' => 'PER_SESSION', 'price' => 11000, 'spm' => null, 'days' => [1, 4], 'time' => '16:00', 'from' => 3, 'to' => null, 'phone' => '+201101112207'],
            ['key' => 's8', 'name' => 'Salma Eldin', 'guardian' => 'g7', 'teacher' => 2, 'status' => 'REGULAR',
                'basis' => 'PER_MONTH', 'price' => 90000, 'spm' => 8, 'days' => [0, 2], 'time' => '18:00', 'from' => 2, 'to' => null, 'phone' => '+201101112208'],
            ['key' => 's9', 'name' => 'Khadija Lotfy', 'guardian' => 'g8', 'teacher' => 3, 'status' => 'REGULAR',
                'basis' => 'PER_SESSION', 'price' => 13000, 'spm' => null, 'days' => [5], 'time' => '11:00', 'from' => 5, 'to' => null, 'phone' => '+201101112209'],
            ['key' => 's10', 'name' => 'Amir Zaki', 'guardian' => 'g9', 'teacher' => 5, 'status' => 'REGULAR',
                'basis' => 'PER_SESSION', 'price' => 14000, 'spm' => null, 'days' => [3], 'time' => '20:00', 'from' => 4, 'to' => null, 'phone' => '+201101112210', 'self' => true],
            ['key' => 's11', 'name' => 'Bilal Farouk', 'guardian' => 'g1', 'teacher' => 1, 'status' => 'GRADUATED',
                'basis' => 'PER_SESSION', 'price' => 12000, 'spm' => null, 'days' => [4], 'time' => '17:00', 'from' => 2, 'to' => 4, 'phone' => '+201101112211'],
            ['key' => 's12', 'name' => 'Fatima Hassan', 'guardian' => 'g5', 'teacher' => 2, 'status' => 'WITHDRAWN',
                'basis' => 'PER_SESSION', 'price' => 12000, 'spm' => null, 'days' => [3], 'time' => '16:00', 'from' => 2, 'to' => 3, 'phone' => '+201101112212'],
        ];
    }

    private function guardianId(string $key): string
    {
        return $this->id("guardian:$key");
    }

    private function studentId(string $key): string
    {
        return $this->id("student:$key");
    }

    private function seedGuardiansAndStudents(): void
    {
        foreach ($this->guardianDefs() as $key => $g) {
            DB::table('guardians')->updateOrInsert(
                ['id' => $this->guardianId($key)],
                [
                    'academy_id' => self::ACADEMY_ID,
                    'full_name' => $g['name'],
                    'whatsapp_phone' => $g['phone'],
                    'country' => 'EG',
                    'currency' => 'EGP',
                    'notes' => ($g['self'] ?? false) ? 'Adult learner (self-guardian).' : null,
                ]
            );
        }

        foreach ($this->studentDefs() as $s) {
            DB::table('students')->updateOrInsert(
                ['id' => $this->studentId($s['key'])],
                [
                    'academy_id' => self::ACADEMY_ID,
                    'guardian_id' => $this->guardianId($s['guardian']),
                    'full_name' => $s['name'],
                    'whatsapp_phone' => $s['phone'],
                    'country' => 'EG',
                    'status' => $s['status'],
                    'is_self_guardian' => $s['self'] ?? false,
                ]
            );

            // Teacher assignment: active for current students, ended for graduated/withdrawn.
            $endedAt = $s['to'] !== null ? $this->ts(sprintf('2026-%02d-28 20:00', $s['to'])) : null;
            DB::table('student_teacher_assignments')->updateOrInsert(
                ['academy_id' => self::ACADEMY_ID, 'student_id' => $this->studentId($s['key']), 'ended_at' => $endedAt],
                [
                    'id' => $this->id('sta:'.$s['key']),
                    'teacher_id' => $this->teacherId($s['teacher']),
                    'started_at' => $this->ts(sprintf('2026-%02d-01 09:00', $s['from'])),
                ]
            );

            // Enrolment subscription.
            $subStatus = $s['status'] === 'REGULAR' ? 'ACTIVE' : 'ENDED';
            $label = match ($s['basis']) {
                'PER_MONTH' => $s['spm'].' sessions / month',
                'PER_HOUR' => 'Hourly ('.number_format($s['price'] / 100, 0).' EGP/hr)',
                default => 'Per-session ('.number_format($s['price'] / 100, 0).' EGP)',
            };
            DB::table('subscriptions')->updateOrInsert(
                ['id' => $this->id('sub:'.$s['key'])],
                [
                    'academy_id' => self::ACADEMY_ID,
                    'student_id' => $this->studentId($s['key']),
                    'plan_label' => $label,
                    'sessions_per_month' => $s['spm'],
                    'price_minor' => $s['price'],
                    'currency' => 'EGP',
                    'price_basis' => $s['basis'],
                    'status' => $subStatus,
                    'start_date' => sprintf('2026-%02d-01', $s['from']),
                ]
            );
        }
    }

    private function scheduleId(string $key): string
    {
        return $this->id("schedule:$key");
    }

    private function slotId(string $key, int $weekday): string
    {
        return $this->id("slot:$key:$weekday");
    }

    private function seedSchedules(): void
    {
        foreach ($this->studentDefs() as $s) {
            $active = $s['status'] === 'REGULAR';
            DB::table('schedules')->updateOrInsert(
                ['id' => $this->scheduleId($s['key'])],
                [
                    'academy_id' => self::ACADEMY_ID,
                    'student_id' => $this->studentId($s['key']),
                    'teacher_id' => $this->teacherId($s['teacher']),
                    'timezone' => 'Africa/Cairo',
                    'is_active' => $active,
                ]
            );
            foreach ($s['days'] as $weekday) {
                DB::table('schedule_slots')->updateOrInsert(
                    ['schedule_id' => $this->scheduleId($s['key']), 'weekday' => $weekday, 'start_time_local' => $s['time'].':00'],
                    [
                        'id' => $this->slotId($s['key'], $weekday),
                        'academy_id' => self::ACADEMY_ID,
                        'duration_minutes' => $s['basis'] === 'PER_HOUR' ? 60 : 30,
                    ]
                );
            }
        }
    }

    // ── sessions (the spine: everything financial derives from these) ─────────

    /** Weighted, deterministic outcome for a past session. */
    private function outcomeFor(string $seed, bool $isFirst): string
    {
        if ($isFirst) {
            return 'FREE'; // first lesson is a free trial
        }
        $r = abs(crc32($seed)) % 100;

        return match (true) {
            $r < 76 => 'ATTENDED',
            $r < 82 => 'ATTENDED',
            $r < 87 => 'ABSENT_UNEXCUSED',
            $r < 91 => 'ABSENT_EXCUSED',
            $r < 95 => 'CANCELLED_BY_STUDENT',
            default => 'CANCELLED_BY_TEACHER',
        };
    }

    /**
     * Generate every session across the history window and return a flat list of records
     * (with computed billable + payable amounts) the invoice/payout builders consume.
     *
     * @return list<array<string,mixed>>
     */
    private function seedSessions(): array
    {
        $today = CarbonImmutable::parse(self::TODAY.' 23:59:59', 'Africa/Cairo');
        $records = [];

        foreach ($this->studentDefs() as $s) {
            $dur = $s['basis'] === 'PER_HOUR' ? 60 : 30;
            $firstSeen = false;
            $toMonth = $s['to'] ?? 7; // active students run one month past today (future calendar)
            for ($m = $s['from']; $m <= $toMonth; $m++) {
                $monthStart = CarbonImmutable::create(2026, $m, 1, 0, 0, 0, 'Africa/Cairo');
                $monthEnd = $monthStart->endOfMonth();
                for ($d = $monthStart; $d <= $monthEnd; $d = $d->addDay()) {
                    if (! in_array($d->dayOfWeek, $s['days'], true)) {
                        continue;
                    }
                    [$hh, $mm] = explode(':', $s['time']);
                    $local = $d->setTime((int) $hh, (int) $mm);
                    if ($local > $monthEnd->addDays(14)) {
                        continue;
                    }
                    $dateStr = $local->toDateString();
                    $seed = $s['key'].':'.$dateStr;
                    $isFuture = $local > $today;
                    $isFirst = ! $firstSeen;
                    $firstSeen = true;
                    $status = $isFuture ? 'SCHEDULED' : $this->outcomeFor($seed, $isFirst);

                    $records[] = [
                        'id' => $this->id('session:'.$seed),
                        'student' => $s['key'],
                        'student_id' => $this->studentId($s['key']),
                        'guardian' => $s['guardian'],
                        'teacher' => $s['teacher'],
                        'teacher_id' => $this->teacherId($s['teacher']),
                        'schedule_id' => $this->scheduleId($s['key']),
                        'slot_id' => $this->slotId($s['key'], $d->dayOfWeek),
                        'local_date' => $dateStr,
                        'at_utc' => $local->utc()->toDateTimeString(),
                        'month' => $m,
                        'dur' => $dur,
                        'status' => $status,
                        'basis' => $s['basis'],
                        'price' => $s['price'],
                        'spm' => $s['spm'],
                        'future' => $isFuture,
                    ];
                }
            }
        }

        // Compute per-session billable amount (PER_MONTH splits evenly across the student's
        // billable sessions in that month so the month total lands exactly on the price).
        $perMonthGroups = [];
        foreach ($records as $i => $r) {
            if ($r['basis'] === 'PER_MONTH' && $this->isBillable($r['status'])) {
                $perMonthGroups[$r['student'].':'.$r['month']][] = $i;
            }
        }

        foreach ($records as $i => &$r) {
            $r['billable_amount'] = null;
            if ($this->isBillable($r['status'])) {
                $r['billable_amount'] = match ($r['basis']) {
                    'PER_SESSION' => $r['status'] === 'FREE' ? 0 : $r['price'],
                    'PER_HOUR' => $r['status'] === 'FREE' ? 0 : (int) round($r['price'] * $r['dur'] / 60),
                    'PER_MONTH' => 0, // filled below
                    default => 0,
                };
            }
            $r['payable_amount'] = $r['status'] === 'ATTENDED'
                ? (int) round($this->teacherDefs()[$r['teacher']][4] * $r['dur'] / 60)
                : null;
        }
        unset($r);

        foreach ($perMonthGroups as $idxs) {
            $price = $records[$idxs[0]]['price'];
            $n = count($idxs);
            $each = intdiv($price, $n);
            foreach ($idxs as $k => $i) {
                // Last billable session absorbs the rounding remainder.
                $records[$i]['billable_amount'] = $records[$i]['status'] === 'FREE'
                    ? 0
                    : ($k === $n - 1 ? $price - $each * ($n - 1) : $each);
            }
        }

        // Persist the sessions.
        foreach ($records as $r) {
            $outcomeAt = $r['future'] ? null : $this->ts($r['local_date'].' '.'20:00');
            $billable = $r['billable_amount'] !== null;
            $this->insertOnce('sessions', $r['id'], [
                'academy_id' => self::ACADEMY_ID,
                'student_id' => $r['student_id'],
                'teacher_id' => $r['teacher_id'],
                'schedule_id' => $r['schedule_id'],
                'slot_id' => $r['slot_id'],
                'occurrence_local_date' => $r['local_date'],
                'scheduled_at_utc' => $r['at_utc'],
                'duration_minutes' => $r['dur'],
                'status' => $r['status'],
                'status_reason' => in_array($r['status'], ['CANCELLED_BY_STUDENT', 'CANCELLED_BY_TEACHER', 'ABSENT_EXCUSED'], true)
                    ? $this->reasonFor($r['status']) : null,
                'billed' => $billable && ! $r['future'],
                'paid_to_teacher' => $r['status'] === 'ATTENDED' && $r['month'] < 6,
                'outcome_set_at' => $outcomeAt,
                'outcome_set_by' => $r['future'] ? null : $this->teacherUserId($r['teacher']),
                'created_at' => $this->ts($r['local_date'].' 08:00'),
                'updated_at' => $outcomeAt ?? $this->ts($r['local_date'].' 08:00'),
            ]);
        }

        return $records;
    }

    private function isBillable(string $status): bool
    {
        return in_array($status, ['ATTENDED', 'ABSENT_UNEXCUSED', 'FREE'], true);
    }

    private function reasonFor(string $status): string
    {
        return match ($status) {
            'CANCELLED_BY_STUDENT' => 'Family travelling.',
            'CANCELLED_BY_TEACHER' => 'Teacher unwell — rescheduled offline.',
            'ABSENT_EXCUSED' => 'Excused — school exams.',
            default => '',
        };
    }

    // ── session reports (lesson reports the guardian receives) ────────────────

    private function seedSessionReports(array $sessions): void
    {
        $surahs = [
            ['Al-Fatiha 1', 'Al-Fatiha 7'], ['Al-Baqarah 1', 'Al-Baqarah 5'], ['Al-Baqarah 6', 'Al-Baqarah 16'],
            ['Al-Baqarah 17', 'Al-Baqarah 29'], ['An-Naba 1', 'An-Naba 16'], ['An-Naziat 1', 'An-Naziat 14'],
            ['Al-Mulk 1', 'Al-Mulk 10'], ['Ar-Rahman 1', 'Ar-Rahman 16'], ['Ya-Sin 1', 'Ya-Sin 12'],
        ];
        $ratings = ['ممتاز', 'جيد جداً', 'جيد'];
        $notes = [
            'Fluent recitation, ready to move on.',
            'Needs to slow down on the madd letters.',
            'Great improvement in makharij this week.',
            'Please revise yesterday\'s portion at home.',
            'Excellent focus throughout the lesson, ma sha Allah.',
        ];

        foreach ($sessions as $r) {
            if ($r['status'] !== 'ATTENDED') {
                continue;
            }
            // ~78% of attended lessons get a written report.
            if (abs(crc32('rep:'.$r['id'])) % 100 >= 78) {
                continue;
            }
            $pick = abs(crc32($r['id']));
            $range = $surahs[$pick % count($surahs)];
            $next = $surahs[($pick + 1) % count($surahs)];
            $sentAt = $pick % 100 < 62 ? $this->ts($r['local_date'].' 21:30') : null;
            $this->insertOnce('session_reports', $this->id('report:'.$r['id']), [
                'academy_id' => self::ACADEMY_ID,
                'session_id' => $r['id'],
                'values' => json_encode([
                    'surah_from' => $range[0],
                    'surah_to' => $range[1],
                    'tajweed_rating' => $ratings[$pick % 3],
                    'next_assignment' => $next[0].' – '.$next[1],
                    'notes' => $notes[$pick % count($notes)],
                ]),
                'filled_by_user_id' => $this->teacherUserId($r['teacher']),
                'filled_at' => $this->ts($r['local_date'].' 20:30'),
                'whatsapp_sent_at' => $sentAt,
                'whatsapp_channel' => $sentAt !== null ? 'MANUAL_WHATSAPP' : null,
                'created_at' => $this->ts($r['local_date'].' 20:30'),
                'updated_at' => $sentAt ?? $this->ts($r['local_date'].' 20:30'),
            ]);
        }
    }

    // ── invoices (AUTO per guardian per month + a couple of MANUAL ones) ──────

    private function token(string $seed): string
    {
        return 'alf'.substr(md5('tok:'.$seed), 0, 19);
    }

    private function seedInvoices(array $sessions): void
    {
        // Group billable session-lines by guardian + month.
        $groups = [];
        foreach ($sessions as $r) {
            if ($r['billable_amount'] === null || $r['future']) {
                continue;
            }
            $groups[$r['guardian'].':'.$r['month']][] = $r;
        }

        $studentName = [];
        foreach ($this->studentDefs() as $s) {
            $studentName[$s['key']] = $s['name'];
        }

        foreach ($groups as $gkey => $lines) {
            [$guardian, $month] = explode(':', $gkey);
            $month = (int) $month;
            $subtotal = array_sum(array_column($lines, 'billable_amount'));
            if ($subtotal <= 0 && count($lines) === 0) {
                continue;
            }
            $invoiceId = $this->id('invoice:'.$gkey);
            if (DB::table('invoices')->where('id', $invoiceId)->exists()) {
                continue; // already seeded (immutable once closed)
            }

            $issuedAt = $this->ts(sprintf('2026-%02d-01 09:00', $month));
            [$status, $amountPaid, $paidAt, $method, $closedAt] = $this->invoiceState($guardian, $month, $subtotal);

            // Insert OPEN first so line items are accepted, then transition.
            DB::table('invoices')->insert([
                'id' => $invoiceId,
                'academy_id' => self::ACADEMY_ID,
                'guardian_id' => $this->guardianId($guardian),
                'student_id' => null,
                'period_year' => 2026,
                'period_month' => $month,
                'status' => 'OPEN',
                'currency' => 'EGP',
                'subtotal_minor' => $subtotal,
                'total_minor' => $subtotal,
                'amount_paid_minor' => 0,
                'public_token' => $this->token($gkey),
                'kind' => 'AUTO',
                'sent_at' => $status !== 'OPEN' || $month < 6 ? $issuedAt : null,
                'sent_channel' => $status !== 'OPEN' || $month < 6 ? 'WHATSAPP' : null,
                'created_at' => $issuedAt,
                'updated_at' => $issuedAt,
            ]);

            foreach ($lines as $r) {
                $desc = match ($r['status']) {
                    'FREE' => 'Free trial — '.$r['local_date'],
                    'ABSENT_UNEXCUSED' => 'Missed lesson '.$r['local_date'].' ('.$studentName[$r['student']].')',
                    default => 'Lesson '.$r['local_date'].' ('.$studentName[$r['student']].')',
                };
                DB::table('invoice_line_items')->insert([
                    'id' => $this->id('iline:'.$r['id']),
                    'academy_id' => self::ACADEMY_ID,
                    'invoice_id' => $invoiceId,
                    'session_id' => $r['id'],
                    'student_id' => $r['student_id'],
                    'description' => $desc,
                    'amount_minor' => $r['billable_amount'],
                    'currency' => 'EGP',
                    'session_date' => $r['local_date'],
                    'created_at' => $issuedAt,
                ]);
            }

            if ($status !== 'OPEN') {
                DB::table('invoices')->where('id', $invoiceId)->update([
                    'status' => $status,
                    'amount_paid_minor' => $amountPaid,
                    'paid_at' => $paidAt,
                    'payment_method' => $method,
                    'closed_at' => $closedAt,
                    'updated_at' => $paidAt ?? $closedAt ?? $issuedAt,
                ]);
            }
        }

        $this->seedManualInvoices();
    }

    /** @return array{0:string,1:int,2:?string,3:?string,4:?string} status,amountPaid,paidAt,method,closedAt */
    private function invoiceState(string $guardian, int $month, int $subtotal): array
    {
        $closedAt = $this->ts(sprintf('2026-%02d-28 18:00', $month));
        $paidAt = $this->ts(sprintf('2026-%02d-05 12:00', $month + 1));
        $method = ['CASH', 'BANK_TRANSFER', 'GATEWAY'][abs(crc32($guardian.$month)) % 3];

        if ($month <= 4) {
            return ['PAID', $subtotal, $paidAt, $method, $closedAt];
        }
        if ($month === 5) {
            return match (abs(crc32($guardian)) % 4) {
                0 => ['PARTIALLY_PAID', intdiv($subtotal, 2), null, $method, $closedAt],
                1 => ['CLOSED', 0, null, null, $closedAt],
                2 => ['VOID', 0, null, null, $closedAt],
                default => ['PAID', $subtotal, $paidAt, $method, $closedAt],
            };
        }

        // June — in progress; a couple already part-paid, the rest still open.
        if (abs(crc32($guardian)) % 3 === 0) {
            return ['PARTIALLY_PAID', intdiv($subtotal, 3), null, $method, $this->ts('2026-06-20 12:00')];
        }

        return ['OPEN', 0, null, null, null];
    }

    private function seedManualInvoices(): void
    {
        $manual = [
            ['student' => 's9', 'guardian' => 'g8', 'month' => 5, 'desc' => 'Registration & materials fee', 'amount' => 30000],
            ['student' => 's10', 'guardian' => 'g9', 'month' => 4, 'desc' => 'Registration & Mushaf', 'amount' => 35000],
        ];
        foreach ($manual as $m) {
            $invoiceId = $this->id('manual-invoice:'.$m['student']);
            if (DB::table('invoices')->where('id', $invoiceId)->exists()) {
                continue;
            }
            $issuedAt = $this->ts(sprintf('2026-%02d-02 10:00', $m['month']));
            DB::table('invoices')->insert([
                'id' => $invoiceId,
                'academy_id' => self::ACADEMY_ID,
                'guardian_id' => $this->guardianId($m['guardian']),
                'student_id' => null,
                'period_year' => 2026,
                'period_month' => $m['month'],
                'status' => 'OPEN',
                'currency' => 'EGP',
                'subtotal_minor' => $m['amount'],
                'total_minor' => $m['amount'],
                'amount_paid_minor' => 0,
                'public_token' => $this->token('manual:'.$m['student']),
                'kind' => 'MANUAL',
                'sent_at' => $issuedAt,
                'sent_channel' => 'WHATSAPP',
                'created_at' => $issuedAt,
                'updated_at' => $issuedAt,
            ]);
            DB::table('invoice_line_items')->insert([
                'id' => $this->id('manual-iline:'.$m['student']),
                'academy_id' => self::ACADEMY_ID,
                'invoice_id' => $invoiceId,
                'session_id' => null,
                'student_id' => $this->studentId($m['student']),
                'description' => $m['desc'],
                'amount_minor' => $m['amount'],
                'currency' => 'EGP',
                'session_date' => null,
                'created_at' => $issuedAt,
            ]);
            $paidAt = $this->ts(sprintf('2026-%02d-04 12:00', $m['month']));
            DB::table('invoices')->where('id', $invoiceId)->update([
                'status' => 'PAID',
                'amount_paid_minor' => $m['amount'],
                'paid_at' => $paidAt,
                'payment_method' => 'CASH',
                'closed_at' => $paidAt,
                'updated_at' => $paidAt,
            ]);
        }
    }

    // ── payouts (per teacher per month, derived from attended sessions) ───────

    private function seedPayouts(array $sessions): void
    {
        $groups = [];
        foreach ($sessions as $r) {
            if ($r['payable_amount'] === null || $r['future']) {
                continue;
            }
            $groups[$r['teacher'].':'.$r['month']][] = $r;
        }

        // A few hand-placed adjustments for realism (teacher idx : month => [type, amount, reason]).
        $adjustments = [
            '0:5' => ['REWARD', 10000, 'Outstanding student results this month.'],
            '2:5' => ['REWARD', 8000, 'Three students advanced a Juz.'],
            '1:4' => ['DEDUCTION', 5000, 'Two late cancellations without notice.'],
            '4:3' => ['REWARD', 6000, 'Covered colleague\'s classes during illness.'],
        ];

        foreach ($groups as $gkey => $lines) {
            [$teacher, $month] = explode(':', $gkey);
            $teacher = (int) $teacher;
            $month = (int) $month;
            $payoutId = $this->id('payout:'.$gkey);
            if (DB::table('payouts')->where('id', $payoutId)->exists()) {
                continue;
            }

            $sessionsTotal = array_sum(array_column($lines, 'payable_amount'));
            $adj = $adjustments[$gkey] ?? null;
            $rewards = $adj && $adj[0] === 'REWARD' ? $adj[1] : 0;
            $deductions = $adj && $adj[0] === 'DEDUCTION' ? $adj[1] : 0;
            $total = $sessionsTotal + $rewards - $deductions;
            $finalizedAt = $month < 6 ? $this->ts(sprintf('2026-%02d-03 10:00', $month + 1)) : null;
            $createdAt = $this->ts(sprintf('2026-%02d-01 09:00', $month));

            // Insert open, attach lines + adjustment, then finalize (so triggers stay happy).
            DB::table('payouts')->insert([
                'id' => $payoutId,
                'academy_id' => self::ACADEMY_ID,
                'teacher_id' => $this->teacherId($teacher),
                'period_year' => 2026,
                'period_month' => $month,
                'total_minor' => $total,
                'rewards_minor' => $rewards,
                'deductions_minor' => $deductions,
                'currency' => 'EGP',
                'notes' => $month < 6 ? null : 'In progress — finalize at month end.',
                'finalized_at' => null,
                'created_at' => $createdAt,
                'updated_at' => $createdAt,
            ]);

            foreach ($lines as $r) {
                DB::table('payout_line_items')->insert([
                    'id' => $this->id('pline:'.$r['id']),
                    'academy_id' => self::ACADEMY_ID,
                    'payout_id' => $payoutId,
                    'session_id' => $r['id'],
                    'amount_minor' => $r['payable_amount'],
                    'currency' => 'EGP',
                    'session_date' => $r['local_date'],
                    'created_at' => $this->ts($r['local_date'].' 21:00'),
                ]);
            }

            if ($adj !== null) {
                DB::table('payout_adjustments')->insert([
                    'id' => $this->id('padj:'.$gkey),
                    'academy_id' => self::ACADEMY_ID,
                    'payout_id' => $payoutId,
                    'type' => $adj[0],
                    'amount_minor' => $adj[1],
                    'currency' => 'EGP',
                    'reason' => $adj[2],
                    'details' => null,
                    'created_by' => self::OWNER_USER_ID,
                    'created_at' => $createdAt,
                    'updated_at' => $createdAt,
                ]);
            }

            if ($finalizedAt !== null) {
                DB::table('payouts')->where('id', $payoutId)->update([
                    'finalized_at' => $finalizedAt,
                    'updated_at' => $finalizedAt,
                ]);
            }
        }
    }

    // ── certificates ──────────────────────────────────────────────────────────

    private function seedCertificates(): void
    {
        $templates = [
            1 => [
                'academyNameEn' => "Al-Furqan Qur'an Academy",
                'academyNameAr' => 'أكاديمية الفرقان لتحفيظ القرآن',
                'titleEn' => 'Certificate of Achievement',
                'titleAr' => 'شهادة تقدير',
                'presentationEn' => 'This certificate is proudly presented to',
                'presentationAr' => 'تُمنح هذه الشهادة بكل فخر إلى',
                'bodyEn' => "In recognition of outstanding dedication and excellence in Qur'anic memorization and tajweed.",
                'bodyAr' => 'تقديرًا للتميّز والاجتهاد المتواصل في حفظ القرآن الكريم وإتقان التجويد.',
                'signatoryNameEn' => 'Ibrahim Al-Furqan',
                'signatoryNameAr' => 'إبراهيم الفرقان',
                'signatoryTitleEn' => 'Academy Director',
                'signatoryTitleAr' => 'مدير الأكاديمية',
                'accentColor' => '#C9A227',
            ],
            2 => [
                'academyNameEn' => "Al-Furqan Qur'an Academy",
                'academyNameAr' => 'أكاديمية الفرقان لتحفيظ القرآن',
                'titleEn' => 'Certificate of Completion — Juz Amma',
                'titleAr' => 'شهادة إتمام جزء عمّ',
                'presentationEn' => 'Awarded with honour to',
                'presentationAr' => 'تُمنح مع مرتبة الشرف إلى',
                'bodyEn' => 'For the successful memorization and recitation of Juz Amma with excellent tajweed.',
                'bodyAr' => 'لإتمام حفظ جزء عمّ وتلاوته بإتقان وأحكام تجويد ممتازة.',
                'signatoryNameEn' => 'Sheikh Abdullah Al-Masri',
                'signatoryNameAr' => 'الشيخ عبد الله المصري',
                'signatoryTitleEn' => 'Head of Memorization',
                'signatoryTitleAr' => 'رئيس قسم التحفيظ',
                'accentColor' => '#1E6F5C',
            ],
        ];
        foreach ($templates as $num => $content) {
            DB::table('certificate_templates')->updateOrInsert(
                ['academy_id' => self::ACADEMY_ID, 'template_number' => $num],
                ['id' => $this->id('cert:'.$num), 'content' => json_encode($content, JSON_UNESCAPED_UNICODE)]
            );
        }
    }

    // ── trials (lead pipeline) ────────────────────────────────────────────────

    private function seedTrials(): void
    {
        // One converted trial spins up a brand-new REGULAR student (TRIAL → enrolment).
        $convertedStudentId = $this->id('student:s13-noor');
        DB::table('students')->updateOrInsert(
            ['id' => $convertedStudentId],
            [
                'academy_id' => self::ACADEMY_ID,
                'guardian_id' => $this->guardianId('g2'),
                'full_name' => 'Noor Abdelrahman',
                'whatsapp_phone' => '+201101112299',
                'country' => 'EG',
                'status' => 'REGULAR',
                'is_self_guardian' => false,
            ]
        );

        $trials = [
            ['key' => 'lead-zahra', 'teacher' => 0, 'student' => null, 'lead' => ['Zahra Mohammed', '+201112223301', 'zahra@example.com'],
                'at' => '2026-06-24 17:00', 'status' => 'SCHEDULED', 'notes' => null, 'converted' => null, 'dur' => 30],
            ['key' => 'lead-amira', 'teacher' => 2, 'student' => null, 'lead' => ['Amira Hassan', '+201112223302', 'amira@example.com'],
                'at' => '2026-06-25 16:30', 'status' => 'SCHEDULED', 'notes' => null, 'converted' => null, 'dur' => 30],
            ['key' => 'lead-noor', 'teacher' => 2, 'student' => null, 'lead' => ['Noor Abdelrahman', '+201101112299', 'noor@example.com'],
                'at' => '2026-05-28 16:30', 'status' => 'CONVERTED', 'notes' => 'Excellent recitation — enrolled the next day.',
                'converted' => $convertedStudentId, 'dur' => 30],
            ['key' => 'lead-tarek', 'teacher' => 1, 'student' => null, 'lead' => ['Tarek Younis', '+201112223304', null],
                'at' => '2026-06-10 18:00', 'status' => 'NO_SHOW', 'notes' => 'Did not connect; followed up on WhatsApp.', 'converted' => null, 'dur' => 30],
            ['key' => 'lead-hoda', 'teacher' => 3, 'student' => null, 'lead' => ['Hoda Saad', '+201112223305', null],
                'at' => '2026-06-05 11:00', 'status' => 'COMPLETED', 'notes' => 'Good level — deciding on schedule.', 'converted' => null, 'dur' => 45],
            ['key' => 'lead-cancel', 'teacher' => 4, 'student' => null, 'lead' => ['Mostafa Gamal', '+201112223306', null],
                'at' => '2026-06-12 19:00', 'status' => 'CANCELLED', 'notes' => 'Family rescheduled.', 'converted' => null, 'dur' => 30],
        ];
        foreach ($trials as $t) {
            DB::table('trials')->updateOrInsert(
                ['id' => $this->id('trial:'.$t['key'])],
                [
                    'academy_id' => self::ACADEMY_ID,
                    'teacher_id' => $this->teacherId($t['teacher']),
                    'student_id' => $t['student'],
                    'lead_name' => $t['lead'][0],
                    'lead_whatsapp' => $t['lead'][1],
                    'lead_email' => $t['lead'][2],
                    'timezone' => 'Africa/Cairo',
                    'scheduled_at_utc' => $this->ts($t['at']),
                    'duration_minutes' => $t['dur'],
                    'status' => $t['status'],
                    'outcome_notes' => $t['notes'],
                    'converted_student_id' => $t['converted'],
                ]
            );
        }
    }

    // ── progress reports + HR notes on teachers ───────────────────────────────

    private function seedProgressAndTeacherReports(): void
    {
        $reports = [
            ['key' => 'pr1', 'student' => 's1', 'teacher' => 0, 'month' => 5, 'status' => 'APPROVED',
                'title' => 'May progress — Yusuf', 'review' => 'Excellent work, keep it up.',
                'body' => 'Yusuf completed Surah An-Naba and started An-Naziat. Tajweed is markedly stronger, especially the rules of madd. Attendance was perfect this month.'],
            ['key' => 'pr2', 'student' => 's3', 'teacher' => 1, 'month' => 5, 'status' => 'PENDING',
                'title' => 'May progress — Adam', 'review' => null,
                'body' => 'Adam is consolidating Juz Amma. He needs more revision at home but his recitation in class is confident and accurate.'],
            ['key' => 'pr3', 'student' => 's8', 'teacher' => 2, 'month' => 5, 'status' => 'PENDING',
                'title' => 'May progress — Salma', 'review' => null,
                'body' => 'Salma advanced a full Juz this month, ma sha Allah. Recommend moving her to the advanced hifz circle next term.'],
            ['key' => 'pr4', 'student' => 's5', 'teacher' => 0, 'month' => 4, 'status' => 'REJECTED',
                'title' => 'April progress — Omar', 'review' => 'Please add specific surah ranges and resubmit.',
                'body' => 'Omar did well this month.'],
            ['key' => 'pr5', 'student' => 's6', 'teacher' => 3, 'month' => 5, 'status' => 'APPROVED',
                'title' => 'May progress — Hana', 'review' => null,
                'body' => 'Hana is working through the rules of Qira\'at with great curiosity. Her fluency in Al-Mulk is excellent.'],
        ];
        foreach ($reports as $r) {
            $created = $this->ts(sprintf('2026-%02d-30 10:00', $r['month']));
            $decided = in_array($r['status'], ['APPROVED', 'REJECTED'], true)
                ? $this->ts(sprintf('2026-%02d-02 09:30', $r['month'] + 1)) : null;
            DB::table('student_progress_reports')->updateOrInsert(
                ['id' => $this->id('progress:'.$r['key'])],
                [
                    'academy_id' => self::ACADEMY_ID,
                    'student_id' => $this->studentId($r['student']),
                    'teacher_id' => $this->teacherId($r['teacher']),
                    'created_by_user_id' => $this->teacherUserId($r['teacher']),
                    'period_month' => sprintf('2026-%02d-01', $r['month']),
                    'title' => $r['title'],
                    'body' => $r['body'],
                    'status' => $r['status'],
                    'review_note' => $r['review'],
                    'reviewed_by_user_id' => $decided !== null ? self::OWNER_USER_ID : null,
                    'reviewed_at' => $decided,
                    'created_at' => $created,
                    'updated_at' => $decided ?? $created,
                ]
            );
        }

        $hrNotes = [
            ['key' => 'tr1', 'teacher' => 0, 'kind' => 'PRAISE', 'body' => 'Consistently the highest guardian satisfaction scores. Recommended for the senior hifz circle.'],
            ['key' => 'tr2', 'teacher' => 1, 'kind' => 'NOTE', 'body' => 'Requested Thursdays off during Ramadan. Approved.'],
            ['key' => 'tr3', 'teacher' => 4, 'kind' => 'INCIDENT', 'body' => 'Two sessions started late in April. Spoke with him; resolved since.'],
        ];
        foreach ($hrNotes as $n) {
            DB::table('teacher_reports')->updateOrInsert(
                ['id' => $this->id('teacher-report:'.$n['key'])],
                [
                    'academy_id' => self::ACADEMY_ID,
                    'teacher_id' => $this->teacherId($n['teacher']),
                    'author_user_id' => self::OWNER_USER_ID,
                    'author_name' => 'Ibrahim Al-Furqan',
                    'kind' => $n['kind'],
                    'body' => $n['body'],
                    'created_at' => $this->ts('2026-06-15 14:30'),
                    'updated_at' => $this->ts('2026-06-15 14:30'),
                ]
            );
        }
    }

    // ── notifications + cancellation approvals ────────────────────────────────

    private function seedNotificationsAndCancellations(array $sessions): void
    {
        // Owner-facing "report overdue" alerts on a few recent attended sessions.
        $recent = array_values(array_filter($sessions, fn ($r) => $r['status'] === 'ATTENDED' && $r['month'] === 6 && ! $r['future']));
        $names = [];
        foreach ($this->studentDefs() as $s) {
            $names[$s['key']] = $s['name'];
        }
        $teacherName = [];
        foreach ($this->teacherDefs() as $t) {
            $teacherName[$t[0]] = $t[1];
        }
        foreach (array_slice($recent, 0, 3) as $i => $r) {
            $this->insertOnce('notifications', $this->id('notif:'.$r['id']), [
                'academy_id' => self::ACADEMY_ID,
                'type' => 'REPORT_OVERDUE',
                'category' => 'REPORTS',
                'audience_role' => 'ACADEMY_OWNER',
                'recipient_user_id' => null,
                'session_id' => $r['id'],
                'data' => json_encode([
                    'student_name' => $names[$r['student']],
                    'teacher_name' => $teacherName[$r['teacher']],
                    'teacher_id' => $r['teacher_id'],
                    'scheduled_at_utc' => $r['at_utc'],
                    'duration_minutes' => $r['dur'],
                    'session_status' => $r['status'],
                ]),
                'read_at' => $i === 0 ? $this->ts('2026-06-20 09:00') : null,
                'created_at' => $this->ts($r['local_date'].' 22:00'),
            ]);
        }

        // Cancellation requests in each state, tied to real cancelled/attended sessions.
        $cancelSrc = array_values(array_filter($sessions, fn ($r) => in_array($r['status'], ['CANCELLED_BY_TEACHER', 'CANCELLED_BY_STUDENT'], true) && $r['month'] >= 5 && ! $r['future']));
        $states = [
            ['status' => 'PENDING', 'note' => null, 'reason' => 'Student was absent — requesting no charge.'],
            ['status' => 'APPROVED', 'note' => 'Approved — no charge to the family.', 'reason' => 'Teacher unwell.'],
            ['status' => 'REJECTED', 'note' => 'Rejected — under 24h notice, lesson billed.', 'reason' => 'Family travelling.'],
        ];
        foreach (array_slice($cancelSrc, 0, 3) as $i => $r) {
            $state = $states[$i];
            $decidedAt = $state['status'] !== 'PENDING' ? $this->ts($r['local_date'].' 12:00') : null;
            $this->insertOnce('session_cancellation_requests', $this->id('cancelreq:'.$r['id']), [
                'academy_id' => self::ACADEMY_ID,
                'session_id' => $r['id'],
                'teacher_id' => $r['teacher_id'],
                'requested_by_user_id' => $this->teacherUserId($r['teacher']),
                'cancel_type' => $r['status'] === 'CANCELLED_BY_TEACHER' ? 'teacher' : 'student',
                'reason' => $state['reason'],
                'status' => $state['status'],
                'decided_by_user_id' => $decidedAt !== null ? self::OWNER_USER_ID : null,
                'decided_at' => $decidedAt,
                'decision_note' => $state['note'],
                'created_at' => $this->ts($r['local_date'].' 10:00'),
                'updated_at' => $decidedAt ?? $this->ts($r['local_date'].' 10:00'),
            ]);
        }
    }

    // ── automation (WhatsApp) settings + send log ─────────────────────────────

    private function seedAutomation(array $sessions): void
    {
        DB::table('academy_automation_settings')->updateOrInsert(
            ['academy_id' => self::ACADEMY_ID],
            [
                'id' => $this->id('automation-settings'),
                'wasender_token' => Crypt::encryptString('demo-gateway-token-alfurqan'),
                'wasender_session_status' => 'CONNECTED',
                'wa_session_id' => 'alfurqan-demo-session',
                'type1_billing_enabled' => true,
                'type2_lessons_enabled' => true,
                'type1_config' => json_encode(new \stdClass),
                'type2_config' => json_encode(new \stdClass),
            ]
        );

        // Invoice reminders (TYPE1) — one per recent AUTO invoice.
        $invoices = DB::table('invoices')
            ->where('academy_id', self::ACADEMY_ID)
            ->where('kind', 'AUTO')
            ->whereIn('period_month', [5, 6])
            ->get(['id', 'guardian_id', 'period_month']);
        foreach ($invoices as $inv) {
            $guardian = DB::table('guardians')->where('id', $inv->guardian_id)->first(['whatsapp_phone']);
            $sentDay = sprintf('2026-%02d-01 09:05', $inv->period_month);
            $this->logSend('type1:'.$inv->id, [
                'automation_type' => 'TYPE1_BILLING',
                'transport' => 'WASENDER',
                'recipient_kind' => 'GUARDIAN',
                'recipient_id' => $inv->guardian_id,
                'recipient_phone' => $guardian->whatsapp_phone ?? null,
                'template_key' => 'TYPE1_BILL',
                'ref_type' => 'invoice',
                'ref_id' => $inv->id,
                'status' => 'SENT',
                'provider_message_id' => 'wamid.'.substr(md5('t1'.$inv->id), 0, 18),
                'dedupe_key' => 'type1:'.$inv->id.':2026-'.sprintf('%02d', $inv->period_month),
                'at' => $sentDay,
            ]);
        }

        // Lesson reminders (TYPE2) for upcoming/recent sessions — student + teacher legs,
        // with a realistic mix of SENT / SKIPPED / FAILED.
        $reminderSrc = array_values(array_filter($sessions, fn ($r) => $r['month'] === 6 && in_array($r['status'], ['ATTENDED', 'SCHEDULED'], true)));
        foreach (array_slice($reminderSrc, 0, 14) as $i => $r) {
            $h = abs(crc32('t2'.$r['id']));
            $status = match ($h % 10) {
                7, 8 => 'SKIPPED',
                9 => 'FAILED',
                default => 'SENT',
            };
            $at = CarbonImmutable::parse($r['at_utc'], 'UTC')->subHours(2)->toDateTimeString();
            $this->logSend('type2:'.$r['id'].':student', [
                'automation_type' => 'TYPE2_LESSON',
                'transport' => $status === 'SKIPPED' ? 'DEEPLINK' : 'WASENDER',
                'recipient_kind' => 'STUDENT',
                'recipient_id' => $r['student_id'],
                'recipient_phone' => $status === 'FAILED' ? null : '+201101112'.str_pad((string) (200 + $i), 3, '0', STR_PAD_LEFT),
                'template_key' => 'TYPE2_REMINDER',
                'ref_type' => 'session',
                'ref_id' => $r['id'],
                'status' => $status,
                'error' => $status === 'FAILED' ? 'No phone number on file' : null,
                'provider_message_id' => $status === 'SENT' ? 'wamid.'.substr(md5('t2s'.$r['id']), 0, 18) : null,
                'dedupe_key' => 'type2:'.$r['id'].':student',
                'at' => $at,
            ]);
        }
    }

    private function logSend(string $seed, array $row): void
    {
        $this->insertOnce('automation_send_log', $this->id('send:'.$seed), array_merge([
            'academy_id' => self::ACADEMY_ID,
            'channel' => 'WHATSAPP',
            'recipient_id' => null,
            'recipient_phone' => null,
            'template_key' => null,
            'ref_type' => null,
            'ref_id' => null,
            'error' => null,
            'provider_message_id' => null,
            'dedupe_key' => null,
            'created_at' => $this->ts($row['at']),
            'updated_at' => $this->ts($row['at']),
        ], array_diff_key($row, ['at' => null]), ['created_at' => $this->ts($row['at']), 'updated_at' => $this->ts($row['at'])]));
    }

    // ── academy payment settings (how families pay the academy) ───────────────

    private function seedPaymentSettings(): void
    {
        $methods = [
            ['method' => 'BANK_TRANSFER', 'is_active' => true, 'config' => ['bank_name' => 'CIB', 'account_holder' => "Al-Furqan Academy", 'account_number' => '100012345678', 'iban' => 'EG380003000100012345678901']],
            ['method' => 'PAYPAL', 'is_active' => true, 'config' => ['email' => 'payments@alfurqan.demo', 'mode' => 'live']],
            ['method' => 'XPAY', 'is_active' => false, 'config' => new \stdClass],
        ];
        foreach ($methods as $row) {
            DB::table('academy_payment_settings')->updateOrInsert(
                ['academy_id' => self::ACADEMY_ID, 'method' => $row['method']],
                [
                    'id' => $this->id('paysetting:'.$row['method']),
                    'is_active' => $row['is_active'],
                    'config' => json_encode($row['config'], JSON_UNESCAPED_UNICODE),
                ]
            );
        }
    }

    // ── platform billing (the academy's own SaaS subscription) ────────────────

    private function seedPlatformBilling(): void
    {
        $proPlanId = DB::table('plans')->where('code', 'PRO')->value('id');

        DB::table('academy_subscriptions')->updateOrInsert(
            ['academy_id' => self::ACADEMY_ID],
            [
                'id' => $this->id('academy-sub'),
                'plan_id' => $proPlanId,
                'status' => 'ACTIVE',
                'is_trial' => false,
                'activated_at' => $this->ts('2026-01-15 10:00'),
                'current_period_start' => $this->ts('2026-06-01 00:00'),
                'current_period_end' => $this->ts('2026-07-01 00:00'),
                'billing_interval' => 'MONTHLY',
                'base_price_minor' => 99900,
                'addons_price_minor' => 0,
                'total_cost_minor' => 99900,
                'currency' => 'EGP',
            ]
        );

        $subId = $this->id('academy-sub');
        foreach ([2, 3, 4, 5, 6] as $month) {
            $invId = $this->id('academy-invoice:'.$month);
            $periodStart = sprintf('2026-%02d-01', $month);
            $periodEnd = sprintf('2026-%02d-01', $month + 1);
            $issuedAt = $this->ts($periodStart.' 00:05');
            $isPaid = $month < 6;
            $this->insertOnce('academy_invoices', $invId, [
                'academy_id' => self::ACADEMY_ID,
                'subscription_id' => $subId,
                'period_start' => $periodStart,
                'period_end' => $periodEnd,
                'status' => $isPaid ? 'PAID' : 'OPEN',
                'currency' => 'EGP',
                'subtotal_minor' => 99900,
                'total_minor' => 99900,
                'amount_paid_minor' => $isPaid ? 99900 : 0,
                'due_date' => sprintf('2026-%02d-07', $month),
                'issued_at' => $issuedAt,
                'paid_at' => $isPaid ? $this->ts(sprintf('2026-%02d-03 11:00', $month)) : null,
                'payment_method' => $isPaid ? 'INSTAPAY' : null,
                'public_token' => $this->token('academy-invoice:'.$month),
                'sent_at' => $issuedAt,
                'sent_channel' => 'WHATSAPP',
                'reminder_count' => 0,
                'created_at' => $issuedAt,
                'updated_at' => $issuedAt,
            ]);
        }

        // A pending payment proof on the current (June) platform invoice — to show the review queue.
        $this->insertOnce('academy_payment_submissions', $this->id('academy-paysub'), [
            'academy_invoice_id' => $this->id('academy-invoice:6'),
            'academy_id' => self::ACADEMY_ID,
            'method' => 'INSTAPAY',
            'screenshot_path' => 'payment-proofs/alfurqan-2026-06.jpg',
            'amount_minor' => 99900,
            'note' => 'Paid via InstaPay on the 2nd.',
            'review_status' => 'PENDING',
            'created_at' => $this->ts('2026-06-02 13:00'),
            'updated_at' => $this->ts('2026-06-02 13:00'),
        ]);
    }

    // ── audit log (a handful of representative entries) ───────────────────────

    private function seedAuditLog(): void
    {
        $entries = [
            ['action' => 'student.created', 'entity' => 'student', 'eid' => $this->studentId('s1'), 'at' => '2026-02-01 09:10', 'after' => ['full_name' => 'Yusuf Mahmoud']],
            ['action' => 'invoice.paid', 'entity' => 'invoice', 'eid' => $this->id('invoice:g1:3'), 'at' => '2026-04-05 12:00', 'after' => ['status' => 'PAID']],
            ['action' => 'payout.finalized', 'entity' => 'payout', 'eid' => $this->id('payout:0:4'), 'at' => '2026-05-03 10:00', 'after' => ['status' => 'FINALIZED']],
            ['action' => 'student.graduated', 'entity' => 'student', 'eid' => $this->studentId('s11'), 'at' => '2026-04-28 18:00', 'after' => ['status' => 'GRADUATED']],
            ['action' => 'role.assigned', 'entity' => 'user_role', 'eid' => self::OWNER_USER_ID, 'at' => '2026-01-12 09:05', 'after' => ['role' => 'ACADEMY_OWNER']],
        ];
        foreach ($entries as $e) {
            $id = $this->id('audit:'.$e['action'].':'.$e['eid']);
            $this->insertOnce('audit_log', $id, [
                'academy_id' => self::ACADEMY_ID,
                'actor_user_id' => self::OWNER_USER_ID,
                'actor_role' => 'ACADEMY_OWNER',
                'action' => $e['action'],
                'entity_type' => $e['entity'],
                'entity_id' => $e['eid'],
                'after' => json_encode($e['after']),
                'created_at' => $this->ts($e['at']),
            ]);
        }
    }
}
