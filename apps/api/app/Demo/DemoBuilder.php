<?php

declare(strict_types=1);

namespace App\Demo;

use App\Enums\SessionStatus;
use App\Services\AttendanceService;
use App\Services\GroupBilling;
use App\Services\GroupLessonGenerator;
use App\Services\Invoicing;
use App\Services\ModuleBilling;
use App\Services\Payroll;
use App\Services\SessionGenerator;
use App\Support\AcademyProfile;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\PermissionCatalog;
use App\Support\PublicInvoiceToken;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Arr;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/**
 * Builds ONE demo academy by living through its last few months, a day at a time.
 *
 * Nothing financial is written by hand. The builder sets the clock to a morning three months ago,
 * enrols the students, and then walks forward to today doing what the academy and the scheduler
 * would have done on each day — roll the timetable, mark each lesson, raise the month's group
 * charges, close last month's bills on the 2nd, seal the salaries on the 3rd, take the payments —
 * through the same services the app itself calls. So every bill, package, receipt and salary
 * statement is one the system produced, and they agree with each other the way real ones do.
 *
 * The whole build is one transaction inside the academy's own tenant context: a failure leaves
 * nothing behind, and no row of any other academy can be reached.
 */
abstract class DemoBuilder
{
    public const TZ = 'Africa/Cairo';

    public const CURRENCY = 'EGP';

    /** A lesson left without a mark in the last days, so the overdue tab has something in it. */
    private const UNMARKED_WINDOW_DAYS = 4;

    private const UNMARKED_EVERY = 7;

    /**
     * Tables whose `created_at` falls back to the database clock. The services stamp everything
     * else from the application clock, which the build moves; these would all read "created just
     * now", so each day's rows are put back on the day they belong to.
     */
    private const DB_STAMPED = [
        'notifications', 'schedules', 'schedule_slots', 'student_teacher_assignments',
        'subscriptions', 'users', 'user_roles', 'teacher_student_rates', 'trials', 'session_reports',
        'session_cancellation_requests', 'class_groups', 'class_group_slots', 'class_group_members',
        'class_group_lessons', 'class_group_attendance', 'cash_accounts', 'cash_transfers', 'expenses',
        'expense_categories', 'receipts', 'receipt_allocations', 'academy_rooms', 'academy_levels',
        'specializations', 'report_field_definitions', 'lesson_package_credits',
    ];

    /**
     * Tables the build reads over and over while it fills them. On a database that starts empty the
     * planner still believes they are empty — the rows are this transaction's own, which autovacuum
     * cannot see — and joins them the slow way; {@see tune()} tells it otherwise.
     */
    private const HOT = [
        'students', 'guardians', 'teachers', 'subscriptions', 'student_teacher_assignments', 'schedules', 'schedule_slots',
        'sessions', 'session_reports', 'invoices', 'invoice_line_items', 'payouts', 'payout_line_items', 'lesson_packages',
        'lesson_package_credits', 'receipts', 'receipt_allocations', 'class_groups', 'class_group_members',
        'class_group_lessons', 'class_group_attendance', 'centre_subscriptions', 'centre_subscription_lessons',
        'notifications', 'audit_log', 'expenses',
    ];

    /** The instant the build really runs at (UTC). Nothing is ever dated after it. */
    protected CarbonImmutable $realNow;

    /** Today and the first day of the history, as academy-local midnights. */
    protected CarbonImmutable $today;

    protected CarbonImmutable $start;

    protected string $ownerId;

    protected string $passwordHash;

    /** @var array<string, array<string, mixed>> teachers by key */
    protected array $teachers = [];

    /** @var array<string, string> teacher id → user id */
    protected array $teacherUsers = [];

    /** @var array<string, array<string, mixed>> guardians by key */
    protected array $guardians = [];

    /** @var array<string, array<string, mixed>> students by key */
    protected array $students = [];

    /** @var list<string> things a service refused during the build */
    protected array $warnings = [];

    /** @var array<string, list<array{0: CarbonImmutable, 1: callable}>> planned events by local date */
    private array $story = [];

    private int $recentLessons = 0;

    private int $phones = 0;

    /** @var list<string>|null */
    private ?array $stampable = null;

    private ?bool $smallDatabase = null;

    public function __construct(
        protected readonly string $academyId,
        CarbonImmutable $now,
        int $months,
    ) {
        DemoAcademies::assertOwn($academyId);

        $this->realNow = $now->utc();
        $this->today = $now->setTimezone(self::TZ)->startOfDay();
        $this->start = $this->today->startOfMonth()->subMonthsNoOverflow(max(1, $months));
        $this->ownerId = (string) Str::uuid();
        $this->passwordHash = Hash::make(DemoAcademies::PASSWORD);
    }

    // ── What each academy says about itself ──────────────────────────────────

    /** @return array{profile: string, name: string, brand: string, subdomain: string, owner_name: string, owner_email: string, phone_base: int} */
    abstract protected function identity(): array;

    /** Everything that exists on the first morning: courses, teachers, families, timetables. */
    abstract protected function open(): void;

    /** The office's work on one day, as `[when, fn]` events (payments, renewals, expenses). */
    abstract protected function officeDay(CarbonImmutable $day): array;

    /** The last touches, made at the real present. */
    abstract protected function close(): void;

    /** @return array<string, int> the counts printed at the end */
    abstract protected function counts(): array;

    /** Called after a private lesson is marked attended (the Quran academy writes its report). */
    protected function afterAttended(object $session): void {}

    /** A student who never misses — one whose package the story needs to run out on time. */
    protected function alwaysAttends(object $session): bool
    {
        return false;
    }

    // ── The build ────────────────────────────────────────────────────────────

    /** @return array{counts: array<string, int>, warnings: list<string>} */
    public function build(): array
    {
        $clock = Carbon::hasTestNow() ? Carbon::getTestNow() : null;
        $had = app()->bound(AuthContext::class) ? rescue(fn () => app(AuthContext::class), null, false) : null;

        // Some services ask the container who is acting; the build acts as the academy's owner.
        app()->instance(AuthContext::class, new AuthContext(
            userId: $this->ownerId,
            academyId: $this->academyId,
            role: 'ACADEMY_OWNER',
            permissions: PermissionCatalog::roleMap()['ACADEMY_OWNER'],
        ));

        try {
            return DB::transaction(function (): array {
                // SUPER_ADMIN inside this one academy: admitted to create the academies row, and
                // every tenant policy pins the writes to this academy id.
                TenantContext::apply(userId: $this->ownerId, academyId: $this->academyId, role: 'SUPER_ADMIN', local: true);

                // The day before the history starts: the academy is set up, its people entered.
                $this->travel($this->start->subDay()->setTime(10, 0));
                $this->createAcademy();
                $this->open();
                $this->stamp();
                $this->tune();

                for ($day = $this->start; $day->lessThanOrEqualTo($this->today); $day = $day->addDay()) {
                    $this->liveDay($day);
                    if ($day->dayOfWeek === 0) {
                        $this->tune();
                    }
                }

                Carbon::setTestNow($this->realNow);
                $this->roll();
                $this->close();
                $this->stamp();

                return ['counts' => $this->counts(), 'warnings' => $this->warnings];
            });
        } finally {
            Carbon::setTestNow($clock);
            if ($had !== null) {
                app()->instance(AuthContext::class, $had);
            } else {
                app()->forgetInstance(AuthContext::class);
            }
        }
    }

    private function liveDay(CarbonImmutable $day): void
    {
        // The scheduler's nights, as routes/console.php runs them. Its clock is the server's (UTC),
        // so 00:30 there is a few hours into the academy's day — never the evening before.
        if ($day->day === 1 || $day->equalTo($this->start)) {
            $this->at($day->setTime(3, 30), fn () => $this->roll());
            $this->at($day->setTime(3, 40), fn () => app(Payroll::class)->openFixedSalaryPayouts($this->academyId));
            $this->at($day->setTime(3, 45), fn () => $this->billGroupMonths());
        }
        $last = $day->subMonthNoOverflow();
        if ($day->day === 2) {
            $this->at($day->setTime(4, 0), fn () => app(Invoicing::class)->closePeriodInvoices(
                $this->academyId, $last->year, $last->month, Audit::SYSTEM_ACTOR_ID, 'SUPER_ADMIN'));
        }
        if ($day->day === 3) {
            $this->at($day->setTime(4, 30), fn () => app(Payroll::class)->finalizePeriodPayouts(
                $this->academyId, $last->year, $last->month, Audit::SYSTEM_ACTOR_ID, 'SUPER_ADMIN'));
        }

        $events = array_merge(
            $this->story[$day->toDateString()] ?? [],
            $this->officeDay($day),
            $this->lessonEvents($day),
        );
        unset($this->story[$day->toDateString()]);
        usort($events, fn (array $a, array $b): int => $a[0] <=> $b[0]);

        foreach ($events as [$when, $fn]) {
            $this->at($when, $fn);
        }

        $this->stamp();
    }

    /** Plan something for a day still to come: `$fn` runs when the clock reaches `$when`. */
    protected function plan(CarbonImmutable $when, callable $fn): void
    {
        $when = $when->setTimezone(self::TZ);
        if ($when->lessThan($this->start)) {
            $when = $this->start->setTime(9, 0);
        }
        $this->story[$when->toDateString()][] = [$when, $fn];
    }

    /**
     * Move the clock to `$when` and do `$fn` — unless that moment has not happened yet. A refusal
     * from a service (a 422) undoes that one step and is reported; anything else stops the build.
     */
    protected function at(CarbonImmutable $when, callable $fn): bool
    {
        if (! $this->travel($when)) {
            return false;
        }

        try {
            DB::transaction($fn);
        } catch (ValidationException $e) {
            $this->warn($when->setTimezone(self::TZ)->format('Y-m-d H:i').' — '.implode(' ', Arr::flatten($e->errors())));
        }

        return true;
    }

    private function travel(CarbonImmutable $when): bool
    {
        if ($when->utc()->greaterThan($this->realNow)) {
            return false;
        }
        Carbon::setTestNow($when->utc());

        return true;
    }

    /** Note something that did not go as planned; said once however often it happens. */
    protected function warn(string $message): void
    {
        if (! in_array($message, $this->warnings, true)) {
            $this->warnings[] = $message;
        }
    }

    protected function now(): CarbonImmutable
    {
        return CarbonImmutable::now(self::TZ);
    }

    // ── The scheduler's work ─────────────────────────────────────────────────

    /** The nightly roll: this month and the next, for private timetables and for groups. */
    private function roll(): void
    {
        [$from, $to] = SessionGenerator::defaultWindow();
        app(SessionGenerator::class)->generateForAcademy($this->academyId, $from, $to);
        if (GroupLessonGenerator::enabledFor($this->academyId)) {
            app(GroupLessonGenerator::class)->generateForAcademy($this->academyId, $from, $to);
        }
    }

    /** One month's up-front charge for every member of every monthly group (BillGroupMonthsJob). */
    private function billGroupMonths(): void
    {
        if (! GroupLessonGenerator::enabledFor($this->academyId) || ! GroupBilling::enabledFor($this->academyId)) {
            return;
        }
        $billing = app(GroupBilling::class);
        $groups = DB::table('class_groups')
            ->where('academy_id', $this->academyId)->where('status', 'ACTIVE')
            ->where('billing_mode', GroupBilling::MONTHLY)->whereNotNull('price_minor')
            ->get();

        foreach ($groups as $group) {
            if (GroupBilling::byHours($group)) {
                $billing->billHourMonths($group);

                continue;
            }
            $today = Carbon::now((string) $group->timezone);
            $billing->billMonth($group, (int) $today->year, (int) $today->month);
        }
    }

    // ── Lessons ──────────────────────────────────────────────────────────────

    /**
     * The day's private lessons, each marked a few minutes after it ends.
     *
     * @return list<array{0: CarbonImmutable, 1: callable}>
     */
    protected function lessonEvents(CarbonImmutable $day): array
    {
        $rows = DB::table('sessions')
            ->where('academy_id', $this->academyId)
            ->where('status', 'SCHEDULED')
            ->whereNull('hidden_at')
            ->where('scheduled_at_utc', '>=', $day->utc()->format('Y-m-d H:i:sP'))
            ->where('scheduled_at_utc', '<', $day->addDay()->utc()->format('Y-m-d H:i:sP'))
            ->orderBy('scheduled_at_utc')->orderBy('id')
            ->get(['id', 'scheduled_at_utc', 'duration_minutes']);

        $events = [];
        foreach ($rows as $row) {
            $end = CarbonImmutable::parse($row->scheduled_at_utc)->addMinutes((int) $row->duration_minutes);
            if ($this->leftUnmarked($day, $end)) {
                continue;
            }
            $id = (string) $row->id;
            $events[] = [$end->addMinutes(2 + $this->roll100("mark:{$id}") % 20)->setTimezone(self::TZ), fn () => $this->markLesson($id)];
        }

        return $events;
    }

    /** Is this lesson one of the few nobody marked? Only lately, and only once it is overdue. */
    protected function leftUnmarked(CarbonImmutable $day, CarbonImmutable $end): bool
    {
        if ($day->lessThan($this->today->subDays(self::UNMARKED_WINDOW_DAYS)) || $end->addHours(4)->greaterThan($this->realNow)) {
            return false;
        }

        return ++$this->recentLessons % self::UNMARKED_EVERY === 0;
    }

    private function markLesson(string $sessionId): void
    {
        $session = DB::table('sessions')->where('id', $sessionId)->where('academy_id', $this->academyId)->first();
        if ($session === null || $session->status !== 'SCHEDULED') {
            return;
        }

        $attendance = app(AttendanceService::class);
        $teacherUser = $this->teacherUsers[(string) $session->teacher_id] ?? null;
        $roll = $this->alwaysAttends($session) ? 0 : $this->roll100("outcome:{$sessionId}");

        if ($roll < 91) {
            // The teacher marks their own lesson, as they do every evening.
            $attendance->record($session, SessionStatus::Attended, null, $teacherUser ?? $this->ownerId, $teacherUser !== null ? 'TEACHER' : 'ACADEMY_OWNER');
            $this->afterAttended(DB::table('sessions')->where('id', $sessionId)->first());
        } elseif ($roll < 93) {
            // Cancelled too late to give the hour to anyone else: the office counts it, the teacher gets half.
            $attendance->record($session, SessionStatus::CancelledByStudent, 'اعتذار قبل الحصة بأقل من ساعة — تُحتسب الحصة',
                $this->ownerId, 'ACADEMY_OWNER', true, true, 5000);
        } elseif ($roll < 97) {
            $attendance->record($session, SessionStatus::CancelledByStudent, $this->pick("why:{$sessionId}", DemoData::STUDENT_CANCEL_REASONS),
                $this->ownerId, 'ACADEMY_OWNER');
        } else {
            $attendance->record($session, SessionStatus::CancelledByTeacher, $this->pick("why:{$sessionId}", DemoData::TEACHER_CANCEL_REASONS),
                $this->ownerId, 'ACADEMY_OWNER');
        }

        $this->stamp(['notifications']);
    }

    // ── Creating the academy and its people ──────────────────────────────────

    private function createAcademy(): void
    {
        $me = $this->identity();
        $type = DB::table('academy_types')->where('code', $me['profile'])->first(['id', 'report_field_template']);
        if ($type === null) {
            throw new RuntimeException("The {$me['profile']} academy type does not exist on this database — run the migrations and the platform seeders first.");
        }

        $this->phones = $me['phone_base'];
        $now = $this->ts();

        DB::table('academies')->insert([
            'id' => $this->academyId,
            'name' => $me['name'],
            'academy_type_id' => $type->id,
            'client_type' => 'MANAGEMENT',
            'status' => 'ACTIVE',
            'plan_id' => null,
            'default_currency' => self::CURRENCY,
            'timezone' => self::TZ,
            'country' => 'EG',
            'invoice_grouping' => 'PER_GUARDIAN',
            'billing_day' => 1,
            'brand_display_name' => $me['brand'],
            'subdomain' => $me['subdomain'],
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        Audit::log('academy.create', 'academy', $this->academyId, $this->academyId, null, 'SUPER_ADMIN', after: [
            'name' => $me['name'], 'profile' => $me['profile'], 'source' => 'demo:academies',
        ]);

        foreach (array_values(json_decode((string) $type->report_field_template, true) ?: []) as $i => $field) {
            DB::table('report_field_definitions')->insert([
                'id' => (string) Str::uuid(),
                'academy_id' => $this->academyId,
                'key' => $field['key'],
                'label_ar' => $field['label_ar'] ?? $field['key'],
                'label_en' => $field['label_en'] ?? $field['key'],
                'field_type' => $field['field_type'] ?? 'TEXT',
                'options' => isset($field['options']) ? json_encode($field['options'], JSON_UNESCAPED_UNICODE) : null,
                'sort_order' => $i + 1,
                'is_required' => $field['is_required'] ?? false,
                'is_active' => true,
            ]);
        }

        $this->addUser($me['owner_name'], $me['owner_email'], 'ACADEMY_OWNER', $this->ownerId);

        // The management module, switched on the way the Super Admin's wizard does it: live and
        // paid (never a trial), then the profile's preset on top. The period is pushed far ahead
        // and the price left at zero, so nothing ever lapses and nothing is owed to the platform.
        $modules = app(ModuleBilling::class);
        $modules->enable($this->academyId, 'MANAGEMENT', trial: false, priceMinor: 0, currency: self::CURRENCY, interval: 'YEARLY');
        AcademyProfile::applyPreset($modules, $this->academyId, $me['profile']);
        $modules->setFields($this->academyId, 'MANAGEMENT', [
            'current_period_end' => $this->realNow->addYears(10)->format('Y-m-d H:i:sP'),
        ]);
    }

    protected function addUser(string $name, string $email, string $role, ?string $id = null): string
    {
        $id ??= (string) Str::uuid();
        $now = $this->ts();

        DB::table('users')->insert([
            'id' => $id,
            'academy_id' => $this->academyId,
            'full_name' => $name,
            'email' => $email,
            'password' => $this->passwordHash,
            'is_active' => true,
            'email_verified_at' => $now,
            'invited_at' => $now,
            'preferred_locale' => 'ar',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        DB::table('user_roles')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $id,
            'academy_id' => $this->academyId,
            'role' => $role,
        ]);

        return $id;
    }

    /**
     * @param  array{name: string, email: string, specialization: string, pay_type?: string, rate?: int, salary?: int, days?: list<int>}  $t
     */
    protected function addTeacher(string $key, array $t): string
    {
        $id = (string) Str::uuid();
        $userId = $this->addUser($t['name'], $t['email'], 'TEACHER');
        $now = $this->ts();

        DB::table('teachers')->insert([
            'id' => $id,
            'academy_id' => $this->academyId,
            'user_id' => $userId,
            'full_name' => $t['name'],
            'phone' => $this->phone(),
            'specialization' => $t['specialization'],
            'pay_type' => $t['pay_type'] ?? 'HOURLY',
            'session_rate_minor' => $t['rate'] ?? 0,
            'fixed_salary_minor' => $t['salary'] ?? 0,
            'currency' => self::CURRENCY,
            'timezone' => self::TZ,
            'is_active' => true,
            'availability' => json_encode(array_map(
                fn (int $weekday): array => ['weekday' => $weekday, 'start_local' => $weekday === 5 ? '09:00' : '15:00', 'end_local' => $weekday === 5 ? '13:00' : '22:00'],
                $t['days'] ?? [0, 1, 2, 3, 4, 6],
            )),
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        Audit::log('teacher.create', 'teacher', $id, $this->academyId, $this->ownerId, 'ACADEMY_OWNER', after: ['full_name' => $t['name']]);

        $this->teachers[$key] = $t + ['id' => $id, 'user_id' => $userId];
        $this->teacherUsers[$id] = $userId;

        return $id;
    }

    protected function addStaff(string $name, string $department, int $salaryMinor, ?string $notes = null, ?string $userId = null): string
    {
        $id = (string) Str::uuid();
        $now = $this->ts();

        DB::table('staff')->insert([
            'id' => $id,
            'academy_id' => $this->academyId,
            'user_id' => $userId,
            'full_name' => $name,
            'department' => $department,
            'phone' => $this->phone(),
            'salary_minor' => $salaryMinor,
            'currency' => self::CURRENCY,
            'notes' => $notes,
            'is_active' => true,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return $id;
    }

    protected function addGuardian(string $key, string $name, ?string $notes = null): string
    {
        if (isset($this->guardians[$key])) {
            return $this->guardians[$key]['id'];
        }

        $id = (string) Str::uuid();
        $now = $this->ts();
        DB::table('guardians')->insert([
            'id' => $id,
            'academy_id' => $this->academyId,
            'full_name' => $name,
            'whatsapp_phone' => $this->phone(),
            'country' => 'EG',
            'currency' => self::CURRENCY,
            'notes' => $notes,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $this->guardians[$key] = ['id' => $id, 'name' => $name, 'key' => $key];

        return $id;
    }

    /** @param  array<string, mixed>  $extra  columns over the defaults (level_id, notes, is_self_guardian…) */
    protected function addStudent(string $key, string $name, string $guardianKey, array $extra = []): string
    {
        $id = (string) Str::uuid();
        $now = $this->ts();

        DB::table('students')->insert($extra + [
            'id' => $id,
            'academy_id' => $this->academyId,
            'guardian_id' => $this->guardians[$guardianKey]['id'],
            'full_name' => $name,
            'whatsapp_phone' => $this->phone(),
            'country' => 'EG',
            'status' => 'REGULAR',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        Audit::log('student.create', 'student', $id, $this->academyId, $this->ownerId, 'ACADEMY_OWNER', after: [
            'full_name' => $name, 'guardian_id' => $this->guardians[$guardianKey]['id'],
        ]);

        $this->students[$key] = ['id' => $id, 'name' => $name, 'guardian' => $guardianKey, 'key' => $key];

        return $id;
    }

    protected function linkTeacher(string $studentId, string $teacherId, ?string $course): void
    {
        DB::table('student_teacher_assignments')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $this->academyId,
            'student_id' => $studentId,
            'teacher_id' => $teacherId,
            'course' => $course,
            'started_at' => $this->ts(),
            'ended_at' => null,
        ]);
    }

    /** The student's monthly terms — the row StudentController::writeSubscription writes. */
    protected function addSubscription(string $studentId, string $label, string $basis, int $priceMinor, string $startDate, ?int $perMonth = null, ?int $lessonMinutes = null): void
    {
        $id = (string) Str::uuid();
        DB::table('subscriptions')->insert([
            'id' => $id,
            'academy_id' => $this->academyId,
            'student_id' => $studentId,
            'plan_label' => $label,
            'sessions_per_month' => $perMonth,
            'lesson_minutes' => $lessonMinutes,
            'price_minor' => $priceMinor,
            'currency' => self::CURRENCY,
            'price_basis' => $basis,
            'status' => 'ACTIVE',
            'start_date' => $startDate,
        ]);
        Audit::log('subscription.set', 'subscription', $id, $this->academyId, $this->ownerId, 'ACADEMY_OWNER', after: [
            'price_minor' => $priceMinor, 'currency' => self::CURRENCY, 'price_basis' => $basis,
        ]);
    }

    /**
     * A weekly timetable with one teacher, and its lessons from `$startDate` on.
     *
     * @param  list<array{0: int, 1: string}>  $slots  [weekday (0 = Sunday … 6 = Saturday), 'HH:MM']
     */
    protected function addSchedule(string $studentId, string $teacherId, array $slots, int $minutes, string $startDate, ?string $course = null): string
    {
        $id = (string) Str::uuid();
        DB::table('schedules')->insert([
            'id' => $id,
            'academy_id' => $this->academyId,
            'student_id' => $studentId,
            'teacher_id' => $teacherId,
            'timezone' => self::TZ,
            'start_date' => $startDate,
            'is_active' => true,
            'version' => 1,
        ]);
        foreach ($slots as [$weekday, $time]) {
            DB::table('schedule_slots')->insert([
                'id' => (string) Str::uuid(),
                'academy_id' => $this->academyId,
                'schedule_id' => $id,
                'weekday' => $weekday,
                'start_time_local' => $time.':00',
                'duration_minutes' => $minutes,
                'course' => $course,
            ]);
        }

        [$from, $to] = SessionGenerator::defaultWindow();
        app(SessionGenerator::class)->generateForSchedule($id, $from, $to, null, Carbon::parse($startDate, self::TZ)->startOfDay());

        return $id;
    }

    /** A bill written by hand (registration, books), the way the invoices page's quick bill makes one. */
    protected function quickBill(string $studentKey, string $description, int $amountMinor): string
    {
        $student = $this->students[$studentKey];
        $now = $this->now();
        $id = (string) Str::uuid();

        DB::table('invoices')->insert([
            'id' => $id,
            'academy_id' => $this->academyId,
            'kind' => 'MANUAL',
            'hand_made' => true,
            'guardian_id' => $this->guardians[$student['guardian']]['id'],
            'student_id' => null,
            'period_year' => $now->year,
            'period_month' => $now->month,
            'status' => 'OPEN',
            'currency' => self::CURRENCY,
            'subtotal_minor' => $amountMinor,
            'total_minor' => $amountMinor,
            'public_token' => PublicInvoiceToken::forAcademyId($this->academyId),
            'created_at' => $this->ts(),
            'updated_at' => $this->ts(),
        ]);
        DB::table('invoice_line_items')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $this->academyId,
            'invoice_id' => $id,
            'session_id' => null,
            'student_id' => $student['id'],
            'description' => $description,
            'amount_minor' => $amountMinor,
            'currency' => self::CURRENCY,
            'session_date' => $now->toDateString(),
            'created_at' => $this->ts(),
        ]);
        Audit::log('invoice.created', 'invoice', $id, $this->academyId, $this->ownerId, 'ACADEMY_OWNER', after: [
            'kind' => 'MANUAL', 'total_minor' => $amountMinor, 'description' => $description,
        ]);

        return $id;
    }

    // ── Small tools ──────────────────────────────────────────────────────────

    /**
     * An instant as Postgres must be told it: with its offset. A bare "Y-m-d H:i:s" is read in the
     * database session's own zone, which is not always the application's.
     */
    protected function ts(?\DateTimeInterface $at = null): string
    {
        return ($at ?? now())->format('Y-m-d H:i:sP');
    }

    protected function phone(): string
    {
        return DemoData::phone($this->phones++);
    }

    /** 0–99, the same for the same key within one academy. */
    protected function roll100(string $key): int
    {
        return crc32($this->academyId.'|'.$key) % 100;
    }

    /**
     * @template T
     *
     * @param  list<T>  $items
     * @return T
     */
    protected function pick(string $key, array $items): mixed
    {
        return $items[crc32($this->academyId.'|pick|'.$key) % count($items)];
    }

    /**
     * Put rows the database stamped "now" back on the moment they were made. Inside one transaction
     * Postgres' now() never moves, so `created_at = now()` finds exactly the rows this build made
     * through a column default since the last call.
     *
     * @param  list<string>|null  $tables
     */
    protected function stamp(?array $tables = null): void
    {
        // Only tables this database really has in that shape (a deploy may run ahead of a migration).
        $this->stampable ??= array_values(array_intersect(self::DB_STAMPED, array_map(
            fn (object $row): string => (string) $row->table_name,
            DB::select("select table_name from information_schema.columns
                         where table_schema = 'public' and column_name in ('academy_id', 'created_at')
                         group by table_name having count(*) = 2"),
        )));

        $at = $this->ts();
        foreach (array_intersect($tables ?? $this->stampable, $this->stampable) as $table) {
            DB::update("update {$table} set created_at = ? where academy_id = ? and created_at = now()", [$at, $this->academyId]);
        }
    }

    /**
     * Refresh the planner's statistics for the tables the build is filling — only where they are
     * still small enough to be wrong, and only on a database that is small as a whole (a test or
     * development one). Where real clients' lessons are already counted in the thousands the
     * statistics are sound, and this never runs: it would hold an ANALYZE lock on shared tables
     * until the build commits, for nothing.
     */
    private function tune(): void
    {
        $this->smallDatabase ??= DemoAcademies::smallDatabase();
        if (! $this->smallDatabase) {
            return;
        }

        $small = DB::select(
            "select c.relname from pg_class c
              where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
                and c.relname = any (?::text[]) and c.reltuples < ?",
            ['{'.implode(',', self::HOT).'}', DemoAcademies::SMALL_DATABASE_LESSONS],
        );
        foreach ($small as $table) {
            DB::statement('analyze "'.$table->relname.'"');
        }
    }

    protected function count(string $table, ?callable $where = null): int
    {
        $query = DB::table($table)->where('academy_id', $this->academyId);
        if ($where !== null) {
            $where($query);
        }

        return $query->count();
    }
}
