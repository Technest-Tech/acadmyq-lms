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

        $tz = (string) (DB::table('academies')->where('id', $session->academy_id)->value('timezone') ?? 'UTC');
        $localDate = Carbon::parse($session->scheduled_at_utc)->setTimezone($tz)->format('Y-m-d');

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

        $studentName = $student?->full_name ?? '';
        $text = "تقرير حصة {$studentName} — {$localDate}\n".implode("\n", $linesAr)
            ."\n\n"
            ."Session report for {$studentName} — {$localDate}\n".implode("\n", $linesEn);

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
