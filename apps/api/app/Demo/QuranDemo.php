<?php

declare(strict_types=1);

namespace App\Demo;

use App\Jobs\FlagOverdueReportsJob;
use App\Services\LessonPackages;
use App\Services\Payroll;
use App\Support\AcademyProfile;
use App\Support\Audit;
use App\Support\TrialBooking;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * The one-to-one academy: forty students, each with their own teacher and weekly timetable. Some
 * buy a package of lessons, some pay by the month, by the lesson or by the hour; teachers are paid
 * by the hour, by the student or a fixed salary. Bills are the classic kind — closed on the 2nd,
 * marked paid by hand.
 */
final class QuranDemo extends DemoBuilder
{
    public const NAME = 'أكاديمية نور البيان لتعليم القرآن';

    public const SUBDOMAIN = 'demo-quran';

    public const LOGINS = [
        ['role' => 'Owner', 'email' => 'owner@quran.demo'],
        ['role' => 'Teacher', 'email' => 'teacher@quran.demo'],
    ];

    private const HIFZ = 'حفظ القرآن الكريم';

    private const TAJWEED = 'التجويد والأحكام';

    private const NOOR = 'نور البيان (تأسيس القراءة)';

    private const REVISION = 'مراجعة وتثبيت';

    /** Hourly rates in piastres; a FIXED teacher has a salary and no rate. */
    private const TEACHERS = [
        't1' => ['name' => 'الشيخ عبد الرحمن السيد', 'email' => 'teacher@quran.demo', 'specialization' => self::HIFZ, 'pay_type' => 'HOURLY', 'rate' => 8000, 'from' => '16:00'],
        't2' => ['name' => 'الشيخ محمود عبد الفتاح', 'email' => 'mahmoud@quran.demo', 'specialization' => self::TAJWEED, 'pay_type' => 'HOURLY', 'rate' => 9000, 'from' => '17:00'],
        't3' => ['name' => 'الأستاذة فاطمة الزهراء علي', 'email' => 'fatma@quran.demo', 'specialization' => self::NOOR, 'pay_type' => 'HOURLY', 'rate' => 7000, 'from' => '15:30'],
        't4' => ['name' => 'الأستاذة مريم حسن', 'email' => 'mariam@quran.demo', 'specialization' => self::HIFZ, 'pay_type' => 'PER_STUDENT', 'rate' => 6000, 'from' => '16:30'],
        't5' => ['name' => 'الشيخ أحمد مصطفى', 'email' => 'ahmed@quran.demo', 'specialization' => self::HIFZ, 'pay_type' => 'FIXED', 'rate' => 0, 'salary' => 450000, 'from' => '18:00'],
        't6' => ['name' => 'الأستاذة خديجة إبراهيم', 'email' => 'khadija@quran.demo', 'specialization' => self::REVISION, 'pay_type' => 'HOURLY', 'rate' => 7500, 'from' => '17:30'],
        't7' => ['name' => 'الشيخ يوسف القاضي', 'email' => 'youssef@quran.demo', 'specialization' => self::TAJWEED, 'pay_type' => 'PER_STUDENT', 'rate' => 7000, 'from' => '19:00'],
    ];

    /** Children per family: two families of three, eight of two, the rest one — forty students. */
    private const FAMILY_SIZES = [3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

    /** Weekly timetables a student can be on (0 = Sunday … 6 = Saturday). Friday is a morning. */
    private const WEEKS = [[6, 1], [0, 2], [1, 3], [2, 4], [6, 3], [0, 4], [5, 2], [6, 1, 3], [0, 2, 4], [5, 3]];

    /** The last two students of the roster are not enrolled up front: each comes out of a trial. */
    private const VIA_TRIAL_FROM = 38;

    /**
     * Two package students who bought one package of eight lessons five weeks ago, used it up and
     * have not renewed: the packages page's "finished, waiting for renewal".
     */
    private const LAPSED = [35 => [0, 3], 36 => [1, 4]];

    /** @var array<string, array<int, int>> the next free minute of each teacher's day */
    private array $diary = [];

    /** @var array<string, array{0: int, 1: int}> where each student has reached: [surah, ayah] */
    private array $reached = [];

    /** @var array<string, int> lessons reported so far, per student */
    private array $reported = [];

    /** @var list<array<string, mixed>> */
    private array $roster = [];

    /** @var array<string, true> students who never miss a lesson */
    private array $reliable = [];

    /** @return list<string> */
    public static function emails(): array
    {
        return array_merge(['owner@quran.demo'], array_column(self::TEACHERS, 'email'));
    }

    protected function identity(): array
    {
        return [
            'profile' => AcademyProfile::QURAN,
            'name' => self::NAME,
            'brand' => 'أكاديمية نور البيان',
            'subdomain' => self::SUBDOMAIN,
            'owner_name' => 'د. إبراهيم عبد العزيز',
            'owner_email' => 'owner@quran.demo',
            'phone_base' => 100,
        ];
    }

    // ── The first morning ────────────────────────────────────────────────────

    protected function open(): void
    {
        foreach ([self::HIFZ, self::TAJWEED, self::NOOR, self::REVISION] as $i => $course) {
            DB::table('specializations')->insert([
                'id' => (string) Str::uuid(), 'academy_id' => $this->academyId, 'name' => $course, 'is_active' => true, 'sort_order' => $i,
            ]);
        }

        foreach (self::TEACHERS as $key => $teacher) {
            $this->addTeacher($key, $teacher);
        }

        $this->addStaff('هبة سامي الجمال', 'RECEPTION', 450000, 'خدمة العملاء وحجز الحصص التجريبية');
        $this->addStaff('محمد رضا شاهين', 'ACCOUNTING', 600000, 'الفواتير ومرتبات المعلمين');

        $this->roster = $this->roster();
        $first = $this->start->toDateString();

        foreach ($this->roster as $student) {
            if ($student['i'] >= self::VIA_TRIAL_FROM) {
                continue; // arrives through a trial lesson (planTrials)
            }
            if ($student['joins'] === null) {
                $this->enrol($student, $first);

                continue;
            }
            // Joins later: entered in the morning, first lesson the day after.
            $day = $student['joins'];
            $this->plan($day->setTime(11, 15 + $student['i'] % 30), function () use ($student, $day): void {
                $this->enrol($student, $day->addDay()->toDateString());
                if ($student['i'] % 2 === 0) {
                    $this->quickBill($student['key'], 'رسوم التسجيل والمصحف المعلّم', 15000);
                }
            });
        }

        $this->planTrials();
        $this->planPayrollNotes();
    }

    /**
     * The forty students, with everything that is decided about each one up front.
     *
     * @return list<array<string, mixed>>
     */
    private function roster(): array
    {
        $teacherKeys = array_keys(self::TEACHERS);
        $roster = [];
        $i = 0;

        foreach (DemoData::families(self::FAMILY_SIZES) as $f => $family) {
            foreach ($family['children'] as $name) {
                $teacher = $teacherKeys[$i % count($teacherKeys)];
                $week = self::LAPSED[$i] ?? self::WEEKS[($i * 3 + $f) % count(self::WEEKS)];
                $minutes = $i % 10 === 9 ? 60 : ($i % 6 === 4 ? 45 : 30);
                $lessonPrice = match ($minutes) {
                    60 => 14000, 45 => 11000, default => [7500, 8000, 9000][$i % 3],
                };

                $roster[] = [
                    'i' => $i,
                    'key' => "s{$i}",
                    'name' => $name,
                    'family' => "g{$f}",
                    'guardian' => $family['guardian'],
                    'pays' => $this->payer($f),
                    'teacher' => $teacher,
                    'course' => self::TEACHERS[$teacher]['specialization'],
                    'week' => $week,
                    'minutes' => $minutes,
                    'lesson_price' => $lessonPrice,
                    'billing' => $this->billingOf($i),
                    'joins' => $this->joinDay($i),
                    'auto_renew' => ! isset(self::LAPSED[$i]),
                ];
                $i++;
            }
        }

        return $roster;
    }

    /** How a family pays: most on time, a few late, a few in two parts, a few behind. */
    private function payer(int $family): string
    {
        return match (true) {
            // Chosen so each habit lands on at least one package student and one monthly one.
            $family % 6 === 4 => 'late',
            $family % 7 === 5 => 'partial',
            $family % 9 === 7 => 'behind',
            default => 'good',
        };
    }

    private function billingOf(int $i): string
    {
        if ($i === 23) {
            return 'FREE';
        }

        return ['PACKAGE', 'PACKAGE', 'PER_MONTH', 'PER_SESSION', $i % 2 === 0 ? 'PER_MONTH' : 'PER_HOUR'][$i % 5];
    }

    /** Null = with the academy from the first day. The rest arrive over the months, so it grows. */
    private function joinDay(int $i): ?CarbonImmutable
    {
        $span = (int) $this->start->diffInDays($this->today);

        return match (true) {
            $i < 28 => null,
            isset(self::LAPSED[$i]) => $this->today->subDays(38 + ($i - 35)),
            $i < 32 => $this->start->addDays((int) ($span * (0.18 + 0.07 * ($i - 28)))),
            $i < self::VIA_TRIAL_FROM => $this->start->addDays((int) ($span * (0.5 + 0.07 * ($i - 32)))),
            // The last two arrive through a trial lesson (planTrials).
            default => null,
        };
    }

    /** @param  array<string, mixed>  $s */
    private function enrol(array $s, string $firstDay): void
    {
        $this->addGuardian($s['family'], $s['guardian']);
        $studentId = $this->addStudent($s['key'], $s['name'], $s['family']);
        $teacher = $this->teachers[$s['teacher']];
        $this->linkTeacher($studentId, $teacher['id'], $s['course']);

        // A teacher paid by the student is paid a rate of their own for some of them.
        if ($teacher['pay_type'] === 'PER_STUDENT' && $s['i'] % 2 === 0) {
            DB::table('teacher_student_rates')->insert([
                'id' => (string) Str::uuid(), 'academy_id' => $this->academyId, 'teacher_id' => $teacher['id'],
                'student_id' => $studentId, 'rate_minor' => $teacher['rate'] + 1500 + 500 * ($s['i'] % 3),
            ]);
        }

        $perWeek = count($s['week']);
        $perMonth = 4 * $perWeek;

        if ($s['billing'] === 'PACKAGE') {
            app(LessonPackages::class)->open([
                'student_id' => $studentId,
                'label' => "باقة {$perMonth} حصص",
                'minutes_total' => $perMonth * $s['minutes'],
                'lesson_minutes' => $s['minutes'],
                'price_minor' => $perMonth * $s['lesson_price'],
                'currency' => self::CURRENCY,
                'bill_timing' => 'ON_START',
                'starts_on' => $firstDay,
                'auto_renew' => $s['auto_renew'],
                'carry_over' => false,
            ], $this->ownerId, 'ACADEMY_OWNER');
        } else {
            [$label, $price, $quota] = match ($s['billing']) {
                'PER_MONTH' => ["اشتراك شهري — {$perMonth} حصص", $perMonth * $s['lesson_price'], $perMonth],
                'PER_HOUR' => ['بالساعة', (int) round($s['lesson_price'] * 60 / $s['minutes']), null],
                'FREE' => ['منحة حفظ — بدون رسوم', 0, null],
                default => ['بالحصة', $s['lesson_price'], null],
            };
            $this->addSubscription($studentId, $label, $s['billing'], $price, $firstDay, $quota, $s['minutes']);
        }

        $this->addSchedule($studentId, $teacher['id'], $this->book($s['teacher'], $s['week'], $s['minutes']), $s['minutes'], $firstDay, $s['course']);
        $this->reached[$studentId] = [($s['i'] * 5) % 30, 1];
        if (isset(self::LAPSED[$s['i']])) {
            $this->reliable[$studentId] = true;
        }
    }

    /**
     * Find the teacher's next free time on each of the week's days, and take it.
     *
     * @param  list<int>  $week
     * @return list<array{0: int, 1: string}>
     */
    private function book(string $teacher, array $week, int $minutes): array
    {
        [$h, $m] = array_map('intval', explode(':', self::TEACHERS[$teacher]['from']));
        $slots = [];
        foreach ($week as $weekday) {
            // Friday lessons are in the morning, after the dawn prayer and before the noon one.
            $free = $this->diary[$teacher][$weekday] ?? ($weekday === 5 ? 9 * 60 + 30 : $h * 60 + $m);
            $slots[] = [$weekday, sprintf('%02d:%02d', intdiv($free, 60), $free % 60)];
            $this->diary[$teacher][$weekday] = $free + (int) (ceil($minutes / 15) * 15);
        }

        return $slots;
    }

    // ── Trials ───────────────────────────────────────────────────────────────

    private function planTrials(): void
    {
        $span = (int) $this->start->diffInDays($this->today);
        $late = array_slice($this->roster, self::VIA_TRIAL_FROM);

        // Two trials early on that became students.
        foreach ($late as $n => $student) {
            $when = $this->start->addDays((int) ($span * (0.1 + 0.3 * $n)))->setTime(18, 30);
            $this->trial($when, $student['teacher'], $student['name'], 'COMPLETED', 'حصة تجريبية موفقة، ورغب ولي الأمر في الاشتراك.', $student);
        }

        $this->trial($this->today->subDays(20)->setTime(17, 0), 't2', 'ريم أشرف غانم', 'CANCELLED', 'اعتذر ولي الأمر قبل الموعد وطلب تحديد موعد آخر.');
        $this->trial($this->today->subDays(12)->setTime(19, 0), 't4', 'مالك وليد الدسوقي', 'NO_SHOW', 'لم يحضر الطالب، وتم التواصل مع ولي الأمر.');
        $this->trial($this->today->subDays(9)->setTime(18, 0), 't1', 'تميم هاني بدوي', 'COMPLETED', 'مستوى القراءة جيد ويحتاج إلى ضبط المخارج. ولي الأمر سيؤكد الاشتراك.');
        $this->trial($this->today->subDays(3)->setTime(17, 30), 't3', 'جودي أيمن عطية', 'COMPLETED', 'الطالبة متحمسة ومناسبة لبرنامج نور البيان، بانتظار قرار الأسرة.');
        $this->trial($this->today->setTime(20, 30), 't6', 'سليم وائل خليل', null, null);
        $this->trial($this->today->addDay()->setTime(18, 0), 't2', 'فريدة مدحت الطحان', null, null);
        $this->trial($this->today->addDays(3)->setTime(17, 30), 't4', 'آدم علاء نصار', null, null);
    }

    /**
     * Book a trial two days ahead; when its hour comes, record how it went; a day later, enrol the
     * student it became.
     *
     * @param  array<string, mixed>|null  $becomes
     */
    private function trial(CarbonImmutable $when, string $teacher, string $name, ?string $outcome, ?string $notes, ?array $becomes = null): void
    {
        $id = null;
        $phone = $this->phone();

        $this->plan(min($when->subDays(2)->setTime(12, 40), $this->today->subDay()->setTime(12, 40)), function () use (&$id, $when, $teacher, $name, $phone): void {
            // Its own savepoint: a database one migration behind the code refuses the insert, and
            // the academy is worth building without its trials.
            try {
                $id = DB::transaction(fn (): string => TrialBooking::book($this->academyId, [
                    'teacher_id' => $this->teachers[$teacher]['id'],
                    'lead_name' => $name,
                    'lead_whatsapp' => $phone,
                    'timezone' => self::TZ,
                    'duration_minutes' => 30,
                ], Carbon::parse($when->utc()), $this->ownerId, 'ACADEMY_OWNER'));
            } catch (QueryException $e) {
                $this->warn('Trial lessons were skipped — the trials table is behind the code: '.Str::limit($e->getMessage(), 140));
            }
        });

        if ($outcome === null) {
            return;
        }

        $this->plan($when->addMinutes(40), function () use (&$id, $outcome, $notes): void {
            if ($id === null) {
                return;
            }
            DB::table('trials')->where('id', $id)->where('academy_id', $this->academyId)
                ->update(['status' => $outcome, 'outcome_notes' => $notes, 'updated_at' => $this->ts()]);
            Audit::log('trial.update', 'trial', $id, $this->academyId, $this->ownerId, 'ACADEMY_OWNER',
                after: ['status' => $outcome, 'outcome_notes' => $notes], before: ['status' => 'SCHEDULED']);
        });

        if ($becomes === null) {
            return;
        }

        $day = $when->addDays(2)->startOfDay();
        $this->plan($day->setTime(10, 30), function () use (&$id, $becomes, $day): void {
            $this->enrol($becomes, $day->toDateString());
            if ($id === null) {
                return;
            }
            $studentId = $this->students[$becomes['key']]['id'];
            DB::table('trials')->where('id', $id)->where('academy_id', $this->academyId)->update([
                'student_id' => $studentId, 'converted_student_id' => $studentId, 'status' => 'CONVERTED', 'updated_at' => $this->ts(),
            ]);
            Audit::log('trial.convert', 'trial', $id, $this->academyId, $this->ownerId, 'ACADEMY_OWNER',
                after: ['converted_student_id' => $studentId, 'status' => 'CONVERTED'], before: ['status' => 'COMPLETED']);
        });
    }

    // ── The office ───────────────────────────────────────────────────────────

    protected function officeDay(CarbonImmutable $day): array
    {
        $events = [[$day->setTime(12, 10), fn () => $this->collect($day)]];

        // Salaries are transferred on the 5th, once the month before is sealed.
        if ($day->day === 5) {
            $events[] = [$day->setTime(13, 0), fn () => $this->transferSalaries($day)];
        }

        return $events;
    }

    /** A reward and a deduction, so a statement shows what they look like. */
    private function planPayrollNotes(): void
    {
        $notes = [
            [$this->start->addDays(24), 't1', 'REWARD', 20000, 'مكافأة الالتزام بالمواعيد', 'لم يتأخر عن أي حصة طوال الشهر.'],
            [$this->start->addDays(26), 't6', 'DEDUCTION', 10000, 'تأخير في تسليم تقارير الحصص', 'ثلاثة تقارير سُلّمت بعد أكثر من يوم.'],
            [$this->today->subDays(4), 't3', 'REWARD', 30000, 'مكافأة تميّز', 'إشادة من أولياء الأمور بمتابعة الطلاب.'],
        ];

        foreach ($notes as [$day, $teacher, $type, $amount, $reason, $details]) {
            $this->plan($day->setTime(13, 30), function () use ($teacher, $type, $amount, $reason, $details): void {
                $payroll = app(Payroll::class);
                $now = $this->now();
                $payoutId = $payroll->ensureOpenPayoutFor($this->academyId, $this->teachers[$teacher]['id'], $now->year, $now->month);
                if ($payoutId !== null) {
                    $payroll->addAdjustment($payoutId, $this->academyId, $type, $amount, $reason, $details, $this->ownerId, 'ACADEMY_OWNER');
                }
            });
        }
    }

    /** Tick "transferred" on last month's sealed statements — all but two of the newest month's. */
    private function transferSalaries(CarbonImmutable $day): void
    {
        $last = $day->subMonthNoOverflow();
        $newest = $day->isSameMonth($this->today);

        $payouts = DB::table('payouts')
            ->where('academy_id', $this->academyId)
            ->where('period_year', $last->year)->where('period_month', $last->month)
            ->whereNotNull('finalized_at')->whereNull('transferred_at')
            ->orderBy('teacher_id')
            ->get(['id', 'total_minor']);

        foreach ($payouts as $n => $payout) {
            if ($newest && $n < 2) {
                continue;
            }
            DB::table('payouts')->where('id', $payout->id)->update([
                'transferred_at' => $this->ts(),
                'transferred_by' => $this->ownerId,
                'transferred_minor' => DB::raw('total_minor'),
            ]);
            Audit::log('payout.transferred', 'payout', (string) $payout->id, $this->academyId, $this->ownerId, 'ACADEMY_OWNER',
                after: ['transferred_minor' => (int) $payout->total_minor]);
        }
    }

    /**
     * Take the day's payments. A month's bill is paid once it has closed; a package or a quick bill
     * from the day it was raised. When, and how much, is the family's habit.
     */
    private function collect(CarbonImmutable $day): void
    {
        $unpaid = DB::table('invoices')
            ->where('academy_id', $this->academyId)
            ->whereIn('status', ['OPEN', 'CLOSED', 'PARTIALLY_PAID'])
            ->where('total_minor', '>', 0)
            ->orderBy('created_at')->orderBy('id')
            ->get();

        foreach ($unpaid as $invoice) {
            $monthly = $invoice->kind === 'AUTO';
            if ($monthly && $invoice->status === 'OPEN') {
                continue;
            }

            $since = CarbonImmutable::parse($monthly ? ($invoice->closed_at ?? $invoice->created_at) : $invoice->created_at)->setTimezone(self::TZ)->startOfDay();
            $age = (int) $since->diffInDays($day);
            $luck = $this->roll100("pay:{$invoice->id}");
            $paidSome = (int) $invoice->amount_paid_minor > 0;

            $due = match ($this->habitOf($invoice)) {
                'late' => 14 + $luck % 12,
                'partial' => $paidSome ? 30 + $luck % 10 : 3,
                'behind' => 48 + $luck % 14,
                default => $monthly ? 1 + $luck % 5 : $luck % 3,
            };
            if ($age < $due) {
                continue;
            }

            $half = $this->habitOf($invoice) === 'partial' && ! $paidSome;
            $this->markPaid($invoice, $half ? (int) (round((int) $invoice->total_minor / 2 / 5000) * 5000) : null);
        }
    }

    private function habitOf(object $invoice): string
    {
        $guardianId = $invoice->guardian_id
            ?? DB::table('students')->where('id', $invoice->student_id)->where('academy_id', $this->academyId)->value('guardian_id');

        foreach ($this->roster as $student) {
            if (($this->guardians[$student['family']]['id'] ?? null) === $guardianId) {
                return $student['pays'];
            }
        }

        return 'good';
    }

    /** What InvoiceController::markPaid writes for an academy that keeps no receipts. */
    private function markPaid(object $invoice, ?int $amountMinor): void
    {
        $total = (int) $invoice->total_minor;
        $partial = $amountMinor !== null && $amountMinor > 0 && $amountMinor < $total;
        [$method, $reason] = $this->pick("how:{$invoice->id}", [
            ['BANK_TRANSFER', 'تحويل بنكي'], ['BANK_TRANSFER', 'تحويل بنكي'], ['OTHER', 'إنستا باي'], ['OTHER', 'إنستا باي'],
            ['OTHER', 'فودافون كاش'], ['CASH', 'نقدًا في مقر الأكاديمية'],
        ]);
        $reference = $method === 'CASH' ? null : 'TRX-'.strtoupper(substr(md5((string) $invoice->id), 0, 8));

        DB::table('invoices')->where('id', $invoice->id)->where('academy_id', $this->academyId)->update([
            'status' => $partial ? 'PARTIALLY_PAID' : 'PAID',
            'amount_paid_minor' => $partial ? $amountMinor : $total,
            'payment_method' => $method,
            'payment_reason' => $reason,
            'payment_reference' => $reference,
            'updated_at' => $this->ts(),
        ] + ($partial ? [] : ['paid_at' => $this->ts()]));

        Audit::log('invoice.marked_paid', 'invoice', (string) $invoice->id, $this->academyId, $this->ownerId, 'ACADEMY_OWNER', after: [
            'status' => $partial ? 'PARTIALLY_PAID' : 'PAID',
            'payment_method' => $method,
            'amount_paid_minor' => $partial ? $amountMinor : $total,
            'payment_reference' => $reference,
            'has_payment_proof' => false,
        ]);
    }

    protected function alwaysAttends(object $session): bool
    {
        return isset($this->reliable[(string) $session->student_id]);
    }

    // ── The lesson report ────────────────────────────────────────────────────

    protected function afterAttended(object $session): void
    {
        $studentId = (string) $session->student_id;
        $n = $this->reported[$studentId] = ($this->reported[$studentId] ?? 0) + 1;

        // Nearly every lesson has its report; lately the teachers have been chased, so more do.
        $recent = CarbonImmutable::parse($session->scheduled_at_utc)->greaterThan($this->realNow->subDays(14));
        if ($this->roll100("report:{$session->id}") >= ($recent ? 96 : 87)) {
            return;
        }

        $course = (string) ($session->course ?? '');
        $values = match (true) {
            str_contains($course, 'نور البيان') => [
                'surah_from' => 'الدرس '.$n.': '.DemoData::NOOR_AL_BAYAN[($n - 1) % count(DemoData::NOOR_AL_BAYAN)],
                'surah_to' => 'تمارين القراءة حتى صفحة '.(8 + 2 * $n),
                'next_assignment' => 'قراءة تمارين الدرس مرتين يوميًا',
            ],
            str_contains($course, 'التجويد') => [
                'surah_from' => DemoData::TAJWEED_TOPICS[($n - 1) % count(DemoData::TAJWEED_TOPICS)],
                'surah_to' => 'تطبيق عملي على سورة '.DemoData::SURAHS[(30 + $n) % count(DemoData::SURAHS)][0],
                'next_assignment' => 'حفظ متن الحكم مع خمسة أمثلة من المصحف',
            ],
            default => $this->memorised($studentId),
        };

        $written = Carbon::now()->addMinutes(3 + $this->roll100("wrote:{$session->id}") % 25);
        if ($written->greaterThan($this->realNow)) {
            $written = Carbon::parse($this->realNow);
        }
        $sent = $this->roll100("sent:{$session->id}") < 70 && $written->copy()->addMinutes(20)->lessThan($this->realNow)
            ? $this->ts($written->copy()->addMinutes(20))
            : null;
        $teacherUser = $this->teacherUsers[(string) $session->teacher_id] ?? $this->ownerId;

        $values += [
            'tajweed_rating' => ['ممتاز', 'ممتاز', 'جيد جداً', 'جيد جداً', 'جيد'][$this->roll100("rating:{$session->id}") % 5],
            'notes' => $this->pick("note:{$session->id}", DemoData::REPORT_NOTES),
        ];

        DB::table('session_reports')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $this->academyId,
            'session_id' => $session->id,
            'values' => json_encode($values, JSON_UNESCAPED_UNICODE),
            'filled_by_user_id' => $teacherUser,
            'filled_at' => $this->ts($written),
            'whatsapp_sent_at' => $sent,
            'whatsapp_channel' => $sent !== null ? 'MANUAL_WHATSAPP' : null,
            'created_at' => $this->ts($written),
            'updated_at' => $sent ?? $this->ts($written),
        ]);
        Audit::log('session.report_filled', 'session_report', (string) $session->id, $this->academyId, $teacherUser, 'TEACHER', after: ['values' => $values]);
    }

    /**
     * The next stretch of the student's memorisation: a handful of ayahs on from where they stopped.
     *
     * @return array{surah_from: string, surah_to: string, next_assignment: string}
     */
    private function memorised(string $studentId): array
    {
        $take = function () use ($studentId): array {
            [$surah, $ayah] = $this->reached[$studentId] ?? [0, 1];
            [$name, $length] = DemoData::SURAHS[$surah % count(DemoData::SURAHS)];
            $to = min($length, $ayah + 5 + ($surah + $ayah) % 5);
            // Never leave an ayah or two hanging at the end of a surah.
            if ($length - $to <= 2) {
                $to = $length;
            }
            $this->reached[$studentId] = $to >= $length ? [$surah + 1, 1] : [$surah, $to + 1];

            return [$name, $ayah, $to];
        };

        [$name, $from, $to] = $take();
        $after = $this->reached[$studentId];
        [$nextName, $nextLength] = DemoData::SURAHS[$after[0] % count(DemoData::SURAHS)];

        return [
            'surah_from' => "سورة {$name} — آية {$from}",
            'surah_to' => "سورة {$name} — آية {$to}",
            'next_assignment' => "سورة {$nextName} من آية {$after[1]} إلى ".min($nextLength, $after[1] + 7),
        ];
    }

    // ── The present ──────────────────────────────────────────────────────────

    protected function close(): void
    {
        // Two teachers asking to cancel a lesson still to come — the owner's approval queue.
        $asks = [
            ['t1', 'student', 'ولي الأمر أبلغني بسفر الطالب، ونرجو إلغاء الحصة.'],
            ['t3', 'teacher', 'لديّ موعد طبي في هذا الوقت، وأرجو الموافقة على تعويض الحصة لاحقًا.'],
        ];
        foreach ($asks as [$teacher, $type, $reason]) {
            $session = DB::table('sessions')
                ->where('academy_id', $this->academyId)->where('teacher_id', $this->teachers[$teacher]['id'])
                ->where('status', 'SCHEDULED')
                ->where('scheduled_at_utc', '>', $this->realNow->addHours(20)->format('Y-m-d H:i:sP'))
                ->orderBy('scheduled_at_utc')->first();
            if ($session === null) {
                continue;
            }
            $id = (string) Str::uuid();
            DB::table('session_cancellation_requests')->insert([
                'id' => $id, 'academy_id' => $this->academyId, 'session_id' => $session->id, 'teacher_id' => $session->teacher_id,
                'requested_by_user_id' => $this->teachers[$teacher]['user_id'], 'cancel_type' => $type, 'reason' => $reason, 'status' => 'PENDING',
            ]);
            Audit::log('session.cancellation_requested', 'session_cancellation_request', $id, $this->academyId, $this->teachers[$teacher]['user_id'], 'TEACHER',
                after: ['session_id' => (string) $session->id, 'cancel_type' => $type, 'reason' => $reason]);
        }

        // The hourly sweep that flags a lesson with no report: run once now, so the alerts are
        // there before the scheduler's next turn.
        try {
            DB::transaction(fn () => (new FlagOverdueReportsJob($this->academyId))->handle());
        } catch (Throwable $e) {
            $this->warn('Overdue-report alerts were not raised: '.$e->getMessage());
        }

        DB::table('users')->where('academy_id', $this->academyId)->where('id', $this->ownerId)
            ->update(['last_login_at' => $this->ts($this->realNow->subHours(2))]);
    }

    protected function counts(): array
    {
        return [
            'students' => $this->count('students'),
            'guardians' => $this->count('guardians'),
            'teachers' => $this->count('teachers'),
            'lessons_attended' => $this->count('sessions', fn ($q) => $q->where('status', 'ATTENDED')),
            'lessons_cancelled' => $this->count('sessions', fn ($q) => $q->whereIn('status', ['CANCELLED_BY_STUDENT', 'CANCELLED_BY_TEACHER'])),
            'lessons_unmarked_overdue' => $this->count('sessions', fn ($q) => $q->where('status', 'SCHEDULED')
                ->where('scheduled_at_utc', '<', $this->realNow->subHours(5)->format('Y-m-d H:i:sP'))),
            'lessons_upcoming' => $this->count('sessions', fn ($q) => $q->where('status', 'SCHEDULED')
                ->where('scheduled_at_utc', '>=', $this->realNow->format('Y-m-d H:i:sP'))),
            'lesson_reports' => $this->count('session_reports'),
            'packages' => $this->count('lesson_packages'),
            'packages_open' => $this->count('lesson_packages', fn ($q) => $q->where('status', 'ACTIVE')),
            'bills' => $this->count('invoices'),
            'bills_paid' => $this->count('invoices', fn ($q) => $q->where('status', 'PAID')),
            'bills_part_paid' => $this->count('invoices', fn ($q) => $q->where('status', 'PARTIALLY_PAID')),
            'bills_unpaid' => $this->count('invoices', fn ($q) => $q->whereIn('status', ['OPEN', 'CLOSED'])->where('total_minor', '>', 0)),
            'salary_statements_sealed' => $this->count('payouts', fn ($q) => $q->whereNotNull('finalized_at')),
            'salary_statements_open' => $this->count('payouts', fn ($q) => $q->whereNull('finalized_at')),
            'trials' => $this->count('trials'),
            'notifications' => $this->count('notifications'),
        ];
    }
}
