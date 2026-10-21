<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Settings → Export data: everything an academy owns, one sheet per dataset, so a client who
 * leaves walks out with their records in a workbook rather than a support ticket.
 *
 * The API describes each sheet completely — bilingual title, bilingual column headers, a cell
 * type per column and the labels for coded values — and the web only lays it out (styled .xlsx,
 * built in the browser). Keeping the description here means a dataset is ONE method: the
 * dynamic lesson-report columns (the academy's own field definitions) need the server anyway.
 *
 * Every query also filters on academy_id on top of RLS, and money leaves as major units
 * (minor / 100, the MVP currencies are all 2-decimal — same assumption as web lib/money.ts).
 */
final class AcademyExport
{
    /** Sheet order in the workbook. */
    public const DATASETS = [
        'students', 'guardians', 'teachers', 'staff', 'courses', 'timetables', 'lessons',
        'lesson_reports', 'trials', 'packages', 'invoices', 'payments', 'payouts', 'groups',
        'group_members',
    ];

    private const TITLES = [
        'students' => ['Students', 'الطلاب'],
        'guardians' => ['Guardians', 'أولياء الأمور'],
        'teachers' => ['Teachers', 'المعلمون'],
        'staff' => ['Staff', 'الموظفون'],
        'courses' => ['Courses', 'المواد'],
        'timetables' => ['Timetables', 'الجداول'],
        'lessons' => ['Lessons', 'الحصص'],
        'lesson_reports' => ['Lesson reports', 'تقارير الحصص'],
        'trials' => ['Trial lessons', 'الحصص التجريبية'],
        'packages' => ['Packages', 'الباقات'],
        'invoices' => ['Invoices', 'الفواتير'],
        'payments' => ['Payments', 'المدفوعات'],
        'payouts' => ['Teacher payouts', 'رواتب المعلمين'],
        'groups' => ['Groups', 'المجموعات'],
        'group_members' => ['Group students', 'طلاب المجموعات'],
    ];

    private const WEEKDAYS = [
        0 => ['Sunday', 'الأحد'], 1 => ['Monday', 'الاثنين'], 2 => ['Tuesday', 'الثلاثاء'],
        3 => ['Wednesday', 'الأربعاء'], 4 => ['Thursday', 'الخميس'], 5 => ['Friday', 'الجمعة'],
        6 => ['Saturday', 'السبت'],
    ];

    private const STUDENT_STATUS = [
        'TRIAL' => ['Trial', 'تجريبي'], 'TRIAL_BOOKED' => ['Trial booked', 'حجز تجريبي'],
        'REGULAR' => ['Regular', 'منتظم'], 'GRADUATED' => ['Graduated', 'متخرج'],
        'WITHDRAWN' => ['Withdrawn', 'منسحب'],
    ];

    private const LESSON_STATUS = [
        'SCHEDULED' => ['Scheduled', 'مجدولة'], 'ATTENDED' => ['Attended', 'حضر'],
        'ABSENT_UNEXCUSED' => ['Absent (unexcused)', 'غياب بدون عذر'],
        'ABSENT_EXCUSED' => ['Absent (excused)', 'غياب بعذر'],
        'CANCELLED_BY_TEACHER' => ['Cancelled by teacher', 'ألغاها المعلم'],
        'CANCELLED_BY_STUDENT' => ['Cancelled by student', 'ألغاها الطالب'],
        'RESCHEDULED' => ['Rescheduled', 'أُعيدت جدولتها'], 'FREE' => ['Free', 'مجانية'],
    ];

    private const TRIAL_STATUS = [
        'SCHEDULED' => ['Scheduled', 'مجدولة'], 'COMPLETED' => ['Completed', 'تمت'],
        'NO_SHOW' => ['No show', 'لم يحضر'], 'CANCELLED' => ['Cancelled', 'ملغاة'],
        'CONVERTED' => ['Converted to student', 'تحول لطالب'],
    ];

    private const INVOICE_STATUS = [
        'OPEN' => ['Open', 'مفتوحة'], 'CLOSED' => ['Issued', 'صادرة'], 'PAID' => ['Paid', 'مدفوعة'],
        'PARTIALLY_PAID' => ['Partially paid', 'مدفوعة جزئيًا'], 'VOID' => ['Void', 'ملغاة'],
    ];

    private const PAYMENT_METHOD = [
        'CASH' => ['Cash', 'نقدًا'], 'BANK_TRANSFER' => ['Bank transfer', 'تحويل بنكي'],
        'GATEWAY' => ['Online payment', 'دفع إلكتروني'], 'OTHER' => ['Other', 'أخرى'],
    ];

    private const PACKAGE_STATUS = [
        'ACTIVE' => ['Open', 'مفتوحة'], 'COMPLETED' => ['Finished', 'منتهية'], 'CANCELLED' => ['Cancelled', 'ملغاة'],
    ];

    private const PAY_TYPE = [
        'HOURLY' => ['Hourly', 'بالساعة'], 'PER_STUDENT' => ['Hourly per student', 'بالساعة لكل طالب'],
        'FIXED' => ['Fixed monthly', 'راتب شهري ثابت'],
    ];

    private const ROLE = [
        'ACADEMY_OWNER' => ['Admin', 'مدير'], 'MANAGER' => ['Manager', 'مدير تنفيذي'],
        'SUPERVISOR' => ['Supervisor', 'مشرف'], 'ACCOUNTANT' => ['Accountant', 'محاسب'],
        'CUSTOMER_SERVICE' => ['Customer service', 'خدمة عملاء'], 'STAFF' => ['View only', 'عرض فقط'],
        'TEACHER' => ['Teacher', 'معلم'],
    ];

    private const GROUP_STATUS = ['ACTIVE' => ['Active', 'نشطة'], 'ARCHIVED' => ['Archived', 'مؤرشفة']];

    private const MEMBER_STATUS = ['ACTIVE' => ['Active', 'نشط'], 'LEFT' => ['Left', 'غادر']];

    private const MODE = ['ONLINE' => ['Online', 'أونلاين'], 'OFFLINE' => ['In person', 'حضوري']];

    private const BILLING_MODE = [
        'MONTHLY' => ['Monthly', 'شهري'], 'PER_LESSON' => ['Per lesson', 'بالحصة'], 'COURSE' => ['Whole course', 'الكورس كامل'],
    ];

    private const INVOICE_KIND = ['AUTO' => ['Monthly', 'شهرية'], 'MANUAL' => ['Custom bill', 'فاتورة يدوية']];

    public function __construct(
        private readonly string $academyId,
        private readonly string $timezone,
    ) {}

    public static function forAcademy(string $academyId): self
    {
        $tz = (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'Africa/Cairo');

        return new self($academyId, $tz);
    }

    /** How many rows each dataset holds — drives the picker before anything heavy is built. */
    public function counts(): array
    {
        $out = [];
        foreach (self::DATASETS as $key) {
            [, $query] = $this->definition($key);
            $out[] = [
                'key' => $key,
                'title' => ['en' => self::TITLES[$key][0], 'ar' => self::TITLES[$key][1]],
                'count' => (clone $query)->count(),
            ];
        }

        return $out;
    }

    /**
     * One sheet: its title, columns and rows. Rows are positional (same order as `columns`) to
     * keep a 30k-lesson academy's payload small.
     *
     * @return array{key:string, title:array{en:string,ar:string}, columns:list<array<string,mixed>>, rows:list<list<mixed>>}
     */
    public function sheet(string $key): array
    {
        [$columns, $query] = $this->definition($key);

        $rows = [];
        foreach ($query->cursor() as $record) {
            $record = (array) $record;
            $row = [];
            foreach ($columns as $column) {
                $row[] = self::cell($column, $record);
            }
            $rows[] = $row;
        }

        return [
            'key' => $key,
            'title' => ['en' => self::TITLES[$key][0], 'ar' => self::TITLES[$key][1]],
            'columns' => array_map(static function (array $c): array {
                unset($c['source']);

                return $c;
            }, $columns),
            'rows' => $rows,
        ];
    }

    /** @return array{0: list<array<string,mixed>>, 1: Builder} */
    private function definition(string $key): array
    {
        return match ($key) {
            'students' => $this->students(),
            'guardians' => $this->guardians(),
            'teachers' => $this->teachers(),
            'staff' => $this->staff(),
            'courses' => $this->courses(),
            'timetables' => $this->timetables(),
            'lessons' => $this->lessons(),
            'lesson_reports' => $this->lessonReports(),
            'trials' => $this->trials(),
            'packages' => $this->packages(),
            'invoices' => $this->invoices(),
            'payments' => $this->payments(),
            'payouts' => $this->payouts(),
            'groups' => $this->groups(),
            'group_members' => $this->groupMembers(),
        };
    }

    private function students(): array
    {
        $columns = [
            self::col('full_name', 'Student', 'الطالب', width: 28),
            self::col('whatsapp_phone', 'WhatsApp', 'واتساب', width: 18),
            self::col('secondary_phone', 'Other phone', 'رقم آخر', width: 18),
            self::col('country', 'Country', 'الدولة', width: 14),
            self::col('status', 'Status', 'الحالة', 'enum', self::STUDENT_STATUS, 14),
            self::col('guardian_name', 'Guardian', 'ولي الأمر', width: 26),
            self::col('guardian_phone', 'Guardian WhatsApp', 'واتساب ولي الأمر', width: 18),
            self::col('teachers', 'Teachers', 'المعلمون', width: 30),
            self::col('notes', 'Notes', 'ملاحظات', width: 36),
            self::col('created_on', 'Added on', 'تاريخ الإضافة', 'date', width: 14),
            self::col('is_active', 'Active', 'نشط', 'bool', width: 10),
        ];

        $query = DB::table('students as s')
            ->leftJoin('guardians as g', 'g.id', '=', 's.guardian_id')
            ->where('s.academy_id', $this->academyId)
            ->select([
                's.full_name', 's.whatsapp_phone', 's.secondary_phone', 's.country', 's.status', 's.notes',
                'g.full_name as guardian_name', 'g.whatsapp_phone as guardian_phone',
                DB::raw('(s.deleted_at is null) as is_active'),
                DB::raw("(select string_agg(distinct t.full_name, ', ') from student_teacher_assignments a
                    join teachers t on t.id = a.teacher_id
                    where a.student_id = s.id and a.ended_at is null) as teachers"),
            ])
            ->selectRaw($this->localDate('s.created_at').' as created_on', [$this->timezone])
            ->orderByRaw('s.deleted_at is not null')
            ->orderBy('s.full_name');

        return [$columns, $query];
    }

    private function guardians(): array
    {
        $columns = [
            self::col('full_name', 'Guardian', 'ولي الأمر', width: 28),
            self::col('whatsapp_phone', 'WhatsApp', 'واتساب', width: 18),
            self::col('secondary_phone', 'Other phone', 'رقم آخر', width: 18),
            self::col('country', 'Country', 'الدولة', width: 14),
            self::col('currency', 'Currency', 'العملة', width: 10),
            self::col('students', 'Students', 'الطلاب', width: 36),
            self::col('notes', 'Notes', 'ملاحظات', width: 36),
            self::col('created_on', 'Added on', 'تاريخ الإضافة', 'date', width: 14),
            self::col('is_active', 'Active', 'نشط', 'bool', width: 10),
        ];

        $query = DB::table('guardians as g')
            ->where('g.academy_id', $this->academyId)
            ->select([
                'g.full_name', 'g.whatsapp_phone', 'g.secondary_phone', 'g.country', 'g.currency', 'g.notes',
                DB::raw('(g.deleted_at is null) as is_active'),
                DB::raw("(select string_agg(s.full_name, ', ' order by s.full_name) from students s
                    where s.guardian_id = g.id and s.deleted_at is null) as students"),
            ])
            ->selectRaw($this->localDate('g.created_at').' as created_on', [$this->timezone])
            ->orderByRaw('g.deleted_at is not null')
            ->orderBy('g.full_name');

        return [$columns, $query];
    }

    private function teachers(): array
    {
        $columns = [
            self::col('full_name', 'Teacher', 'المعلم', width: 28),
            self::col('phone', 'Phone', 'الهاتف', width: 18),
            self::col('email', 'Login email', 'بريد الدخول', width: 28),
            self::col('specialization', 'Specialization', 'التخصص', width: 20),
            self::col('pay_type', 'Pay type', 'نوع الأجر', 'enum', self::PAY_TYPE, 18),
            self::col('hourly_rate', 'Hourly rate', 'سعر الساعة', 'money', width: 14),
            self::col('fixed_salary', 'Monthly salary', 'الراتب الشهري', 'money', width: 14),
            self::col('currency', 'Currency', 'العملة', width: 10),
            self::col('payout_method', 'Payout method', 'طريقة الصرف', width: 14),
            self::col('payout_handle', 'Payout account', 'حساب الصرف', width: 20),
            self::col('meeting_url', 'Meeting link', 'رابط الحصة', width: 30),
            self::col('timezone', 'Timezone', 'المنطقة الزمنية', width: 18),
            self::col('created_on', 'Added on', 'تاريخ الإضافة', 'date', width: 14),
            self::col('is_active', 'Active', 'نشط', 'bool', width: 10),
        ];

        $query = DB::table('teachers as t')
            ->leftJoin('users as u', 'u.id', '=', 't.user_id')
            ->where('t.academy_id', $this->academyId)
            ->select([
                't.full_name', 't.phone', 'u.email', 't.specialization', 't.pay_type',
                't.session_rate_minor as hourly_rate', 't.fixed_salary_minor as fixed_salary', 't.currency',
                't.payout_method', 't.payout_handle', 't.meeting_url', 't.timezone',
                DB::raw('(t.is_active and t.deleted_at is null) as is_active'),
            ])
            ->selectRaw($this->localDate('t.created_at').' as created_on', [$this->timezone])
            ->orderByRaw('t.deleted_at is not null')
            ->orderBy('t.full_name');

        return [$columns, $query];
    }

    private function staff(): array
    {
        $columns = [
            self::col('full_name', 'Employee', 'الموظف', width: 28),
            self::col('phone', 'Phone', 'الهاتف', width: 18),
            self::col('email', 'Login email', 'بريد الدخول', width: 28),
            self::col('role', 'Role', 'الدور', 'enum', self::ROLE, 18),
            self::col('salary', 'Salary', 'الراتب', 'money', width: 14),
            self::col('currency', 'Currency', 'العملة', width: 10),
            self::col('notes', 'Notes', 'ملاحظات', width: 36),
            self::col('created_on', 'Added on', 'تاريخ الإضافة', 'date', width: 14),
            self::col('is_active', 'Active', 'نشط', 'bool', width: 10),
        ];

        // A custom role is stored as its code (CR_…); print the name the academy gave it.
        $query = DB::table('staff as st')
            ->leftJoin('users as u', 'u.id', '=', 'st.user_id')
            ->where('st.academy_id', $this->academyId)
            ->select([
                'st.full_name', 'st.phone', 'u.email', 'st.salary_minor as salary', 'st.currency', 'st.notes',
                DB::raw('(st.is_active and st.deleted_at is null) as is_active'),
                DB::raw('(select coalesce(ar.name, ur.role) from user_roles ur
                    left join academy_roles ar on ar.code = ur.role
                    where ur.user_id = st.user_id order by ur.created_at limit 1) as role'),
            ])
            ->selectRaw($this->localDate('st.created_at').' as created_on', [$this->timezone])
            ->orderByRaw('st.deleted_at is not null')
            ->orderBy('st.full_name');

        return [$columns, $query];
    }

    private function courses(): array
    {
        $columns = [
            self::col('name', 'Course', 'المادة', width: 30),
            self::col('is_active', 'Active', 'نشط', 'bool', width: 10),
            self::col('created_on', 'Added on', 'تاريخ الإضافة', 'date', width: 14),
        ];

        $query = DB::table('specializations')
            ->where('academy_id', $this->academyId)
            ->select(['name', 'is_active'])
            ->selectRaw($this->localDate('created_at').' as created_on', [$this->timezone])
            ->orderBy('sort_order')
            ->orderBy('name');

        return [$columns, $query];
    }

    private function timetables(): array
    {
        $columns = [
            self::col('student', 'Student', 'الطالب', width: 28),
            self::col('teacher', 'Teacher', 'المعلم', width: 28),
            self::col('weekday', 'Day', 'اليوم', 'enum', self::WEEKDAYS, 12),
            self::col('start_time', 'Time', 'الوقت', width: 10),
            self::col('duration_minutes', 'Minutes', 'المدة (دقيقة)', 'number', width: 12),
            self::col('timezone', 'Timezone', 'المنطقة الزمنية', width: 18),
            self::col('start_date', 'Starts on', 'يبدأ من', 'date', width: 14),
            self::col('is_active', 'Active', 'نشط', 'bool', width: 10),
        ];

        $query = DB::table('schedule_slots as sl')
            ->join('schedules as sc', 'sc.id', '=', 'sl.schedule_id')
            ->leftJoin('students as s', 's.id', '=', 'sc.student_id')
            ->leftJoin('teachers as t', 't.id', '=', 'sc.teacher_id')
            ->where('sl.academy_id', $this->academyId)
            ->select([
                's.full_name as student', 't.full_name as teacher', 'sl.weekday',
                DB::raw("to_char(sl.start_time_local, 'HH24:MI') as start_time"),
                'sl.duration_minutes', 'sc.timezone',
                DB::raw("to_char(sc.start_date, 'YYYY-MM-DD') as start_date"),
                DB::raw('(sc.is_active and sc.deleted_at is null) as is_active'),
            ])
            ->orderByRaw('(sc.is_active and sc.deleted_at is null) desc')
            ->orderBy('s.full_name')
            ->orderBy('sl.weekday')
            ->orderBy('sl.start_time_local');

        return [$columns, $query];
    }

    private function lessons(): array
    {
        $columns = [
            self::col('lesson_date', 'Date', 'التاريخ', 'date', width: 13),
            self::col('lesson_time', 'Time', 'الوقت', width: 9),
            self::col('student', 'Student', 'الطالب', width: 28),
            self::col('teacher', 'Teacher', 'المعلم', width: 28),
            self::col('duration_minutes', 'Minutes', 'المدة (دقيقة)', 'number', width: 12),
            self::col('status', 'Status', 'الحالة', 'enum', self::LESSON_STATUS, 22),
            self::col('status_reason', 'Reason', 'السبب', width: 30),
            self::col('billed', 'Billed', 'محسوبة على الطالب', 'bool', width: 12),
            self::col('paid_to_teacher', 'Paid to teacher', 'محسوبة للمعلم', 'bool', width: 14),
        ];

        $query = DB::table('sessions as se')
            ->leftJoin('students as s', 's.id', '=', 'se.student_id')
            ->leftJoin('teachers as t', 't.id', '=', 'se.teacher_id')
            ->where('se.academy_id', $this->academyId)
            ->select([
                's.full_name as student', 't.full_name as teacher', 'se.duration_minutes',
                DB::raw('se.status::text as status'), 'se.status_reason', 'se.billed', 'se.paid_to_teacher',
            ])
            ->selectRaw($this->localDate('se.scheduled_at_utc').' as lesson_date', [$this->timezone])
            ->selectRaw($this->localTime('se.scheduled_at_utc').' as lesson_time', [$this->timezone])
            ->orderByDesc('se.scheduled_at_utc');

        return [$columns, $query];
    }

    /** One column per report field the academy ever defined — retired fields still hold history. */
    private function lessonReports(): array
    {
        $fields = DB::table('report_field_definitions')
            ->where('academy_id', $this->academyId)
            ->orderByDesc('is_active')
            ->orderBy('sort_order')
            ->get(['key', 'label_en', 'label_ar', 'field_type']);

        $columns = [
            self::col('lesson_date', 'Date', 'التاريخ', 'date', width: 13),
            self::col('student', 'Student', 'الطالب', width: 26),
            self::col('teacher', 'Teacher', 'المعلم', width: 26),
        ];
        $select = [
            's.full_name as student', 't.full_name as teacher',
        ];
        foreach ($fields->values() as $i => $field) {
            $alias = 'f'.$i;
            $type = in_array($field->field_type, ['NUMBER', 'RATING'], true) ? 'number' : 'text';
            $label = (string) ($field->label_en ?: $field->key);
            $columns[] = self::col($alias, $label, (string) ($field->label_ar ?: $label), $type,
                width: $field->field_type === 'TEXTAREA' ? 40 : 18);
            $select[] = DB::raw('r.values ->> '.DB::getPdo()->quote((string) $field->key).' as '.$alias);
        }
        $columns[] = self::col('filled_at', 'Written at', 'وقت الكتابة', width: 17);

        $query = DB::table('session_reports as r')
            ->join('sessions as se', 'se.id', '=', 'r.session_id')
            ->leftJoin('students as s', 's.id', '=', 'se.student_id')
            ->leftJoin('teachers as t', 't.id', '=', 'se.teacher_id')
            ->where('r.academy_id', $this->academyId)
            ->select($select)
            ->selectRaw($this->localDate('se.scheduled_at_utc').' as lesson_date', [$this->timezone])
            ->selectRaw($this->localDateTime('coalesce(r.filled_at, r.created_at)').' as filled_at', [$this->timezone])
            ->orderByDesc('se.scheduled_at_utc');

        return [$columns, $query];
    }

    private function trials(): array
    {
        $columns = [
            self::col('trial_date', 'Date', 'التاريخ', 'date', width: 13),
            self::col('trial_time', 'Time', 'الوقت', width: 9),
            self::col('name', 'Name', 'الاسم', width: 28),
            self::col('whatsapp', 'WhatsApp', 'واتساب', width: 18),
            self::col('email', 'Email', 'البريد', width: 26),
            self::col('teacher', 'Teacher', 'المعلم', width: 26),
            self::col('duration_minutes', 'Minutes', 'المدة (دقيقة)', 'number', width: 12),
            self::col('status', 'Status', 'الحالة', 'enum', self::TRIAL_STATUS, 18),
            self::col('outcome_notes', 'Notes', 'ملاحظات', width: 36),
        ];

        $query = DB::table('trials as tr')
            ->leftJoin('students as s', 's.id', '=', 'tr.student_id')
            ->leftJoin('teachers as t', 't.id', '=', 'tr.teacher_id')
            ->where('tr.academy_id', $this->academyId)
            ->whereNull('tr.deleted_at')
            ->select([
                DB::raw('coalesce(s.full_name, tr.lead_name) as name'),
                DB::raw('coalesce(s.whatsapp_phone, tr.lead_whatsapp) as whatsapp'),
                'tr.lead_email as email', 't.full_name as teacher', 'tr.duration_minutes', 'tr.status', 'tr.outcome_notes',
            ])
            ->selectRaw($this->localDate('tr.scheduled_at_utc').' as trial_date', [$this->timezone])
            ->selectRaw($this->localTime('tr.scheduled_at_utc').' as trial_time', [$this->timezone])
            ->orderByDesc('tr.scheduled_at_utc');

        return [$columns, $query];
    }

    private function packages(): array
    {
        $columns = [
            self::col('student', 'Student', 'الطالب', width: 28),
            self::col('label', 'Package', 'الباقة', width: 22),
            self::col('sequence_no', 'No.', 'رقم', 'number', width: 7),
            self::col('hours_total', 'Hours', 'الساعات', 'number', width: 10),
            self::col('hours_used', 'Hours used', 'الساعات المستهلكة', 'number', width: 12),
            self::col('hours_carried', 'Hours carried over', 'ساعات مرحّلة', 'number', width: 14),
            self::col('price', 'Price', 'السعر', 'money', width: 13),
            self::col('hourly_rate', 'Hourly rate', 'سعر الساعة', 'money', width: 13),
            self::col('currency', 'Currency', 'العملة', width: 10),
            self::col('status', 'Status', 'الحالة', 'enum', self::PACKAGE_STATUS, 12),
            self::col('starts_on', 'Starts on', 'تبدأ', 'date', width: 13),
            self::col('expires_on', 'Expires on', 'تنتهي', 'date', width: 13),
            self::col('closed_on', 'Closed on', 'أُغلقت', 'date', width: 13),
        ];

        $query = DB::table('lesson_packages as p')
            ->leftJoin('students as s', 's.id', '=', 'p.student_id')
            ->where('p.academy_id', $this->academyId)
            ->select([
                's.full_name as student', 'p.label', 'p.sequence_no',
                DB::raw('round(p.minutes_total / 60.0, 2) as hours_total'),
                DB::raw('round(p.minutes_consumed / 60.0, 2) as hours_used'),
                DB::raw('round(p.carried_over_minutes / 60.0, 2) as hours_carried'),
                'p.price_minor as price', 'p.hourly_rate_minor as hourly_rate', 'p.currency', 'p.status',
                DB::raw("to_char(p.starts_on, 'YYYY-MM-DD') as starts_on"),
                DB::raw("to_char(p.expires_on, 'YYYY-MM-DD') as expires_on"),
            ])
            ->selectRaw($this->localDate('p.closed_at').' as closed_on', [$this->timezone])
            ->orderBy('s.full_name')
            ->orderBy('p.sequence_no');

        return [$columns, $query];
    }

    private function invoices(): array
    {
        $columns = [
            self::col('period', 'Month', 'الشهر', width: 10),
            self::col('payer', 'Billed to', 'الفاتورة باسم', width: 28),
            self::col('kind', 'Type', 'النوع', 'enum', self::INVOICE_KIND, 14),
            self::col('status', 'Status', 'الحالة', 'enum', self::INVOICE_STATUS, 15),
            self::col('total', 'Total', 'الإجمالي', 'money', width: 13),
            self::col('paid', 'Paid', 'المدفوع', 'money', width: 13),
            self::col('balance', 'Balance', 'المتبقي', 'money', width: 13),
            self::col('currency', 'Currency', 'العملة', width: 10),
            self::col('payment_method', 'Payment method', 'طريقة الدفع', 'enum', self::PAYMENT_METHOD, 16),
            self::col('payment_reference', 'Reference', 'المرجع', width: 20),
            self::col('paid_on', 'Paid on', 'تاريخ الدفع', 'date', width: 13),
            self::col('created_on', 'Created on', 'تاريخ الإنشاء', 'date', width: 13),
        ];

        $query = DB::table('invoices as i')
            ->leftJoin('guardians as g', 'g.id', '=', 'i.guardian_id')
            ->leftJoin('students as s', 's.id', '=', 'i.student_id')
            ->where('i.academy_id', $this->academyId)
            ->select([
                DB::raw("i.period_year || '-' || lpad(i.period_month::text, 2, '0') as period"),
                DB::raw('coalesce(g.full_name, s.full_name, i.payer_name) as payer'),
                'i.kind', DB::raw('i.status::text as status'), 'i.total_minor as total',
                'i.amount_paid_minor as paid',
                DB::raw("case when i.status::text = 'VOID' then 0 else greatest(i.total_minor - coalesce(i.amount_paid_minor, 0), 0) end as balance"),
                'i.currency', DB::raw('i.payment_method::text as payment_method'), 'i.payment_reference',
            ])
            ->selectRaw($this->localDate('i.paid_at').' as paid_on', [$this->timezone])
            ->selectRaw($this->localDate('i.created_at').' as created_on', [$this->timezone])
            ->orderByDesc('i.period_year')
            ->orderByDesc('i.period_month')
            ->orderBy('payer');

        return [$columns, $query];
    }

    private function payments(): array
    {
        $columns = [
            self::col('paid_on', 'Date', 'التاريخ', 'date', width: 13),
            self::col('payer', 'Paid by', 'الدافع', width: 28),
            self::col('period', 'Invoice month', 'شهر الفاتورة', width: 13),
            self::col('amount', 'Amount', 'المبلغ', 'money', width: 13),
            self::col('currency', 'Currency', 'العملة', width: 10),
            self::col('payment_method', 'Method', 'الطريقة', 'enum', self::PAYMENT_METHOD, 16),
            self::col('status_after', 'Invoice after payment', 'حالة الفاتورة بعد الدفع', 'enum', self::INVOICE_STATUS, 18),
        ];

        $query = DB::table('invoice_payment_events as e')
            ->join('invoices as i', 'i.id', '=', 'e.invoice_id')
            ->leftJoin('guardians as g', 'g.id', '=', 'i.guardian_id')
            ->leftJoin('students as s', 's.id', '=', 'i.student_id')
            ->where('e.academy_id', $this->academyId)
            ->select([
                DB::raw('coalesce(g.full_name, s.full_name, i.payer_name) as payer'),
                DB::raw("i.period_year || '-' || lpad(i.period_month::text, 2, '0') as period"),
                'e.amount_minor as amount', 'e.currency',
                DB::raw('e.payment_method::text as payment_method'), DB::raw('e.status_after::text as status_after'),
            ])
            ->selectRaw($this->localDate('e.occurred_at').' as paid_on', [$this->timezone])
            ->orderByDesc('e.occurred_at');

        return [$columns, $query];
    }

    private function payouts(): array
    {
        $columns = [
            self::col('period', 'Month', 'الشهر', width: 10),
            self::col('teacher', 'Teacher', 'المعلم', width: 28),
            self::col('base', 'Base', 'الأساسي', 'money', width: 13),
            self::col('rewards', 'Rewards', 'المكافآت', 'money', width: 13),
            self::col('deductions', 'Deductions', 'الخصومات', 'money', width: 13),
            self::col('total', 'Total', 'الإجمالي', 'money', width: 13),
            self::col('currency', 'Currency', 'العملة', width: 10),
            self::col('lessons', 'Lessons', 'عدد الحصص', 'number', width: 10),
            self::col('finalized_on', 'Finalized on', 'تاريخ الاعتماد', 'date', width: 13),
            self::col('notes', 'Notes', 'ملاحظات', width: 30),
        ];

        $query = DB::table('payouts as p')
            ->leftJoin('teachers as t', 't.id', '=', 'p.teacher_id')
            ->where('p.academy_id', $this->academyId)
            ->select([
                DB::raw("p.period_year || '-' || lpad(p.period_month::text, 2, '0') as period"),
                't.full_name as teacher', 'p.base_minor as base', 'p.rewards_minor as rewards',
                'p.deductions_minor as deductions', 'p.total_minor as total', 'p.currency', 'p.notes',
                DB::raw('(select count(*) from payout_line_items li where li.payout_id = p.id) as lessons'),
            ])
            ->selectRaw($this->localDate('p.finalized_at').' as finalized_on', [$this->timezone])
            ->orderByDesc('p.period_year')
            ->orderByDesc('p.period_month')
            ->orderBy('t.full_name');

        return [$columns, $query];
    }

    private function groups(): array
    {
        $columns = [
            self::col('name', 'Group', 'المجموعة', width: 26),
            self::col('course', 'Course', 'المادة', width: 20),
            self::col('level', 'Level', 'المستوى', width: 14),
            self::col('teacher', 'Teacher', 'المعلم', width: 26),
            self::col('mode', 'Mode', 'النوع', 'enum', self::MODE, 12),
            self::col('members', 'Students', 'عدد الطلاب', 'number', width: 10),
            self::col('capacity', 'Capacity', 'السعة', 'number', width: 10),
            self::col('billing_mode', 'Billing', 'طريقة الحساب', 'enum', self::BILLING_MODE, 14),
            self::col('price', 'Price', 'السعر', 'money', width: 13),
            self::col('currency', 'Currency', 'العملة', width: 10),
            self::col('start_date', 'Starts on', 'تبدأ', 'date', width: 13),
            self::col('end_date', 'Ends on', 'تنتهي', 'date', width: 13),
            self::col('status', 'Status', 'الحالة', 'enum', self::GROUP_STATUS, 12),
        ];

        $query = DB::table('class_groups as cg')
            ->leftJoin('specializations as sp', 'sp.id', '=', 'cg.specialization_id')
            ->leftJoin('teachers as t', 't.id', '=', 'cg.teacher_id')
            ->where('cg.academy_id', $this->academyId)
            ->select([
                'cg.name', 'sp.name as course', 'cg.level', 't.full_name as teacher', 'cg.mode', 'cg.capacity',
                'cg.billing_mode', 'cg.price_minor as price', 'cg.currency', 'cg.status',
                DB::raw("(select count(*) from class_group_members m where m.group_id = cg.id and m.status = 'ACTIVE') as members"),
                DB::raw("to_char(cg.start_date, 'YYYY-MM-DD') as start_date"),
                DB::raw("to_char(cg.end_date, 'YYYY-MM-DD') as end_date"),
            ])
            ->orderBy('cg.status')
            ->orderBy('cg.name');

        return [$columns, $query];
    }

    private function groupMembers(): array
    {
        $columns = [
            self::col('group_name', 'Group', 'المجموعة', width: 26),
            self::col('student', 'Student', 'الطالب', width: 28),
            self::col('joined_on', 'Joined on', 'تاريخ الانضمام', 'date', width: 13),
            self::col('left_on', 'Left on', 'تاريخ المغادرة', 'date', width: 13),
            self::col('status', 'Status', 'الحالة', 'enum', self::MEMBER_STATUS, 10),
            self::col('price', 'Own price', 'سعر خاص', 'money', width: 13),
        ];

        $query = DB::table('class_group_members as m')
            ->join('class_groups as cg', 'cg.id', '=', 'm.group_id')
            ->leftJoin('students as s', 's.id', '=', 'm.student_id')
            ->where('m.academy_id', $this->academyId)
            ->select([
                'cg.name as group_name', 's.full_name as student', 'm.status', 'm.price_minor as price',
                DB::raw("to_char(m.joined_on, 'YYYY-MM-DD') as joined_on"),
                DB::raw("to_char(m.left_on, 'YYYY-MM-DD') as left_on"),
            ])
            ->orderBy('cg.name')
            ->orderBy('s.full_name');

        return [$columns, $query];
    }

    /**
     * @param  array<string,array{0:string,1:string}>|null  $labels  coded value → [en, ar]
     * @return array<string,mixed>
     */
    private static function col(string $key, string $en, string $ar, string $type = 'text', ?array $labels = null, int $width = 18): array
    {
        $column = ['key' => $key, 'label' => ['en' => $en, 'ar' => $ar], 'type' => $type, 'width' => $width];
        if ($labels !== null) {
            $column['labels'] = array_map(static fn (array $l): array => ['en' => $l[0], 'ar' => $l[1]], $labels);
        }

        return $column;
    }

    /** @param  array<string,mixed>  $record */
    private static function cell(array $column, array $record): mixed
    {
        $value = $record[$column['key']] ?? null;
        if ($value === null || $value === '') {
            return null;
        }

        return match ($column['type']) {
            'money' => round(((int) $value) / 100, 2),
            'number' => is_numeric($value) ? $value + 0 : (string) $value,
            'bool' => (bool) $value,
            'enum' => (string) $value,
            default => is_scalar($value) ? (string) $value : json_encode($value, JSON_UNESCAPED_UNICODE),
        };
    }

    private function localDate(string $column): string
    {
        return "to_char({$column} at time zone ?, 'YYYY-MM-DD')";
    }

    private function localTime(string $column): string
    {
        return "to_char({$column} at time zone ?, 'HH24:MI')";
    }

    private function localDateTime(string $column): string
    {
        return "to_char({$column} at time zone ?, 'YYYY-MM-DD HH24:MI')";
    }
}
