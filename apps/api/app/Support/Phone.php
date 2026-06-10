<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Validation\ValidationException;

/**
 * Phone numbers are stored canonical E.164 (Sprint 4 decision §3.7) so Sprint 6/10 WhatsApp
 * messaging and Sprint 7 invoice links are reliable. This normaliser is forgiving on input
 * (strips spaces, dashes, parentheses and dots; turns a leading `00` international prefix into
 * `+`) but strict on output: anything that is not a valid `+<country><number>` after cleanup
 * is rejected with a clear field error (TC-4.4), never silently stored malformed.
 */
final class Phone
{
    /**
     * Normalise to E.164, or throw a 422 keyed to $field. NULL/'' passes through as null so a
     * caller can keep an optional phone empty (students.whatsapp_phone, teachers.phone).
     */
    public static function normalize(?string $raw, string $field): ?string
    {
        if ($raw === null) {
            return null;
        }

        $trimmed = trim($raw);
        if ($trimmed === '') {
            return null;
        }

        // Strip common separators; keep a leading '+'.
        $cleaned = preg_replace('/(?!^)\+|[\s\-().]/', '', $trimmed) ?? $trimmed;

        // A leading international '00' becomes '+' (e.g. 0020100… → +20100…).
        if (str_starts_with($cleaned, '00')) {
            $cleaned = '+'.substr($cleaned, 2);
        }

        if (! preg_match('/^\+[1-9][0-9]{1,14}$/', $cleaned)) {
            throw ValidationException::withMessages([
                $field => ['Enter a valid international phone number in E.164 format, e.g. +201234567890.'],
            ]);
        }

        return $cleaned;
    }
}
