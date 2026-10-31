<?php

declare(strict_types=1);

namespace App\Services\Reports;

use App\Support\Entitlement;
use App\Support\ReportFields;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * The academy's own lesson-report message (the `lesson_report` capability): their WhatsApp text,
 * written once in Settings with `{placeholders}`, filled from one lesson's report values.
 *
 * Two kinds of placeholder:
 *   - the lesson's facts, which nobody types: {academy} {teacher} {student} {day} {date}
 *     {attendance} {duration};
 *   - one per report field, by its key — a score field ("out of" a max) renders as "9 / 10".
 *
 * A line whose field placeholders were ALL left empty is dropped, so an optional field the teacher
 * skipped this lesson ("التربية الدينية") leaves no dangling label behind. Facts never drop a line.
 * Unknown placeholders are left as typed, so a typo shows up in the preview instead of vanishing.
 */
final class LessonReportMessage
{
    /** The facts every message can use, in the order Settings offers them. */
    public const FACTS = ['academy', 'teacher', 'student', 'day', 'date', 'attendance', 'duration'];

    private const ATTENDANCE = [
        'ar' => [
            'ATTENDED' => 'تم الحضور',
            'FREE' => 'تم الحضور',
            'CANCELLED_BY_STUDENT' => 'اعتذر الطالب',
            'CANCELLED_BY_TEACHER' => 'اعتذر المعلم',
            'ABSENT_UNEXCUSED' => 'غياب',
            'ABSENT_EXCUSED' => 'غياب بعذر',
            'RESCHEDULED' => 'تم تأجيل الحلقة',
            'SCHEDULED' => 'لم يُسجَّل بعد',
        ],
        'en' => [
            'ATTENDED' => 'Attended',
            'FREE' => 'Attended',
            'CANCELLED_BY_STUDENT' => 'Student excused',
            'CANCELLED_BY_TEACHER' => 'Teacher excused',
            'ABSENT_UNEXCUSED' => 'Absent',
            'ABSENT_EXCUSED' => 'Absent (excused)',
            'RESCHEDULED' => 'Rescheduled',
            'SCHEDULED' => 'Not marked yet',
        ],
    ];

    /** The saved message, or null when the academy doesn't use structured reports (or left it blank). */
    public static function templateFor(string $academyId): ?string
    {
        if (! Entitlement::hasCapability($academyId, 'lesson_report')) {
            return null;
        }

        $message = (string) DB::table('lesson_report_templates')->where('academy_id', $academyId)->value('message');

        return trim($message) === '' ? null : $message;
    }

    /** The message for one lesson: its facts and its report values poured into $template. */
    public function forSession(string $template, object $session, array $values): string
    {
        $academy = DB::table('academies')->where('id', $session->academy_id)->first(['name', 'timezone']);
        $lang = self::language($template);
        $when = Carbon::parse($session->scheduled_at_utc)->setTimezone((string) ($academy->timezone ?? 'UTC'));

        $facts = [
            'academy' => trim((string) ($academy->name ?? '')),
            'teacher' => (string) (DB::table('teachers')->where('id', $session->teacher_id)->value('full_name') ?? ''),
            'student' => (string) (DB::table('students')->where('id', $session->student_id)->value('full_name') ?? ''),
            'day' => $when->copy()->locale($lang)->dayName,
            'date' => $when->format('d/m/Y'),
            'attendance' => self::ATTENDANCE[$lang][(string) $session->status] ?? (string) $session->status,
            'duration' => (string) (int) $session->duration_minutes,
        ];

        $fields = array_merge(
            ReportFields::active((string) $session->academy_id),
            ReportFields::inactiveWithValues((string) $session->academy_id, $values),
        );

        return $this->render($template, $facts, $fields, $values);
    }

    /**
     * @param  array<string,string>  $facts
     * @param  list<object>  $fields  report field definitions (key, field_type, max_value)
     * @param  array<string,mixed>  $values
     */
    public function render(string $template, array $facts, array $fields, array $values): string
    {
        $fieldText = [];
        foreach ($fields as $field) {
            $fieldText[$field->key] = self::fieldValue($field, $values[$field->key] ?? null);
        }

        $out = [];
        foreach (preg_split('/\R/u', $template) ?: [] as $line) {
            preg_match_all('/\{([a-z][a-z0-9_]*)\}/', $line, $m);
            $fieldKeys = array_values(array_filter($m[1], fn ($k) => array_key_exists($k, $fieldText)));
            if ($fieldKeys !== [] && array_filter($fieldKeys, fn ($k) => $fieldText[$k] !== '') === []) {
                continue;
            }

            $out[] = preg_replace_callback('/\{([a-z][a-z0-9_]*)\}/', function ($match) use ($facts, $fieldText) {
                return $fieldText[$match[1]] ?? $facts[$match[1]] ?? $match[0];
            }, $line);
        }

        // A dropped line can leave two blank lines meeting; keep the spacing the academy wrote.
        $text = preg_replace("/\n{3,}/", "\n\n", implode("\n", $out)) ?? '';

        return trim($text);
    }

    /** The lesson facts with believable stand-ins, for the Settings preview. */
    public static function sampleFacts(string $academyName, string $template): array
    {
        $lang = self::language($template);
        $now = Carbon::now('Africa/Cairo');

        return [
            'academy' => $academyName,
            'teacher' => $lang === 'ar' ? 'آية مصطفى' : 'Aya Mostafa',
            'student' => $lang === 'ar' ? 'منار محمد' : 'Manar Mohamed',
            'day' => $now->copy()->locale($lang)->dayName,
            'date' => $now->format('d/m/Y'),
            'attendance' => self::ATTENDANCE[$lang]['ATTENDED'],
            'duration' => '40',
        ];
    }

    /** A filled-in value per field, for the Settings preview. */
    public static function sampleValues(array $fields): array
    {
        $values = [];
        foreach ($fields as $field) {
            $values[$field->key] = match ($field->field_type) {
                'NUMBER' => $field->max_value !== null ? max(0, (int) $field->max_value - 1) : 5,
                'SELECT', 'RATING' => is_array($field->options) && $field->options !== [] ? (string) $field->options[0] : '5',
                default => '…',
            };
        }

        return $values;
    }

    private static function fieldValue(object $field, mixed $value): string
    {
        if ($value === null || (is_string($value) && trim($value) === '')) {
            return '';
        }
        $text = is_bool($value) ? ($value ? '✓' : '✗') : trim((string) $value);

        return $field->field_type === 'NUMBER' && $field->max_value !== null
            ? "{$text} / {$field->max_value}"
            : $text;
    }

    /** Arabic day names and attendance words for an Arabic message, English otherwise. */
    private static function language(string $template): string
    {
        return preg_match('/\p{Arabic}/u', $template) === 1 ? 'ar' : 'en';
    }
}
