<?php

declare(strict_types=1);

namespace App\Services\Reports;

use App\Support\ReportFields;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Build the MANUAL WhatsApp report (Sprint 6 §6.4). The MVP does NOT send anything: it composes
 * a bilingual summary from the structured report values and a `wa.me` deep link to the guardian's
 * E.164 number (Sprint 4 normalised it), which the UI offers to copy/open. Sprint 10 will reuse
 * this builder for automated templated delivery.
 *
 * The message lists every field that has a value — including a deactivated field that still
 * carries a historical value (deactivate-not-delete) — labelled in both Arabic and English so the
 * guardian reads it in either language (R-LOC).
 */
final class WhatsAppReportBuilder
{
    /**
     * @return array{text: string, phone: string, deeplink: string}
     */
    public function build(object $session, object $report): array
    {
        $values = is_string($report->values) ? (json_decode($report->values, true) ?: []) : (array) $report->values;

        $student = DB::table('students')->where('id', $session->student_id)->first(['full_name', 'guardian_id']);
        $guardian = $student !== null
            ? DB::table('guardians')->where('id', $student->guardian_id)->first(['full_name', 'whatsapp_phone'])
            : null;

        $academy = DB::table('academies')->where('id', $session->academy_id)->first(['name', 'timezone']);
        $tz = (string) ($academy->timezone ?? 'UTC');
        $localDate = Carbon::parse($session->scheduled_at_utc)->setTimezone($tz)->format('Y-m-d');

        $academyName = trim((string) ($academy->name ?? ''));
        $teacherName = (string) (DB::table('teachers')->where('id', $session->teacher_id)->value('full_name') ?? '');
        $duration = (int) ($session->duration_minutes ?? 0);
        $studentName = $student?->full_name ?? '';

        // Active fields first (form order), then any deactivated field that still has a value.
        $fields = array_merge(
            ReportFields::active((string) $session->academy_id),
            ReportFields::inactiveWithValues((string) $session->academy_id, $values),
        );

        $linesAr = [];
        $linesEn = [];
        foreach ($fields as $field) {
            if (! array_key_exists($field->key, $values)) {
                continue;
            }
            $rendered = $this->renderValue($values[$field->key]);
            if ($rendered === '') {
                continue;
            }
            $linesAr[] = "• {$field->label_ar}: {$rendered}";
            $linesEn[] = "• {$field->label_en}: {$rendered}";
        }

        // Modern bilingual card: academy header, the session facts, then the report fields.
        $headerAr = ['📋 *تقرير الحصة*'];
        if ($academyName !== '') {
            $headerAr[] = "🏫 {$academyName}";
        }
        $headerAr[] = "👤 الطالب: {$studentName}";
        if ($teacherName !== '') {
            $headerAr[] = "👨‍🏫 المعلّم: {$teacherName}";
        }
        $headerAr[] = "📅 التاريخ: {$localDate}";
        if ($duration > 0) {
            $headerAr[] = "⏱ المدة: {$duration} دقيقة";
        }

        $headerEn = ['📋 *Session Report*'];
        if ($academyName !== '') {
            $headerEn[] = "🏫 {$academyName}";
        }
        $headerEn[] = "👤 Student: {$studentName}";
        if ($teacherName !== '') {
            $headerEn[] = "👨‍🏫 Teacher: {$teacherName}";
        }
        $headerEn[] = "📅 Date: {$localDate}";
        if ($duration > 0) {
            $headerEn[] = "⏱ Duration: {$duration} min";
        }

        $blockAr = implode("\n", $headerAr).($linesAr !== [] ? "\n\n📝 ملاحظات:\n".implode("\n", $linesAr) : '');
        $blockEn = implode("\n", $headerEn).($linesEn !== [] ? "\n\n📝 Notes:\n".implode("\n", $linesEn) : '');

        $text = $blockAr."\n\n———\n\n".$blockEn;

        $phone = (string) ($guardian?->whatsapp_phone ?? '');
        $digits = preg_replace('/\D+/', '', $phone) ?? '';
        $deeplink = 'https://wa.me/'.$digits.'?text='.rawurlencode($text);

        return ['text' => $text, 'phone' => $phone, 'deeplink' => $deeplink];
    }

    private function renderValue(mixed $value): string
    {
        if (is_bool($value)) {
            return $value ? 'true' : 'false';
        }

        return trim((string) $value);
    }
}
