<?php

declare(strict_types=1);

namespace App\Services\Reports;

use App\Support\ReportFields;
use Illuminate\Validation\ValidationException;

/**
 * Validate a submitted report against the academy's ACTIVE field definitions (Sprint 6 §6.2):
 * required fields must be present, NUMBER must parse, SELECT/RATING values must be one of the
 * declared options. Validation is enforced at submit against `is_required` AT THE TIME OF ENTRY
 * (decision §3.5) — a later change to a field never retroactively invalidates an archived report.
 *
 * Errors are field-level and bilingual (key `values.<key>`), so the form can show them inline
 * (AC-6.5). Only active fields are validated/returned; values for deactivated fields are left to
 * the caller to preserve (deactivate-not-delete, AC-6.6).
 */
final class ReportValidator
{
    /**
     * @param  array<string,mixed>  $input  raw submitted values keyed by field `key`
     * @return array<string,mixed>  cleaned values for the active fields (NUMBER cast to number)
     */
    public static function validate(string $academyId, array $input): array
    {
        $errors = [];
        $clean = [];

        // When the submission contains the report_text key (new free-text UI), structured
        // required fields are no longer enforced — the academy uses free-text reporting.
        $hasFreeText = array_key_exists('report_text', $input);

        foreach (ReportFields::active($academyId) as $field) {
            $key = $field->key;
            $value = $input[$key] ?? null;
            $present = $value !== null && $value !== '';

            if (! $present) {
                if ($field->is_required && ! $hasFreeText) {
                    $errors["values.{$key}"][] = "{$field->label_en} is required. / {$field->label_ar} مطلوب.";
                }

                continue;
            }

            switch ($field->field_type) {
                case 'NUMBER':
                    if (! is_numeric($value)) {
                        $errors["values.{$key}"][] = "{$field->label_en} must be a number. / {$field->label_ar} يجب أن يكون رقمًا.";

                        break;
                    }
                    $clean[$key] = $value + 0; // store as a JSON number (int or float)
                    break;

                case 'SELECT':
                case 'RATING':
                    $options = is_array($field->options) ? array_map('strval', $field->options) : [];
                    if ($options !== []) {
                        if (! in_array((string) $value, $options, true)) {
                            $errors["values.{$key}"][] = "Invalid option for {$field->label_en}. / قيمة غير صالحة لـ {$field->label_ar}.";

                            break;
                        }
                        $clean[$key] = (string) $value;
                    } elseif ($field->field_type === 'RATING') {
                        // A RATING without explicit options is a free numeric score (e.g. 1–5).
                        if (! is_numeric($value)) {
                            $errors["values.{$key}"][] = "{$field->label_en} must be a number. / {$field->label_ar} يجب أن يكون رقمًا.";

                            break;
                        }
                        $clean[$key] = $value + 0;
                    } else {
                        $clean[$key] = (string) $value;
                    }
                    break;

                default: // TEXT, TEXTAREA
                    $clean[$key] = (string) $value;
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $clean;
    }
}
