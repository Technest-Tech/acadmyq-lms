<?php

declare(strict_types=1);

namespace App\Services\Whatsapp;

use App\Services\ClassGroups;
use App\Support\Entitlement;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;

/**
 * What the lesson reminders owe right now (`whatsapp.group_reminders`, the academy's WhatsApp page).
 * Every lesson is announced ahead of time and again when it starts, to whoever the academy chose:
 *
 *   - the channel: the WhatsApp GROUPS it assigned (a student's, a teacher's, a class's), a PRIVATE
 *     message to each person's own number, or BOTH;
 *   - the audience: students, teachers or both;
 *   - and nothing at all until the academy presses "launch" (`live`).
 *
 * {@see GroupAlerts} owns the rest — the ledger, pacing, sending, retries and delivery tracking — so
 * this only answers "who is owed which reminder?".
 *
 * Three kinds of lesson count, and each lives in its own table: a private lesson (`sessions`), a
 * free trial (`trials`) and a group-class lesson (`class_group_lessons`, whose students come from
 * its roster).
 *
 * The subject carries the lesson's start time, so moving a lesson reminds again at the new time. It
 * is the same subject whoever the group was assigned to, so a group shared by a student and their
 * teacher gets one message, not two — and a parent with two children in the same class gets one
 * private message, not two.
 */
final class LessonGroupReminders
{
    public const CHANNELS = ['GROUPS', 'PRIVATE', 'BOTH'];

    public const AUDIENCES = ['BOTH', 'STUDENTS', 'TEACHERS'];

    public const DEFAULT_SETTINGS = [
        'lead_minutes' => 30,
        'at_start' => true,
        'language' => 'ar',
        'channel' => 'GROUPS',
        'audience' => 'BOTH',
        'live' => false,
        'live_since' => null,
    ];

    /** The lead times offered; 0 = no reminder ahead of the lesson. */
    public const LEAD_CHOICES = [0, 10, 15, 30, 45, 60, 90, 120];

    private const TS = 'Y-m-d\TH:i:s.uP';

    private const LESSON_LIMIT = 1000;

    /** A number the gateway can address without guessing a country: E.164. */
    private const PHONE = '/^\+[1-9][0-9]{6,14}$/';

    public function __construct(private readonly ClassGroups $classGroups) {}

    /**
     * The academy's choices, or the defaults when it has never saved any.
     *
     * @return array{lead_minutes: int, at_start: bool, language: string, channel: string, audience: string, live: bool, live_since: ?string}
     */
    public function settings(string $academyId): array
    {
        $row = DB::table('academy_automation_settings')->where('academy_id', $academyId)->first([
            'lesson_reminder_lead_minutes', 'lesson_reminder_at_start', 'lesson_reminder_language',
            'lesson_reminder_channel', 'lesson_reminder_audience', 'lesson_reminders_live', 'lesson_reminders_live_since',
        ]);

        return $row === null ? self::DEFAULT_SETTINGS : [
            'lead_minutes' => (int) $row->lesson_reminder_lead_minutes,
            'at_start' => (bool) $row->lesson_reminder_at_start,
            'language' => (string) $row->lesson_reminder_language,
            'channel' => (string) $row->lesson_reminder_channel,
            'audience' => (string) $row->lesson_reminder_audience,
            'live' => (bool) $row->lesson_reminders_live,
            'live_since' => $row->lesson_reminders_live_since !== null
                ? CarbonImmutable::parse((string) $row->lesson_reminders_live_since)->toIso8601String()
                : null,
        ];
    }

    /** @param array{channel: string} $settings */
    public static function usesGroups(array $settings): bool
    {
        return $settings['channel'] !== 'PRIVATE';
    }

    /** @param array{channel: string} $settings */
    public static function usesPrivate(array $settings): bool
    {
        return $settings['channel'] !== 'GROUPS';
    }

    /** @param array{audience: string} $settings */
    public static function reachesStudents(array $settings): bool
    {
        return $settings['audience'] !== 'TEACHERS';
    }

    /** @param array{audience: string} $settings */
    public static function reachesTeachers(array $settings): bool
    {
        return $settings['audience'] !== 'STUDENTS';
    }

    /**
     * A number in the form the gateway reads without guessing a country, or null. Teachers' numbers
     * are stored as typed on older records, so the common "00…" prefix is accepted too.
     */
    public static function phone(?string $raw): ?string
    {
        $phone = preg_replace('/[\s\-().]/', '', trim((string) $raw)) ?? '';
        if (str_starts_with($phone, '00')) {
            $phone = '+'.substr($phone, 2);
        }

        return preg_match(self::PHONE, $phone) === 1 ? $phone : null;
    }

    /**
     * Private reminders launched: the engine's cheap check before it gives up on an academy that
     * has no WhatsApp group linked at all.
     */
    public function privateLive(string $academyId): bool
    {
        return DB::table('academy_automation_settings')
            ->where('academy_id', $academyId)
            ->where('lesson_reminders_live', true)
            ->where('lesson_reminder_channel', '<>', 'GROUPS')
            ->exists();
    }

    /**
     * Every reminder that is true at this moment: one per (target, stage, lesson), where a target is
     * a WhatsApp group or a phone number.
     *
     * @param  array<string, object>  $groups  the academy's active groups, by id
     * @param  array{lead_minutes: int, at_start: bool, language: string, channel: string, audience: string, live: bool}  $settings
     * @return list<array{group_id: ?string, phone: ?string, recipient_kind: ?string, recipient_name: ?string, type: string, subject: string, due_at: CarbonImmutable, payload: array<string,mixed>}>
     */
    public function due(string $academyId, array $groups, array $settings, CarbonImmutable $now): array
    {
        $lead = $settings['lead_minutes'];
        $atStart = $settings['at_start'];
        if (! $settings['live'] || ($lead <= 0 && ! $atStart)) {
            return [];
        }

        $from = $atStart ? $now->subMinutes(GroupAlertCatalog::MAX_AGE_MINUTES[GroupAlertCatalog::LESSON_STARTING]) : $now;
        $to = $now->addMinutes(max(0, $lead));

        $found = [];
        foreach ($this->lessons($academyId, $from, $to, $settings) as $lesson) {
            $start = $lesson['start'];
            if ($start->greaterThan($now)) {
                // A lesson booked inside the lead time has its reminder due in the past: that is
                // still worth sending, it has not started.
                [$type, $dueAt] = [GroupAlertCatalog::LESSON_REMINDER, $start->subMinutes($lead)];
            } elseif ($atStart) {
                [$type, $dueAt] = [GroupAlertCatalog::LESSON_STARTING, $start];
            } else {
                continue;
            }

            foreach ($this->targets($lesson, $groups, $settings) as $target) {
                $found[] = $target + [
                    'type' => $type,
                    'subject' => $lesson['subject'],
                    'due_at' => $dueAt,
                    'payload' => $lesson['payload'],
                ];
            }
        }

        return $found;
    }

    /**
     * Roughly how many messages the next 24 hours will take with these settings, whether launched or
     * not — so the page can warn before the number's daily cap is hit, not after.
     *
     * @param  array<string, object>  $groups
     * @param  array{lead_minutes: int, at_start: bool, channel: string, audience: string}  $settings
     */
    public function expectedNextDay(string $academyId, array $groups, array $settings, CarbonImmutable $now): int
    {
        $stages = ($settings['lead_minutes'] > 0 ? 1 : 0) + ($settings['at_start'] ? 1 : 0);
        if ($stages === 0) {
            return 0;
        }

        $targets = 0;
        foreach ($this->lessons($academyId, $now, $now->addDay(), $settings) as $lesson) {
            $targets += count($this->targets($lesson, $groups, $settings));
        }

        return $targets * $stages;
    }

    /**
     * Who one lesson reaches under these settings: each distinct group once, each distinct number once.
     *
     * @param  array{student_groups: list<?string>, teacher_groups: list<?string>, student_phones: list<array{phone: ?string, kind: string, name: string}>, teacher_phones: list<array{phone: ?string, kind: string, name: string}>}  $lesson
     * @param  array<string, object>  $groups
     * @param  array{channel: string, audience: string}  $settings
     * @return list<array{group_id: ?string, phone: ?string, recipient_kind: ?string, recipient_name: ?string}>
     */
    private function targets(array $lesson, array $groups, array $settings): array
    {
        $students = self::reachesStudents($settings);
        $teachers = self::reachesTeachers($settings);
        $out = [];

        if (self::usesGroups($settings)) {
            $ids = [...($students ? $lesson['student_groups'] : []), ...($teachers ? $lesson['teacher_groups'] : [])];
            foreach (array_unique(array_filter($ids)) as $groupId) {
                if (isset($groups[$groupId])) {
                    $out[] = ['group_id' => $groupId, 'phone' => null, 'recipient_kind' => null, 'recipient_name' => null];
                }
            }
        }

        if (self::usesPrivate($settings)) {
            $seen = [];
            foreach ([...($students ? $lesson['student_phones'] : []), ...($teachers ? $lesson['teacher_phones'] : [])] as $person) {
                $phone = self::phone($person['phone']);
                if ($phone === null || isset($seen[$phone])) {
                    continue;
                }
                $seen[$phone] = true;
                $out[] = ['group_id' => null, 'phone' => $phone, 'recipient_kind' => $person['kind'], 'recipient_name' => $person['name']];
            }
        }

        return $out;
    }

    /**
     * @param  array{channel: string}  $settings
     * @return list<array<string,mixed>>
     */
    private function lessons(string $academyId, CarbonImmutable $from, CarbonImmutable $to, array $settings): array
    {
        $window = [$from->format(self::TS), $to->format(self::TS)];
        // Groups only: a lesson nobody assigned a group to has nobody to remind, so it is not read.
        $everyone = self::usesPrivate($settings);

        return [
            ...$this->privateLessons($academyId, $window, $everyone),
            ...$this->trials($academyId, $window, $everyone),
            ...(Entitlement::hasCapability($academyId, 'groups') ? $this->classLessons($academyId, $window) : []),
        ];
    }

    /**
     * @param  array{0: string, 1: string}  $window
     * @return list<array<string,mixed>>
     */
    private function privateLessons(string $academyId, array $window, bool $everyone): array
    {
        $rows = DB::table('sessions as se')
            ->join('students as st', 'st.id', '=', 'se.student_id')
            ->leftJoin('teachers as te', 'te.id', '=', 'se.teacher_id')
            ->leftJoin('guardians as gu', fn (JoinClause $j) => $j->on('gu.id', '=', 'st.guardian_id')->whereNull('gu.deleted_at'))
            ->where('se.academy_id', $academyId)
            ->where('se.status', 'SCHEDULED')
            ->whereNull('se.hidden_at')
            ->whereNull('st.deleted_at')
            ->whereBetween('se.scheduled_at_utc', $window)
            ->when(! $everyone, fn (Builder $q) => $q->where(fn ($w) => $w->whereNotNull('st.whatsapp_group_id')->orWhereNotNull('te.whatsapp_group_id')))
            // A cancellation waiting on the owner's decision: announcing the lesson would be a guess.
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))
                ->from('session_cancellation_requests as r')
                ->whereColumn('r.session_id', 'se.id')
                ->where('r.status', 'PENDING')
                ->where('r.request_type', 'CANCEL'))
            ->orderBy('se.scheduled_at_utc')
            ->limit(self::LESSON_LIMIT)
            ->get([
                'se.id', 'se.scheduled_at_utc', 'se.duration_minutes',
                'st.full_name as student', 'st.status as student_status', 'st.whatsapp_group_id as student_group',
                'gu.whatsapp_phone as guardian_phone', 'st.whatsapp_phone as student_phone',
                'te.full_name as teacher',
                DB::raw('case when te.deleted_at is null then te.whatsapp_group_id end as teacher_group'),
                DB::raw('case when te.deleted_at is null then te.phone end as teacher_phone'),
            ]);

        return $rows->map(fn (object $s): array => $this->lesson(
            in_array($s->student_status, ['TRIAL', 'TRIAL_BOOKED'], true) ? 'TRIAL' : 'LESSON',
            (string) $s->id,
            $s,
            [
                'student_groups' => [$this->id($s->student_group)],
                'teacher_groups' => [$this->id($s->teacher_group)],
                'student_phones' => [$this->studentPhone($s)],
                'teacher_phones' => [['phone' => $s->teacher_phone, 'kind' => 'TEACHER', 'name' => (string) $s->teacher]],
            ],
            ['student' => $s->student],
        ))->all();
    }

    /**
     * A prospect (CRM lead or typed name) has no student record, so their trial reaches the teacher
     * alone.
     *
     * @param  array{0: string, 1: string}  $window
     * @return list<array<string,mixed>>
     */
    private function trials(string $academyId, array $window, bool $everyone): array
    {
        $rows = DB::table('trials as tr')
            ->leftJoin('teachers as te', 'te.id', '=', 'tr.teacher_id')
            ->leftJoin('students as st', 'st.id', '=', 'tr.student_id')
            ->leftJoin('guardians as gu', fn (JoinClause $j) => $j->on('gu.id', '=', 'st.guardian_id')->whereNull('gu.deleted_at'))
            ->leftJoin('crm_leads as cl', 'cl.id', '=', 'tr.lead_id')
            ->where('tr.academy_id', $academyId)
            ->where('tr.status', 'SCHEDULED')
            ->whereNull('tr.deleted_at')
            ->whereBetween('tr.scheduled_at_utc', $window)
            ->when(! $everyone, fn (Builder $q) => $q->where(fn ($w) => $w->whereNotNull('st.whatsapp_group_id')->orWhereNotNull('te.whatsapp_group_id')))
            ->orderBy('tr.scheduled_at_utc')
            ->limit(self::LESSON_LIMIT)
            ->get([
                'tr.id', 'tr.scheduled_at_utc', 'tr.duration_minutes', 'te.full_name as teacher',
                DB::raw('coalesce(st.full_name, cl.full_name, tr.lead_name) as student'),
                DB::raw('case when st.deleted_at is null then st.whatsapp_group_id end as student_group'),
                DB::raw('case when st.deleted_at is null then gu.whatsapp_phone end as guardian_phone'),
                DB::raw('case when st.deleted_at is null then st.whatsapp_phone end as student_phone'),
                DB::raw('case when te.deleted_at is null then te.whatsapp_group_id end as teacher_group'),
                DB::raw('case when te.deleted_at is null then te.phone end as teacher_phone'),
            ]);

        return $rows->map(fn (object $t): array => $this->lesson(
            'TRIAL',
            (string) $t->id,
            $t,
            [
                'student_groups' => [$this->id($t->student_group)],
                'teacher_groups' => [$this->id($t->teacher_group)],
                'student_phones' => [$this->studentPhone($t)],
                'teacher_phones' => [['phone' => $t->teacher_phone, 'kind' => 'TEACHER', 'name' => (string) $t->teacher]],
            ],
            ['student' => $t->student],
        ))->all();
    }

    /**
     * A group-class lesson reaches the class's own WhatsApp group, its teacher, and every student on
     * its roster — {@see ClassGroups::roster()} decides who that is (joined, not left, not taken off
     * this sheet, family not suspended) so the reminders can never disagree with the attendance sheet.
     *
     * @param  array{0: string, 1: string}  $window
     * @return list<array<string,mixed>>
     */
    private function classLessons(string $academyId, array $window): array
    {
        $rows = DB::table('class_group_lessons as l')
            ->join('class_groups as g', 'g.id', '=', 'l.group_id')
            ->leftJoin('teachers as te', 'te.id', '=', 'l.teacher_id')
            ->where('l.academy_id', $academyId)
            ->where('l.status', 'SCHEDULED')
            ->whereBetween('l.scheduled_at_utc', $window)
            ->orderBy('l.scheduled_at_utc')
            ->limit(self::LESSON_LIMIT)
            ->get([
                'l.id', 'l.academy_id', 'l.group_id', 'l.occurrence_local_date', 'l.scheduled_at_utc', 'l.duration_minutes',
                'g.name as class_name', 'g.whatsapp_group_id as class_group', 'te.full_name as teacher',
                DB::raw('case when te.deleted_at is null then te.whatsapp_group_id end as teacher_group'),
                DB::raw('case when te.deleted_at is null then te.phone end as teacher_phone'),
            ]);

        return $rows->map(function (object $l): array {
            $studentIds = $this->classGroups->roster($l)->pluck('student_id')->all();
            $students = $studentIds === [] ? collect() : DB::table('students as st')
                ->leftJoin('guardians as gu', fn (JoinClause $j) => $j->on('gu.id', '=', 'st.guardian_id')->whereNull('gu.deleted_at'))
                ->whereIn('st.id', $studentIds)
                ->get(['st.full_name as student', 'st.whatsapp_group_id', 'gu.whatsapp_phone as guardian_phone', 'st.whatsapp_phone as student_phone']);

            return $this->lesson('CLASS', (string) $l->id, $l, [
                'student_groups' => [$this->id($l->class_group), ...$students->map(fn (object $s) => $this->id($s->whatsapp_group_id))->all()],
                'teacher_groups' => [$this->id($l->teacher_group)],
                'student_phones' => $students->map(fn (object $s): array => $this->studentPhone($s))->all(),
                'teacher_phones' => [['phone' => $l->teacher_phone, 'kind' => 'TEACHER', 'name' => (string) $l->teacher]],
            ], ['class' => $l->class_name]);
        })->all();
    }

    /**
     * A student is reached on their family's number when the family has one, else their own.
     *
     * @return array{phone: ?string, kind: string, name: string}
     */
    private function studentPhone(object $row): array
    {
        $guardian = self::phone($row->guardian_phone ?? null);

        return [
            'phone' => $guardian ?? ($row->student_phone ?? null),
            'kind' => $guardian !== null ? 'GUARDIAN' : 'STUDENT',
            'name' => (string) ($row->student ?? ''),
        ];
    }

    private function id(mixed $value): ?string
    {
        return $value !== null ? (string) $value : null;
    }

    /**
     * @param  array{student_groups: list<?string>, teacher_groups: list<?string>, student_phones: list<array<string,mixed>>, teacher_phones: list<array<string,mixed>>}  $reach
     * @param  array<string,mixed>  $names
     * @return array<string,mixed>
     */
    private function lesson(string $kind, string $id, object $row, array $reach, array $names): array
    {
        $start = CarbonImmutable::parse($row->scheduled_at_utc);

        return [
            'subject' => strtolower($kind).':'.$id.':'.$start->getTimestamp(),
            'start' => $start,
            ...$reach,
            'payload' => [
                'kind' => $kind,
                'teacher' => $row->teacher,
                'starts_at' => $start->utc()->format(self::TS),
                'duration_minutes' => (int) $row->duration_minutes,
                ...$names,
            ],
        ];
    }
}
