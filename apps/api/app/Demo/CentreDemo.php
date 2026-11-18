<?php

declare(strict_types=1);

namespace App\Demo;

use App\Services\CentreSubscriptions;
use App\Services\ClassGroups;
use App\Services\GroupLessonGenerator;
use App\Services\Ledger;
use App\Services\Treasury;
use App\Support\AcademyProfile;
use App\Support\Audit;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The learning centre: English levels, an IELTS course, school maths and science — taught in
 * groups with rooms and attendance sheets, with a few private subscriptions alongside. Its money is
 * kept by receipts: every payment is a numbered receipt into the drawer, the bank or a wallet, the
 * expenses come out of the same accounts, and whoever has not paid is in arrears.
 */
final class CentreDemo extends DemoBuilder
{
    public const NAME = 'مركز المعرفة للغات والدروس';

    public const SUBDOMAIN = 'demo-centre';

    public const LOGINS = [
        ['role' => 'Owner', 'email' => 'owner@centre.demo'],
        ['role' => 'Teacher', 'email' => 'teacher@centre.demo'],
        ['role' => 'Front desk', 'email' => 'desk@centre.demo'],
    ];

    private const DESK_EMAIL = 'desk@centre.demo';

    private const ENGLISH = 'اللغة الإنجليزية';

    private const IELTS = 'IELTS';

    private const MATHS = 'الرياضيات';

    private const SCIENCE = 'العلوم';

    /** Rates in piastres an hour; t2 is paid per student who came, t4 a salary, t5 a share of his course. */
    private const TEACHERS = [
        't1' => ['name' => 'مستر كريم عادل', 'email' => 'teacher@centre.demo', 'specialization' => self::ENGLISH, 'pay_type' => 'HOURLY', 'rate' => 13000],
        't2' => ['name' => 'مس سارة محمود', 'email' => 'sara@centre.demo', 'specialization' => self::ENGLISH, 'pay_type' => 'PER_STUDENT', 'rate' => 4000],
        't3' => ['name' => 'مستر أحمد فؤاد', 'email' => 'fouad@centre.demo', 'specialization' => self::MATHS, 'pay_type' => 'HOURLY', 'rate' => 14000],
        't4' => ['name' => 'مس نهى إبراهيم', 'email' => 'noha@centre.demo', 'specialization' => self::SCIENCE, 'pay_type' => 'FIXED', 'rate' => 0, 'salary' => 300000],
        't5' => ['name' => 'مستر محمد الشناوي', 'email' => 'shenawy@centre.demo', 'specialization' => self::IELTS, 'pay_type' => 'HOURLY', 'rate' => 18000],
        't6' => ['name' => 'مس دينا حسام', 'email' => 'dina@centre.demo', 'specialization' => self::ENGLISH, 'pay_type' => 'HOURLY', 'rate' => 12000],
        't7' => ['name' => 'مستر عمر خالد', 'email' => 'omar@centre.demo', 'specialization' => self::ENGLISH, 'pay_type' => 'HOURLY', 'rate' => 11000],
    ];

    private const ROOMS = ['r1' => ['قاعة 1', 12], 'r2' => ['قاعة 2', 10], 'r3' => ['قاعة 3', 8], 'r4' => ['معمل اللغات', 8]];

    private const LEVELS = ['Kids', 'A1', 'A2', 'B1', 'B2', 'IELTS'];

    /**
     * The groups. `members` are indexes into the roster; prices are piastres. `from`/`until` are
     * set in {@see groups()} for the three whose dates are not "the whole history".
     */
    private const GROUPS = [
        'a1' => ['name' => 'English A1 — السبت والثلاثاء', 'teacher' => 't1', 'subject' => 'english', 'course' => self::ENGLISH, 'level' => 'A1', 'room' => 'r1', 'capacity' => 12,
            'slots' => [[6, '16:00'], [2, '16:00']], 'minutes' => 90, 'billing' => 'MONTHLY', 'price' => 85000, 'members' => [0, 1, 2, 3, 4, 5, 6]],
        'a2' => ['name' => 'English A2 — الأحد والأربعاء', 'teacher' => 't1', 'subject' => 'english', 'course' => self::ENGLISH, 'level' => 'A2', 'room' => 'r1', 'capacity' => 12,
            'slots' => [[0, '16:00'], [3, '16:00']], 'minutes' => 90, 'billing' => 'MONTHLY', 'price' => 90000, 'members' => [8, 9, 10, 11, 12, 13, 14]],
        'b1' => ['name' => 'English B1 — السبت والثلاثاء', 'teacher' => 't6', 'subject' => 'english', 'course' => self::ENGLISH, 'level' => 'B1', 'room' => 'r2', 'capacity' => 10,
            'slots' => [[6, '18:00'], [2, '18:00']], 'minutes' => 90, 'billing' => 'MONTHLY', 'price' => 95000, 'members' => [15, 16, 17, 18, 19, 20]],
        'b2' => ['name' => 'English B2 — الاثنين والخميس', 'teacher' => 't1', 'subject' => 'english', 'course' => self::ENGLISH, 'level' => 'B2', 'room' => 'r2', 'capacity' => 10,
            'slots' => [[1, '18:00'], [4, '18:00']], 'minutes' => 90, 'billing' => 'MONTHLY', 'price' => 100000, 'members' => [21, 22, 23, 24, 25]],
        'kids' => ['name' => 'English Kids — Phonics', 'teacher' => 't2', 'subject' => 'english', 'course' => self::ENGLISH, 'level' => 'Kids', 'room' => 'r3', 'capacity' => 8,
            'slots' => [[6, '11:00'], [1, '15:30']], 'minutes' => 60, 'billing' => 'MONTHLY', 'price' => 65000, 'members' => [26, 27, 28, 29, 30, 31]],
        'ielts' => ['name' => 'IELTS Preparation — دورة مكثفة', 'teacher' => 't5', 'subject' => 'ielts', 'course' => self::IELTS, 'level' => 'IELTS', 'room' => 'r2', 'capacity' => 8,
            'slots' => [[0, '19:30'], [3, '19:30']], 'minutes' => 120, 'billing' => 'COURSE', 'price' => 380000, 'planned' => 28, 'share_bp' => 4000, 'members' => [24, 25, 38, 39]],
        'club' => ['name' => 'Conversation Club — الجمعة', 'teacher' => 't6', 'subject' => 'english', 'course' => self::ENGLISH, 'level' => null, 'room' => 'r1', 'capacity' => 15,
            'slots' => [[5, '17:00']], 'minutes' => 90, 'billing' => 'PER_LESSON', 'price' => 15000, 'members' => [15, 16, 17, 21, 22, 23]],
        'm3' => ['name' => 'رياضيات — الصف الثالث الإعدادي', 'teacher' => 't3', 'subject' => 'maths', 'course' => self::MATHS, 'level' => null, 'room' => 'r3', 'capacity' => 10,
            'slots' => [[0, '17:00'], [3, '17:00']], 'minutes' => 90, 'billing' => 'MONTHLY', 'price' => 60000, 'lesson_pay' => 22000, 'members' => [32, 33, 34, 35, 36]],
        'sci' => ['name' => 'علوم — الصف الثالث الإعدادي', 'teacher' => 't4', 'subject' => 'science', 'course' => self::SCIENCE, 'level' => null, 'room' => 'r4', 'capacity' => 10,
            'slots' => [[2, '17:30'], [5, '11:00']], 'minutes' => 75, 'billing' => 'MONTHLY', 'price' => 50000, 'members' => [32, 33, 34, 35]],
        'done' => ['name' => 'English A1 — دفعة الصيف', 'teacher' => 't6', 'subject' => 'english', 'course' => self::ENGLISH, 'level' => 'A1', 'room' => 'r1', 'capacity' => 10,
            'slots' => [[1, '10:00'], [3, '10:00']], 'minutes' => 90, 'billing' => 'MONTHLY', 'price' => 80000, 'members' => [40, 41, 42]],
        'next' => ['name' => 'English A2 — دفعة جديدة', 'teacher' => 't1', 'subject' => 'english', 'course' => self::ENGLISH, 'level' => 'A2', 'room' => 'r2', 'capacity' => 10,
            'slots' => [[6, '13:00'], [2, '13:00']], 'minutes' => 90, 'billing' => 'MONTHLY', 'price' => 90000, 'members' => [40, 41, 42]],
    ];

    /** Two students who join a group in its second month — their first charge is pro-rated. */
    private const LATE_JOINERS = [7 => 'a1', 37 => 'm3'];

    /**
     * Private subscriptions sold beside the groups: [student, teacher, course, [weekday, time]…,
     * minutes, lessons a block, price a lesson]. The last two students take nothing else, started
     * five weeks ago and have not renewed.
     */
    private const PRIVATES = [
        [0, 't6', 'محادثة فردية', [[1, '17:00'], [4, '17:00']], 60, 8, 22000],
        [22, 't5', 'IELTS Writing', [[6, '17:00'], [2, '17:00']], 60, 8, 30000],
        [32, 't3', 'رياضيات — تقوية', [[6, '15:00'], [2, '15:00']], 60, 8, 18000],
        [34, 't3', 'رياضيات — تقوية', [[1, '18:00'], [4, '18:00']], 60, 8, 18000],
        [27, 't2', 'Phonics 1:1', [[3, '15:00']], 45, 4, 17000],
        [11, 't7', 'English 1:1 — أونلاين', [[0, '21:00'], [2, '21:00'], [4, '21:00']], 60, 12, 20000],
        [43, 't5', 'IELTS Speaking', [[1, '16:00'], [4, '16:00']], 60, 8, 30000],
        [44, 't3', 'رياضيات — أولى ثانوي', [[6, '17:00'], [3, '19:00']], 60, 8, 20000],
    ];

    private const LAPSED = [43, 44];

    /** 3 + 6×2 + 30 single children = 45 students in 37 families. */
    private const FAMILY_SIZES = [3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

    private string $deskId;

    /** @var array<string, string> */
    private array $rooms = [];

    /** @var array<string, string> */
    private array $levels = [];

    /** @var array<string, string> */
    private array $courses = [];

    /** @var array<string, string> cash accounts by key */
    private array $accounts = [];

    /** @var array<string, string> group key → id */
    private array $groupIds = [];

    /** @var array<string, string> group id → subject (what its sheets talk about) */
    private array $groupSubjects = [];

    /** @var list<array<string, mixed>> */
    private array $roster = [];

    /** @var array<string, string> guardian id → how the family pays */
    private array $habits = [];

    /** @var array<string, true> families that have paid the first half of what they owe */
    private array $halfPaid = [];

    /** @var array<string, true> students who never miss (the two whose block must run out) */
    private array $reliable = [];

    /** @return list<string> */
    public static function emails(): array
    {
        return array_merge(['owner@centre.demo', self::DESK_EMAIL], array_column(self::TEACHERS, 'email'));
    }

    protected function identity(): array
    {
        return [
            'profile' => AcademyProfile::CENTRE,
            'name' => self::NAME,
            'brand' => 'مركز المعرفة',
            'subdomain' => self::SUBDOMAIN,
            'owner_name' => 'أ. هالة عبد العزيز',
            'owner_email' => 'owner@centre.demo',
            'phone_base' => 2000,
        ];
    }

    // ── The first morning ────────────────────────────────────────────────────

    protected function open(): void
    {
        DB::table('academies')->where('id', $this->academyId)->update(['level_label' => 'LEVEL']);

        foreach ([self::ENGLISH, self::IELTS, self::MATHS, self::SCIENCE] as $i => $course) {
            $this->courses[$course] = (string) Str::uuid();
            DB::table('specializations')->insert([
                'id' => $this->courses[$course], 'academy_id' => $this->academyId, 'name' => $course, 'is_active' => true, 'sort_order' => $i,
            ]);
        }
        foreach (self::LEVELS as $i => $level) {
            $this->levels[$level] = (string) Str::uuid();
            DB::table('academy_levels')->insert(['id' => $this->levels[$level], 'academy_id' => $this->academyId, 'name' => $level, 'sort_order' => $i, 'is_active' => true]);
        }
        $position = 0;
        foreach (self::ROOMS as $key => [$name, $capacity]) {
            $this->rooms[$key] = (string) Str::uuid();
            DB::table('academy_rooms')->insert(['id' => $this->rooms[$key], 'academy_id' => $this->academyId, 'name' => $name, 'capacity' => $capacity, 'is_active' => true, 'position' => $position++]);
        }

        foreach (self::TEACHERS as $key => $teacher) {
            $this->addTeacher($key, $teacher);
        }

        $this->deskId = $this->addUser('منى السيد حجازي', self::DESK_EMAIL, 'CUSTOMER_SERVICE');
        $this->addStaff('منى السيد حجازي', 'RECEPTION', 400000, 'الاستقبال وتسجيل الطلاب الجدد', $this->deskId);
        $this->addStaff('هدى فتحي العدوي', 'ACCOUNTING', 300000, 'الإيصالات والخزينة والمرتبات — دوام جزئي');
        $this->addStaff('سيد رضا أبو زيد', 'OTHER', 200000, 'عامل نظافة وخدمات');

        $this->openTreasury();

        $this->roster = $this->roster();
        $groups = $this->groups();
        $first = $this->start->toDateString();

        // Everyone who is in a group that runs from the first day.
        foreach ($this->roster as $student) {
            if ($student['joins'] === null) {
                $this->enrol($student);
            }
        }
        foreach ($groups as $key => $group) {
            if ($key !== 'next') {
                $this->openGroup($key, $group);
            }
        }
        foreach (self::PRIVATES as $private) {
            if (! in_array($private[0], self::LAPSED, true)) {
                $this->sellPrivate($private, $first);
            }
        }

        $this->planLateJoiners();
        $this->planLapsed();
        $this->planNextGroup($groups['next']);
        $this->planExpenses();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function roster(): array
    {
        $levelOf = [];
        foreach (self::GROUPS as $group) {
            foreach ($group['members'] as $i) {
                $levelOf[$i] ??= $group['level'];
            }
        }
        foreach (self::LATE_JOINERS as $i => $key) {
            $levelOf[$i] = self::GROUPS[$key]['level'];
        }

        $span = (int) $this->start->diffInDays($this->today);
        $roster = [];
        $i = 0;
        foreach (DemoData::families(self::FAMILY_SIZES, 11) as $f => $family) {
            foreach ($family['children'] as $name) {
                $roster[] = [
                    'i' => $i,
                    'key' => "s{$i}",
                    'name' => $name,
                    'family' => "g{$f}",
                    'guardian' => $family['guardian'],
                    'pays' => match (true) {
                        $f === 3 => 'ahead',
                        $f % 5 === 2 => 'late',
                        $f % 7 === 4 => 'partial',
                        $f % 9 === 5 => 'behind',
                        default => 'good',
                    },
                    'level' => $levelOf[$i] ?? null,
                    'joins' => match (true) {
                        isset(self::LATE_JOINERS[$i]) => $this->start->addDays((int) ($span * ($i === 7 ? 0.38 : 0.52))),
                        in_array($i, self::LAPSED, true) => $this->today->subDays(33 + ($i - 43)),
                        default => null,
                    },
                ];
                $i++;
            }
        }

        return $roster;
    }

    /**
     * The groups with their dates. Most run through the whole history; one finished at the end of
     * last month, the IELTS course is in its last days, and one starts next month.
     *
     * @return array<string, array<string, mixed>>
     */
    private function groups(): array
    {
        $groups = [];
        foreach (self::GROUPS as $key => $group) {
            $groups[$key] = $group + ['from' => $this->start, 'until' => null];
        }

        $groups['done']['until'] = $this->today->startOfMonth()->subDay();

        $groups['ielts']['until'] = $this->today->addDays(10);
        $groups['ielts']['from'] = max($this->start, $this->today->subDays(88));

        $groups['next']['from'] = $this->today->startOfMonth()->addMonthNoOverflow();

        return $groups;
    }

    /** @param  array<string, mixed>  $s */
    private function enrol(array $s): void
    {
        $guardianId = $this->addGuardian($s['family'], $s['guardian']);
        $this->habits[$guardianId] = $s['pays'];
        $this->addStudent($s['key'], $s['name'], $s['family'], $s['level'] !== null ? ['level_id' => $this->levels[$s['level']]] : []);
    }

    /** What ClassGroupController::store does: the row, its weekly times, its lessons, then its members. */
    private function openGroup(string $key, array $g): void
    {
        $id = (string) Str::uuid();
        $teacher = $this->teachers[$g['teacher']];

        DB::table('class_groups')->insert([
            'id' => $id,
            'academy_id' => $this->academyId,
            'name' => $g['name'],
            'specialization_id' => $this->courses[$g['course']],
            'level' => $g['level'],
            'level_id' => $g['level'] !== null ? $this->levels[$g['level']] : null,
            'teacher_id' => $teacher['id'],
            'capacity' => $g['capacity'],
            'mode' => 'OFFLINE',
            'location' => self::ROOMS[$g['room']][0],
            'room_id' => $this->rooms[$g['room']],
            'timezone' => self::TZ,
            'start_date' => $g['from']->toDateString(),
            'end_date' => $g['until']?->toDateString(),
            'lessons_planned' => $g['planned'] ?? null,
            'status' => 'ACTIVE',
            'created_by' => $this->ownerId,
            'billing_mode' => $g['billing'],
            'price_minor' => $g['price'],
            'currency' => self::CURRENCY,
            'charge_absent' => false,
            'prorate_join' => true,
            // Paid the teacher's own way unless the group says otherwise: a fixed sum a lesson, or
            // a share of what the course bills.
            'teacher_pay_mode' => isset($g['share_bp']) ? 'REVENUE_SHARE' : (isset($g['lesson_pay']) ? 'PER_LESSON' : null),
            'teacher_pay_minor' => $g['lesson_pay'] ?? null,
            'teacher_share_bp' => $g['share_bp'] ?? null,
            'created_at' => $this->ts(),
            'updated_at' => $this->ts(),
        ]);

        $groups = app(ClassGroups::class);
        $groups->reconcileSlots($this->academyId, $id, array_map(
            fn (array $slot): array => ['weekday' => $slot[0], 'start_time_local' => $slot[1], 'duration_minutes' => $g['minutes']],
            $g['slots'],
        ));
        // Lessons before members: a monthly group bills by the month's lessons.
        $generated = app(GroupLessonGenerator::class)->regenerate($id, backfill: true);

        $members = array_map(fn (int $i): string => $this->students["s{$i}"]['id'], $g['members']);
        $groups->addMembers(DB::table('class_groups')->where('id', $id)->first(), $members, $g['from']->toDateString(), false, $this->ownerId, 'ACADEMY_OWNER');

        Audit::log('class_group.created', 'class_group', $id, $this->academyId, $this->ownerId, 'ACADEMY_OWNER', after: [
            'name' => $g['name'], 'teacher_id' => $teacher['id'], 'start_date' => $g['from']->toDateString(),
            'end_date' => $g['until']?->toDateString(), 'capacity' => $g['capacity'], 'members' => count($members), 'generated' => $generated,
        ]);

        $this->groupIds[$key] = $id;
        $this->groupSubjects[$id] = $g['subject'];
    }

    /**
     * A private subscription: the student takes the subject with that teacher, gets a timetable, and
     * the desk sells the block.
     *
     * @param  array{0: int, 1: string, 2: string, 3: list<array{0: int, 1: string}>, 4: int, 5: int, 6: int}  $private
     */
    private function sellPrivate(array $private, string $firstDay): void
    {
        [$i, $teacherKey, $course, $slots, $minutes, $lessons, $lessonPrice] = $private;
        $studentId = $this->students["s{$i}"]['id'];
        $teacherId = $this->teachers[$teacherKey]['id'];

        $this->linkTeacher($studentId, $teacherId, $course);
        $this->addSchedule($studentId, $teacherId, $slots, $minutes, $firstDay, $course);

        app(CentreSubscriptions::class)->sell([
            'student_id' => $studentId,
            'teacher_id' => $teacherId,
            'course' => $course,
            'lessons_sold' => $lessons,
            'lesson_minutes' => $minutes,
            'lesson_price_minor' => $lessonPrice,
            'starts_on' => $firstDay,
        ], $this->ownerId, 'ACADEMY_OWNER');
    }

    private function planLateJoiners(): void
    {
        foreach (self::LATE_JOINERS as $i => $group) {
            $student = $this->roster[$i];
            $day = $student['joins'];
            $this->plan($day->setTime(11, 20), function () use ($student, $group, $day): void {
                $this->enrol($student);
                $row = DB::table('class_groups')->where('id', $this->groupIds[$group])->where('academy_id', $this->academyId)->first();
                app(ClassGroups::class)->addMembers($row, [$this->students[$student['key']]['id']], $day->toDateString(), false, $this->deskId, 'CUSTOMER_SERVICE');
            });
        }
    }

    /** The two who bought one block of private lessons five weeks ago, used it up, and went quiet. */
    private function planLapsed(): void
    {
        foreach (self::PRIVATES as $private) {
            if (! in_array($private[0], self::LAPSED, true)) {
                continue;
            }
            $student = $this->roster[$private[0]];
            $day = $student['joins'];
            $this->plan($day->setTime(12, 0), function () use ($student, $private, $day): void {
                $this->enrol($student);
                $this->reliable[$this->students[$student['key']]['id']] = true;
                $this->sellPrivate($private, $day->addDay()->toDateString());
            });
        }
    }

    /** Next month's new group, announced a week ago with its first students already registered. */
    private function planNextGroup(array $group): void
    {
        $this->plan($this->today->subDays(6)->setTime(11, 0), fn () => $this->openGroup('next', $group));
    }

    protected function alwaysAttends(object $session): bool
    {
        return isset($this->reliable[(string) $session->student_id]);
    }

    // ── The treasury ─────────────────────────────────────────────────────────

    /** The drawer, the bank and the two wallets, with what each held on the opening day. */
    private function openTreasury(): void
    {
        app(Treasury::class)->ensureCategories($this->academyId);

        $accounts = [
            'cash' => ['الخزنة الرئيسية', 'CASH', 500000, ['CASH']],
            'bank' => ['الحساب البنكي — البنك الأهلي', 'BANK', 4000000, ['BANK_TRANSFER', 'CARD']],
            'instapay' => ['إنستا باي', 'INSTAPAY', 0, ['INSTAPAY']],
            'wallet' => ['فودافون كاش', 'WALLET', 0, ['WALLET']],
        ];
        $order = 0;
        foreach ($accounts as $key => [$name, $kind, $opening, $methods]) {
            $id = $this->accounts[$key] = (string) Str::uuid();
            DB::table('cash_accounts')->insert([
                'id' => $id, 'academy_id' => $this->academyId, 'name' => $name, 'kind' => $kind, 'currency' => self::CURRENCY,
                'opening_balance_minor' => $opening, 'opening_on' => $this->now()->toDateString(), 'sort_order' => $order++,
            ]);
            foreach ($methods as $method) {
                DB::table('cash_account_methods')->insert(['academy_id' => $this->academyId, 'method' => $method, 'currency' => self::CURRENCY, 'cash_account_id' => $id]);
            }
            Audit::log('treasury.account_opened', 'cash_account', $id, $this->academyId, $this->ownerId, 'ACADEMY_OWNER',
                after: ['name' => $name, 'kind' => $kind, 'opening_balance_minor' => $opening]);
        }
    }

    /** The bills a centre pays every month, and a few it pays once. */
    private function planExpenses(): void
    {
        for ($month = $this->start; $month->lessThanOrEqualTo($this->today); $month = $month->addMonthNoOverflow()) {
            $n = (int) $this->start->diffInMonths($month);
            $monthly = [
                [1, 'bank', 'rent', 750000, 'أ. سمير فؤاد — مالك العقار', 'إيجار المقر عن الشهر'],
                [1, 'bank', 'staff_salaries', 400000, 'منى السيد حجازي', 'مرتب الاستقبال'],
                [1, 'bank', 'staff_salaries', 300000, 'هدى فتحي العدوي', 'مرتب المحاسبة'],
                [1, 'cash', 'staff_salaries', 200000, 'سيد رضا أبو زيد', 'مرتب عامل النظافة'],
                [4, 'cash', 'utilities', 65000, 'WE', 'اشتراك الإنترنت'],
                [9, 'cash', 'utilities', 98000 + 16000 * ($n % 3), 'شركة الكهرباء', 'فاتورة الكهرباء'],
                [12, 'cash', 'printing', 42000 + 6000 * ($n % 2), 'مكتبة الأمل', 'تصوير أوراق العمل والاختبارات'],
                [15, 'bank', 'marketing', 200000, 'Meta Ads', 'إعلانات فيسبوك وإنستجرام'],
                [22, 'cash', 'other', 38000, null, 'ضيافة ومستلزمات نظافة'],
            ];
            foreach ($monthly as [$dayOfMonth, $account, $category, $amount, $payee, $what]) {
                $this->plan($month->setDay($dayOfMonth)->setTime(10, 40), fn () => $this->spend($account, $category, $amount, $payee, $what));
            }
        }

        $span = (int) $this->start->diffInDays($this->today);
        $this->plan($this->start->addDays(6)->setTime(13, 15), fn () => $this->spend('bank', 'books', 480000, 'دار المعارف للنشر', 'كتب المستويات A1 و A2 — 20 نسخة'));
        $this->plan($this->start->addDays((int) ($span * 0.45))->setTime(13, 15), fn () => $this->spend('cash', 'maintenance', 90000, 'فني التكييف', 'صيانة تكييف قاعة 2'));
        $this->plan($this->start->addDays((int) ($span * 0.7))->setTime(13, 15), fn () => $this->spend('bank', 'books', 310000, 'Cambridge Bookshop', 'كتب دورة IELTS'));
    }

    /** One expense out of an account — the row TreasuryController::storeExpense writes. */
    private function spend(string $account, string $category, int $amountMinor, ?string $payee, ?string $description, ?string $payoutId = null): void
    {
        $treasury = app(Treasury::class);
        $id = (string) Str::uuid();
        $number = $treasury->nextNumber($this->academyId, 'expense', 'E');

        DB::table('expenses')->insert([
            'id' => $id,
            'academy_id' => $this->academyId,
            'number' => $number,
            'spent_on' => $this->now()->toDateString(),
            'category_id' => $treasury->categoryId($this->academyId, $category),
            'amount_minor' => $amountMinor,
            'currency' => self::CURRENCY,
            'cash_account_id' => $this->accounts[$account],
            'payee' => $payee,
            'description' => $description,
            'payout_id' => $payoutId,
            'created_by' => $this->ownerId,
        ]);
        Audit::log('expense.recorded', 'expense', $id, $this->academyId, $this->ownerId, 'ACADEMY_OWNER',
            after: ['number' => $number, 'amount_minor' => $amountMinor, 'payout_id' => $payoutId]);
    }

    /** Last month's sealed salaries, paid out of the bank on the 5th — all but two of the newest month's. */
    private function paySalaries(CarbonImmutable $day): void
    {
        $last = $day->subMonthNoOverflow();
        $newest = $day->isSameMonth($this->today);

        $payouts = DB::table('payouts as p')->join('teachers as t', 't.id', '=', 'p.teacher_id')
            ->where('p.academy_id', $this->academyId)
            ->where('p.period_year', $last->year)->where('p.period_month', $last->month)
            ->whereNotNull('p.finalized_at')->where('p.total_minor', '>', 0)
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('expenses as e')->whereColumn('e.payout_id', 'p.id')->whereNull('e.voided_at'))
            ->orderBy('t.full_name')
            ->get(['p.id', 'p.total_minor', 't.full_name']);

        foreach ($payouts as $n => $payout) {
            if ($newest && $n < 2) {
                continue;
            }
            $this->spend('bank', 'teacher_salaries', (int) $payout->total_minor, (string) $payout->full_name, $last->format('Y-m'), (string) $payout->id);
        }
    }

    /** Twice a month the wallets are emptied into the bank, and the drawer down to a float. */
    private function bank(CarbonImmutable $day): void
    {
        $treasury = app(Treasury::class);
        $moves = ['instapay' => 0, 'wallet' => 0, 'cash' => 500000];

        foreach ($moves as $from => $keep) {
            $account = DB::table('cash_accounts')->where('id', $this->accounts[$from])->where('academy_id', $this->academyId)->first();
            $balance = $treasury->balanceOf($account, $day->toDateString())['balance_minor'];
            $amount = intdiv($balance - $keep, 10000) * 10000;
            if ($amount < 100000) {
                continue;
            }
            $id = (string) Str::uuid();
            DB::table('cash_transfers')->insert([
                'id' => $id, 'academy_id' => $this->academyId, 'from_account_id' => $this->accounts[$from], 'to_account_id' => $this->accounts['bank'],
                'amount_minor' => $amount, 'transferred_on' => $day->toDateString(),
                'note' => $from === 'cash' ? 'إيداع نقدية الخزنة في البنك' : 'تحويل الرصيد إلى الحساب البنكي', 'created_by' => $this->ownerId,
            ]);
            Audit::log('treasury.transfer', 'cash_transfer', $id, $this->academyId, $this->ownerId, 'ACADEMY_OWNER',
                after: ['from' => $account->name, 'to' => 'الحساب البنكي — البنك الأهلي', 'amount_minor' => $amount]);
        }
    }

    // ── The office ───────────────────────────────────────────────────────────

    protected function officeDay(CarbonImmutable $day): array
    {
        $events = [
            [$day->setTime(10, 15), fn () => $this->renew($day->toDateString())],
            [$day->setTime(12, 20), fn () => $this->collect($day)],
        ];
        if ($day->day === 5) {
            $events[] = [$day->setTime(13, 0), fn () => $this->paySalaries($day)];
        }
        if (in_array($day->day, [10, 25], true)) {
            $events[] = [$day->setTime(14, 0), fn () => $this->bank($day)];
        }
        if ($day->equalTo($this->today->subDays(2))) {
            // A transfer nobody has claimed yet: kept under "unknown" until the family says it was theirs.
            $events[] = [$day->setTime(13, 40), fn () => app(Ledger::class)->record($this->academyId, [], 60000, self::CURRENCY, [
                'unknown' => true, 'method' => 'INSTAPAY', 'reference' => 'IPN-'.$day->format('md').'7741',
                'note' => 'تحويل بدون اسم — بانتظار تأكيد ولي الأمر', 'received_on' => $day->toDateString(),
                'received_by' => $this->ownerId, 'actor_role' => 'ACADEMY_OWNER',
            ])];
        }

        return $events;
    }

    /** The lesson that uses up a block: the family renews at the desk on the way out. */
    protected function afterAttended(object $session): void
    {
        $this->renew($this->now()->toDateString());
    }

    /**
     * Sell the next block for every one that has run out — unless the family went quiet. (A block
     * counts as renewed only while a newer one is open, so one left a day shows as waiting.)
     */
    private function renew(string $startsOn): void
    {
        $finished = DB::table('centre_subscriptions as cs')
            ->where('cs.academy_id', $this->academyId)->where('cs.status', 'FINISHED')
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('centre_subscriptions as newer')
                ->whereColumn('newer.student_id', 'cs.student_id')->whereColumn('newer.teacher_id', 'cs.teacher_id')
                ->whereColumn('newer.sequence_no', '>', 'cs.sequence_no'))
            ->get();

        foreach ($finished as $sub) {
            if (isset($this->reliable[(string) $sub->student_id])) {
                continue;
            }
            app(CentreSubscriptions::class)->sell([
                'student_id' => (string) $sub->student_id,
                'teacher_id' => $sub->teacher_id !== null ? (string) $sub->teacher_id : null,
                'course' => $sub->course,
                'lessons_sold' => (int) $sub->lessons_sold,
                'lesson_minutes' => $sub->lesson_minutes !== null ? (int) $sub->lesson_minutes : null,
                'lesson_price_minor' => (int) $sub->lesson_price_minor,
                'starts_on' => $startsOn,
            ], $this->ownerId, 'ACADEMY_OWNER');
        }
    }

    /**
     * The day's receipts. A family pays what it owes — the month's group charges, a block of private
     * lessons, the conversation club at the door — when its habit says so.
     */
    private function collect(CarbonImmutable $day): void
    {
        $ledger = app(Ledger::class);

        // Who owes what today, in one read: every unpaid charge, by the family it is filed under.
        $allocated = DB::table('receipt_allocations')
            ->where('academy_id', $this->academyId)
            ->selectRaw('invoice_line_id, sum(amount_minor) as allocated')
            ->groupBy('invoice_line_id');
        $owing = DB::table('invoice_line_items as li')
            ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
            ->leftJoinSub($allocated, 'a', 'a.invoice_line_id', '=', 'li.id')
            ->leftJoin('students as st', 'st.id', '=', 'i.student_id')
            ->where('i.academy_id', $this->academyId)
            ->where('i.status', '<>', 'VOID')
            ->whereRaw('li.amount_minor > coalesce(a.allocated, 0)')
            ->groupByRaw('coalesce(i.guardian_id, st.guardian_id)')
            ->selectRaw('coalesce(i.guardian_id, st.guardian_id) as guardian_id, min(li.session_date) as oldest, sum(li.amount_minor - coalesce(a.allocated, 0)) as due')
            ->get();

        foreach ($owing as $row) {
            $guardianId = (string) $row->guardian_id;
            $habit = $this->habits[$guardianId] ?? null;
            if ($habit === null || (int) $row->due <= 0) {
                continue;
            }
            $payer = ['guardian_id' => $guardianId, 'student_id' => null, 'payer_name' => null];
            $due = (int) $row->due;
            $oldest = CarbonImmutable::parse($row->oldest ?? $day)->toDateString();
            $age = (int) CarbonImmutable::parse($oldest, self::TZ)->diffInDays($day);
            $luck = $this->roll100("pay:{$guardianId}:{$oldest}");
            $halved = isset($this->halfPaid["{$guardianId}:{$oldest}"]);

            $wait = match ($habit) {
                'late' => 12 + $luck % 13,
                'partial' => $halved ? 27 + $luck % 9 : 2,
                'behind' => 55 + $luck % 25,
                default => $luck % 7,
            };
            if ($age < $wait) {
                continue;
            }

            $amount = $due;
            if ($habit === 'partial' && ! $halved) {
                $amount = max(5000, (int) (round($due / 2 / 5000) * 5000));
                $this->halfPaid["{$guardianId}:{$oldest}"] = true;
            } elseif ($habit === 'ahead' && $day->lessThan($this->start->addDays(10))) {
                $amount = $due * 2; // two months at once: the second is the family's credit until it is billed
            }

            [$method, $reference] = $this->pick("how:{$guardianId}:{$day->toDateString()}", [
                ['CASH', null], ['CASH', null], ['CASH', null], ['CASH', null],
                ['INSTAPAY', 'IPN'], ['INSTAPAY', 'IPN'], ['WALLET', 'VF'], ['BANK_TRANSFER', 'FT'],
            ]);

            $ledger->record($this->academyId, $payer, $amount, self::CURRENCY, [
                'method' => $method,
                'reference' => $reference !== null ? $reference.'-'.$day->format('md').sprintf('%04d', crc32($guardianId) % 10000) : null,
                'received_on' => $day->toDateString(),
                'received_by' => $this->ownerId,
                'actor_role' => 'ACADEMY_OWNER',
            ]);
        }
    }

    // ── Group lessons ────────────────────────────────────────────────────────

    protected function lessonEvents(CarbonImmutable $day): array
    {
        $events = parent::lessonEvents($day);

        $rows = DB::table('class_group_lessons')
            ->where('academy_id', $this->academyId)
            ->where('status', 'SCHEDULED')
            ->where('occurrence_local_date', $day->toDateString())
            ->orderBy('scheduled_at_utc')->orderBy('id')
            ->get(['id', 'scheduled_at_utc', 'duration_minutes']);

        foreach ($rows as $row) {
            $end = CarbonImmutable::parse($row->scheduled_at_utc)->addMinutes((int) $row->duration_minutes);
            if ($this->leftUnmarked($day, $end)) {
                continue;
            }
            $id = (string) $row->id;
            $events[] = [$end->addMinutes(3 + $this->roll100("sheet:{$id}") % 12)->setTimezone(self::TZ), fn () => $this->saveSheet($id)];
        }

        return $events;
    }

    /** The teacher's sheet: everyone present but the exceptions, what was taught, the homework. */
    private function saveSheet(string $lessonId): void
    {
        $lesson = DB::table('class_group_lessons')->where('id', $lessonId)->where('academy_id', $this->academyId)->first();
        if ($lesson === null || $lesson->status !== 'SCHEDULED') {
            return;
        }

        $groups = app(ClassGroups::class);
        if ($this->roll100("held:{$lessonId}") < 3) {
            $groups->cancel($lesson, $this->pick("why:{$lessonId}", DemoData::GROUP_CANCEL_REASONS), $this->ownerId, 'ACADEMY_OWNER');

            return;
        }

        $roster = $groups->roster($lesson);
        if ($roster->isEmpty()) {
            return;
        }

        $entries = [];
        foreach ($roster as $student) {
            $roll = $this->roll100("came:{$lessonId}:{$student->student_id}");
            if ($roll < 5) {
                $entries[] = ['student_id' => $student->student_id, 'status' => 'LATE', 'note' => 'تأخر 10 دقائق'];
            } elseif ($roll < 12) {
                $entries[] = ['student_id' => $student->student_id, 'status' => 'ABSENT'];
            } elseif ($roll < 15) {
                $entries[] = ['student_id' => $student->student_id, 'status' => 'EXCUSED', 'note' => 'اعتذر ولي الأمر مسبقًا'];
            }
        }

        $held = DB::table('class_group_lessons')->where('group_id', $lesson->group_id)->where('status', 'HELD')->count();
        [$topic, $homework] = DemoData::groupTopic($this->groupSubjects[(string) $lesson->group_id] ?? 'english', $held);
        $teacherUser = $this->teacherUsers[(string) $lesson->teacher_id] ?? $this->ownerId;

        $groups->saveAttendance($lesson, $entries, ['topic' => $topic, 'homework' => $homework, 'notes' => null], $teacherUser, 'TEACHER');
        $this->stamp(['notifications']);
    }

    // ── The present ──────────────────────────────────────────────────────────

    protected function close(): void
    {
        DB::table('users')->where('academy_id', $this->academyId)->where('id', $this->ownerId)
            ->update(['last_login_at' => $this->ts($this->realNow->subHours(2))]);
    }

    protected function counts(): array
    {
        return [
            'students' => $this->count('students'),
            'guardians' => $this->count('guardians'),
            'teachers' => $this->count('teachers'),
            'rooms' => $this->count('academy_rooms'),
            'groups' => $this->count('class_groups'),
            'group_members' => $this->count('class_group_members'),
            'group_lessons_held' => $this->count('class_group_lessons', fn ($q) => $q->where('status', 'HELD')),
            'group_lessons_cancelled' => $this->count('class_group_lessons', fn ($q) => $q->where('status', 'CANCELLED')),
            'group_lessons_unmarked_overdue' => $this->count('class_group_lessons', fn ($q) => $q->where('status', 'SCHEDULED')
                ->where('scheduled_at_utc', '<', $this->realNow->subHours(6)->format('Y-m-d H:i:sP'))),
            'group_lessons_upcoming' => $this->count('class_group_lessons', fn ($q) => $q->where('status', 'SCHEDULED')
                ->where('scheduled_at_utc', '>=', $this->realNow->format('Y-m-d H:i:sP'))),
            'attendance_marks' => $this->count('class_group_attendance'),
            'private_subscriptions' => $this->count('centre_subscriptions'),
            'private_subscriptions_open' => $this->count('centre_subscriptions', fn ($q) => $q->where('status', 'OPEN')),
            'private_lessons_attended' => $this->count('sessions', fn ($q) => $q->where('status', 'ATTENDED')),
            'bills' => $this->count('invoices'),
            'receipts' => $this->count('receipts'),
            'expenses' => $this->count('expenses'),
            'cash_accounts' => $this->count('cash_accounts'),
            'salary_statements_sealed' => $this->count('payouts', fn ($q) => $q->whereNotNull('finalized_at')),
            'salary_statements_open' => $this->count('payouts', fn ($q) => $q->whereNull('finalized_at')),
            'notifications' => $this->count('notifications'),
        ];
    }
}
