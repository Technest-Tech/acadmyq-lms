<?php

declare(strict_types=1);

namespace App\Enums;

/** Canonical custom-report-field types (Master Spec §9, R-CRF-2). */
enum ReportFieldType: string
{
    case Text = 'TEXT';
    case Textarea = 'TEXTAREA';
    case Number = 'NUMBER';
    case Select = 'SELECT';
    case Rating = 'RATING';
}
