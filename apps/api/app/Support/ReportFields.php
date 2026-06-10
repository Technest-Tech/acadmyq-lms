<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Shared helpers for the dynamic report engine (Sprint 6 §6). Report field definitions are
 * stored once per academy (Sprint 3) and keyed by a stable `key`; reports store their values as
 * jsonb keyed by that same key (decision §3.4), so adding/deactivating a field never corrupts an
 * existing report. These helpers normalise field rows (decode `options`, cast booleans) and load
 * the field set a report screen needs: the active fields for new entry PLUS any deactivated field
 * that still carries a value in a given report (rendered read-only — AC-6.6).
 */
final class ReportFields
{
    /** Normalise one report_field_definition row for the client (decode options, cast flags). */
    public static function normalize(object $field): object
    {
        $field->is_required = (bool) $field->is_required;
        $field->is_active = (bool) $field->is_active;
        $field->options = is_string($field->options ?? null) ? (json_decode($field->options, true) ?: null) : ($field->options ?? null);

        return $field;
    }

    /**
     * @param  iterable<object>  $fields
     * @return list<object>
     */
    public static function map(iterable $fields): array
    {
        $out = [];
        foreach ($fields as $field) {
            $out[] = self::normalize($field);
        }

        return $out;
    }

    /** Active fields for an academy, ordered by sort_order — the form for NEW entry (§6.1). */
    public static function active(string $academyId): array
    {
        return self::map(
            DB::table('report_field_definitions')
                ->where('academy_id', $academyId)
                ->where('is_active', true)
                ->orderBy('sort_order')
                ->get()
        );
    }

    /**
     * Deactivated fields whose key appears in $values — shown read-only in a historical report so
     * past data is never hidden by a later deactivation (AC-6.6, Sprint 3 deactivate-not-delete).
     *
     * @param  array<string,mixed>  $values
     * @return list<object>
     */
    public static function inactiveWithValues(string $academyId, array $values): array
    {
        if ($values === []) {
            return [];
        }

        return self::map(
            DB::table('report_field_definitions')
                ->where('academy_id', $academyId)
                ->where('is_active', false)
                ->whereIn('key', array_keys($values))
                ->orderBy('sort_order')
                ->get()
        );
    }
}
