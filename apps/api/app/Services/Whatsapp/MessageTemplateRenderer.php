<?php

declare(strict_types=1);

namespace App\Services\Whatsapp;

use Illuminate\Support\Facades\DB;

/**
 * Renders a bilingual WhatsApp message from a `message_templates` row, interpolating {{placeholder}}
 * tokens. Returns the Arabic body then the English body (the AR-then-EN convention used across the
 * platform), so a single send reads in either language.
 */
final class MessageTemplateRenderer
{
    /**
     * @param  array<string,string|int|float>  $vars
     */
    public function render(string $key, array $vars): string
    {
        $tpl = DB::table('message_templates')
            ->where('key', $key)
            ->where('is_active', true)
            ->first(['body_ar', 'body_en']);

        if ($tpl === null) {
            return '';
        }

        return $this->interpolate($tpl->body_ar, $vars)."\n\n".$this->interpolate($tpl->body_en, $vars);
    }

    /**
     * @param  array<string,string|int|float>  $vars
     */
    private function interpolate(string $body, array $vars): string
    {
        return (string) preg_replace_callback(
            '/\{\{\s*(\w+)\s*\}\}/',
            fn (array $m): string => (string) ($vars[$m[1]] ?? ''),
            $body,
        );
    }
}
