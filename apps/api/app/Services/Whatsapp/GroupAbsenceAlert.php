<?php

declare(strict_types=1);

namespace App\Services\Whatsapp;

use App\Jobs\GroupAbsenceAlertJob;
use App\Support\Entitlement;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * "Your child did not come today" — one WhatsApp message to the family the moment a group sheet
 * marks their child ABSENT (docs/centre-profile, Phase 2 §4).
 *
 * The seam the attendance sheet fires is {@see sheetSaved()}: it reads the centre's switch
 * (`academy_automation_settings.group_absence_alert_enabled`, OFF until the centre turns it on in
 * Settings) and does nothing when it is off — so for every other academy the sheet behaves as it
 * always did. When on, the send itself is handed to {@see GroupAbsenceAlertJob} after the response,
 * so a slow gateway never holds the teacher's save.
 *
 * Only ABSENT earns a message: late is "they came", excused is "you already told us". The sender's
 * dedupe key is (lesson, student), so re-saving the sheet, or marking the same child absent again
 * after a revert, never sends twice. Each send lands in automation_send_log as GROUP_ABSENCE.
 *
 * The text is the centre's own wording when it wrote one, else the GROUP_ABSENCE template in the
 * language the academy writes its WhatsApp in ({@see LessonGroupReminders::settings()} — Arabic by
 * default). Placeholders: {{student}}, {{group}}, {{date}}, {{time}}, {{academy}}.
 */
final class GroupAbsenceAlert
{
    public const TEMPLATE_KEY = 'GROUP_ABSENCE';

    public const PLACEHOLDERS = ['student', 'group', 'date', 'time', 'academy'];

    public function __construct(private readonly WhatsAppSender $sender) {}

    /**
     * The sheet of $lesson was just saved with these marks (student id → status). Fires once per
     * save; the job decides whom to message.
     *
     * @param  array<string, string>  $marks
     */
    public function sheetSaved(object $lesson, array $marks): void
    {
        $absent = array_keys(array_filter($marks, fn (string $status): bool => $status === 'ABSENT'));
        if ($absent === []) {
            return;
        }

        $academyId = (string) $lesson->academy_id;
        if (! $this->enabledFor($academyId)) {
            return;
        }

        GroupAbsenceAlertJob::dispatchAfterResponse($academyId, (string) $lesson->id, array_values($absent));
    }

    /**
     * The switch is the centre's and the feature is a centre's: both must hold. The row is read
     * first — one indexed lookup, the price every sheet save pays for the seam — and the
     * capability only once the switch is on.
     */
    public function enabledFor(string $academyId): bool
    {
        $on = (bool) DB::table('academy_automation_settings')
            ->where('academy_id', $academyId)
            ->value('group_absence_alert_enabled');

        return $on && Entitlement::hasCapability($academyId, 'centre');
    }

    /**
     * The centre's switch and wording as Settings shows them.
     *
     * @return array{enabled: bool, message: ?string, default_message: string}
     */
    public function settings(string $academyId): array
    {
        $row = DB::table('academy_automation_settings')->where('academy_id', $academyId)
            ->first(['group_absence_alert_enabled', 'group_absence_alert_message']);
        $message = $row !== null ? trim((string) ($row->group_absence_alert_message ?? '')) : '';

        return [
            'enabled' => $row !== null && (bool) $row->group_absence_alert_enabled,
            'message' => $message !== '' ? $message : null,
            'default_message' => $this->defaultMessage($academyId),
        ];
    }

    /**
     * Send to every family named, inside the academy's tenant context (the job's). Returns how
     * many messages went out or were linked — a duplicate counts as nothing.
     *
     * @param  list<string>  $studentIds
     */
    public function send(string $academyId, string $lessonId, array $studentIds): int
    {
        if ($studentIds === [] || ! $this->enabledFor($academyId)) {
            return 0;
        }

        $lesson = DB::table('class_group_lessons as l')
            ->join('class_groups as g', 'g.id', '=', 'l.group_id')
            ->where('l.id', $lessonId)
            ->first(['l.id', 'l.scheduled_at_utc', 'g.name as group_name']);
        if ($lesson === null) {
            return 0;
        }

        $academy = DB::table('academies')->where('id', $academyId)->first(['name', 'brand_display_name', 'timezone']);
        $academyName = trim((string) ($academy->brand_display_name ?? '')) ?: trim((string) ($academy->name ?? ''));
        $language = app(LessonGroupReminders::class)->settings($academyId)['language'];
        $template = $this->template($academyId, $language);
        $when = CarbonImmutable::parse($lesson->scheduled_at_utc)->setTimezone((string) ($academy->timezone ?? 'UTC'));

        // A child's own number stands in when they have no guardian on file (an adult learner).
        $students = DB::table('students as s')
            ->leftJoin('guardians as g', 'g.id', '=', 's.guardian_id')
            ->whereIn('s.id', $studentIds)
            ->get(['s.id', 's.full_name', 's.whatsapp_phone as own_phone', 'g.id as guardian_id', 'g.whatsapp_phone as guardian_phone', 'g.deleted_at as guardian_gone']);

        $sent = 0;
        foreach ($students as $student) {
            $toGuardian = $student->guardian_id !== null && $student->guardian_gone === null && trim((string) $student->guardian_phone) !== '';
            $phone = trim((string) ($toGuardian ? $student->guardian_phone : $student->own_phone));
            if ($phone === '') {
                continue;
            }

            $message = $this->interpolate($template, [
                'student' => (string) $student->full_name,
                'group' => (string) $lesson->group_name,
                'date' => $this->date($when, $language),
                'time' => $this->time($when, $language),
                'academy' => $academyName,
            ]);

            $result = $this->sender->sendOrLink($academyId, $phone, $message, [
                'automation_type' => 'GROUP_ABSENCE',
                'recipient_kind' => $toGuardian ? 'GUARDIAN' : 'STUDENT',
                'recipient_id' => $toGuardian ? (string) $student->guardian_id : (string) $student->id,
                'template_key' => self::TEMPLATE_KEY,
                'ref_type' => 'class_group_lesson',
                'ref_id' => $lessonId,
                'dedupe_key' => self::dedupeKey($lessonId, (string) $student->id),
            ]);
            if (! $result['duplicate']) {
                $sent++;
            }
        }

        return $sent;
    }

    public static function dedupeKey(string $lessonId, string $studentId): string
    {
        return "group_absence:{$lessonId}:{$studentId}";
    }

    /** The platform's text in the academy's WhatsApp language. */
    public function defaultMessage(string $academyId): string
    {
        return $this->platformText(app(LessonGroupReminders::class)->settings($academyId)['language']);
    }

    /** The message as a parent would read it, with stand-in values — for the Settings preview. */
    public function sample(string $academyId, ?string $message): string
    {
        $language = app(LessonGroupReminders::class)->settings($academyId)['language'];
        $text = trim((string) $message) !== '' ? (string) $message : $this->platformText($language);
        $academy = DB::table('academies')->where('id', $academyId)->first(['name', 'brand_display_name', 'timezone']);
        $when = CarbonImmutable::now()->setTimezone((string) ($academy->timezone ?? 'UTC'))->setTime(17, 0);

        return $this->interpolate($text, [
            'student' => $language === 'ar' ? 'آدم' : 'Adam',
            'group' => $language === 'ar' ? 'English A1 — مساءً' : 'English A1 — evening',
            'date' => $this->date($when, $language),
            'time' => $this->time($when, $language),
            'academy' => trim((string) ($academy->brand_display_name ?? '')) ?: trim((string) ($academy->name ?? '')),
        ]);
    }

    private function template(string $academyId, string $language): string
    {
        $own = trim((string) DB::table('academy_automation_settings')->where('academy_id', $academyId)->value('group_absence_alert_message'));

        return $own !== '' ? $own : $this->platformText($language);
    }

    private function platformText(string $language): string
    {
        $row = DB::table('message_templates')->where('key', self::TEMPLATE_KEY)->where('is_active', true)->first(['body_ar', 'body_en']);
        if ($row === null) {
            return '';
        }

        return (string) ($language === 'en' ? $row->body_en : $row->body_ar);
    }

    /**
     * @param  array<string, string>  $vars
     */
    private function interpolate(string $body, array $vars): string
    {
        return (string) preg_replace_callback(
            '/\{\{\s*(\w+)\s*\}\}/',
            fn (array $m): string => (string) ($vars[$m[1]] ?? ''),
            $body,
        );
    }

    /** "الأربعاء 17 يونيو 2026" / "Wednesday 17 June 2026", in the academy's own clock. */
    private function date(CarbonImmutable $at, string $language): string
    {
        return $at->locale($language === 'en' ? 'en' : 'ar')->translatedFormat('l j F Y');
    }

    /** "5:00 م" / "5:00 PM". */
    private function time(CarbonImmutable $at, string $language): string
    {
        $suffix = $at->hour < 12 ? ($language === 'en' ? 'AM' : 'ص') : ($language === 'en' ? 'PM' : 'م');

        return $at->format('g:i').' '.$suffix;
    }
}
