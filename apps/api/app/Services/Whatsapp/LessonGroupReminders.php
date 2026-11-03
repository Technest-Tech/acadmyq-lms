<?php

declare(strict_types=1);

namespace App\Services\Whatsapp;

use App\Services\ClassGroups;
use App\Support\Entitlement;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * What the lesson reminders owe right now (`whatsapp.group_reminders`): a student and a teacher can
 * each be assigned a WhatsApp group, and every lesson of theirs is announced there ahead of time
 * and again when it starts. {@see GroupAlerts} owns the rest — the ledger, sending, retries and
 * delivery tracking — so this only answers "which group is owed which reminder?".
 *
 * Three kinds of lesson count, and each lives in its own table: a private lesson (`sessions`), a
 * free trial (`trials`) and a group-class lesson (`class_group_lessons`, whose students come from
 * its roster).
 *
 * The subject carries the lesson's start time, so moving a lesson reminds again at the new time. It
 * is the same subject whoever the group was assigned to, so a group shared by a student and their
 * teacher gets one message, not two.
 */
final class LessonGroupReminders
{
    public const DEFAULT_SETTINGS = ['lead_minutes' => 30, 'at_start' => true, 'language' => 'ar'];

    /** The lead times offered; 0 = no reminder ahead of the lesson. */
    public const LEAD_CHOICES = [0, 10, 15, 30, 45, 60, 90, 120];

    private const TS = 'Y-m-d\TH:i:s.uP';

    private const LESSON_LIMIT = 1000;

    public function __construct(private readonly ClassGroups $classGroups) {}

    /**
     * The academy's timing and language, or the defaults when it has never saved any.
     *
     * @return array{lead_minutes: int, at_start: bool, language: string}
     */
    public function settings(string $academyId): array
    {
        $row = DB::table('academy_automation_settings')->where('academy_id', $academyId)
            ->first(['lesson_reminder_lead_minutes', 'lesson_reminder_at_start', 'lesson_reminder_language']);

        return $row === null ? self::DEFAULT_SETTINGS : [
            'lead_minutes' => (int) $row->lesson_reminder_lead_minutes,
            'at_start' => (bool) $row->lesson_reminder_at_start,
            'language' => (string) $row->lesson_reminder_language,
        ];
    }

    /**
     * Every reminder that is true at this moment: one per (group, stage, lesson).
     *
     * @param  array<string, object>  $groups  the academy's active groups, by id
     * @param  array{lead_minutes: int, at_start: bool, language: string}  $settings
     * @return list<array{group_id: string, type: string, subject: string, due_at: CarbonImmutable, payload: array<string,mixed>}>
     */
    public function due(string $academyId, array $groups, array $settings, CarbonImmutable $now): array
    {
        $lead = $settings['lead_minutes'];
        $atStart = $settings['at_start'];
        if ($lead <= 0 && ! $atStart) {
            return [];
        }

        $from = $atStart ? $now->subMinutes(GroupAlertCatalog::MAX_AGE_MINUTES[GroupAlertCatalog::LESSON_STARTING]) : $now;
        $to = $now->addMinutes(max(0, $lead));

        $found = [];
        foreach ($this->lessons($academyId, $from, $to) as $lesson) {
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

            foreach (array_unique(array_filter($lesson['groups'])) as $groupId) {
                if (! isset($groups[$groupId])) {
                    continue;
                }
                $found[] = [
                    'group_id' => $groupId,
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
     * @return list<array{subject: string, start: CarbonImmutable, groups: list<?string>, payload: array<string,mixed>}>
     */
    private function lessons(string $academyId, CarbonImmutable $from, CarbonImmutable $to): array
    {
        $window = [$from->format(self::TS), $to->format(self::TS)];

        return [
            ...$this->privateLessons($academyId, $window),
            ...$this->trials($academyId, $window),
            ...(Entitlement::hasCapability($academyId, 'groups') ? $this->classLessons($academyId, $window) : []),
        ];
    }

    /**
     * @param  array{0: string, 1: string}  $window
     * @return list<array{subject: string, start: CarbonImmutable, groups: list<?string>, payload: array<string,mixed>}>
     */
    private function privateLessons(string $academyId, array $window): array
    {
        $rows = DB::table('sessions as se')
            ->join('students as st', 'st.id', '=', 'se.student_id')
            ->leftJoin('teachers as te', 'te.id', '=', 'se.teacher_id')
            ->where('se.academy_id', $academyId)
            ->where('se.status', 'SCHEDULED')
            ->whereNull('se.hidden_at')
            ->whereNull('st.deleted_at')
            ->whereBetween('se.scheduled_at_utc', $window)
            ->where(fn ($q) => $q->whereNotNull('st.whatsapp_group_id')->orWhereNotNull('te.whatsapp_group_id'))
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
                'te.full_name as teacher',
                DB::raw('case when te.deleted_at is null then te.whatsapp_group_id end as teacher_group'),
            ]);

        return $rows->map(fn (object $s): array => $this->lesson(
            in_array($s->student_status, ['TRIAL', 'TRIAL_BOOKED'], true) ? 'TRIAL' : 'LESSON',
            (string) $s->id,
            $s,
            [(string) $s->student_group, (string) $s->teacher_group],
            ['student' => $s->student],
        ))->all();
    }

    /**
     * A prospect (CRM lead or typed name) has no student record, so their trial reaches the teacher's
     * group alone.
     *
     * @param  array{0: string, 1: string}  $window
     * @return list<array{subject: string, start: CarbonImmutable, groups: list<?string>, payload: array<string,mixed>}>
     */
    private function trials(string $academyId, array $window): array
    {
        $rows = DB::table('trials as tr')
            ->leftJoin('teachers as te', 'te.id', '=', 'tr.teacher_id')
            ->leftJoin('students as st', 'st.id', '=', 'tr.student_id')
            ->leftJoin('crm_leads as cl', 'cl.id', '=', 'tr.lead_id')
            ->where('tr.academy_id', $academyId)
            ->where('tr.status', 'SCHEDULED')
            ->whereNull('tr.deleted_at')
            ->whereBetween('tr.scheduled_at_utc', $window)
            ->where(fn ($q) => $q->whereNotNull('st.whatsapp_group_id')->orWhereNotNull('te.whatsapp_group_id'))
            ->orderBy('tr.scheduled_at_utc')
            ->limit(self::LESSON_LIMIT)
            ->get([
                'tr.id', 'tr.scheduled_at_utc', 'tr.duration_minutes', 'te.full_name as teacher',
                DB::raw('coalesce(st.full_name, cl.full_name, tr.lead_name) as student'),
                DB::raw('case when st.deleted_at is null then st.whatsapp_group_id end as student_group'),
                DB::raw('case when te.deleted_at is null then te.whatsapp_group_id end as teacher_group'),
            ]);

        return $rows->map(fn (object $t): array => $this->lesson(
            'TRIAL',
            (string) $t->id,
            $t,
            [(string) $t->student_group, (string) $t->teacher_group],
            ['student' => $t->student],
        ))->all();
    }

    /**
     * A group-class lesson reaches its teacher's group and the group of every student on its roster —
     * {@see ClassGroups::roster()} decides who that is (joined, not left, not taken off this sheet,
     * family not suspended) so the reminders can never disagree with the attendance sheet.
     *
     * @param  array{0: string, 1: string}  $window
     * @return list<array{subject: string, start: CarbonImmutable, groups: list<?string>, payload: array<string,mixed>}>
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
                'g.name as class_name', 'te.full_name as teacher',
                DB::raw('case when te.deleted_at is null then te.whatsapp_group_id end as teacher_group'),
            ]);

        return $rows->map(function (object $l): array {
            $studentIds = $this->classGroups->roster($l)->pluck('student_id')->all();
            $studentGroups = $studentIds === [] ? [] : DB::table('students')
                ->whereIn('id', $studentIds)
                ->whereNotNull('whatsapp_group_id')
                ->pluck('whatsapp_group_id')
                ->map(fn ($id) => (string) $id)
                ->all();

            return $this->lesson('CLASS', (string) $l->id, $l, [(string) $l->teacher_group, ...$studentGroups], ['class' => $l->class_name]);
        })->all();
    }

    /**
     * @param  list<?string>  $groups
     * @param  array<string,mixed>  $names
     * @return array{subject: string, start: CarbonImmutable, groups: list<?string>, payload: array<string,mixed>}
     */
    private function lesson(string $kind, string $id, object $row, array $groups, array $names): array
    {
        $start = CarbonImmutable::parse($row->scheduled_at_utc);

        return [
            'subject' => strtolower($kind).':'.$id.':'.$start->getTimestamp(),
            'start' => $start,
            'groups' => $groups,
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
