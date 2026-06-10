<?php

declare(strict_types=1);

namespace Tests\Concerns;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Fixture helpers for the Sprint 6 report engine: seed an academy's report_field_definitions
 * (the Qur'an template, or arbitrary fields) directly under the owning academy's context so the
 * RLS `with check` passes. Requires InteractsWithTenancy.
 */
trait CreatesReportFields
{
    /**
     * Seed the Qur'an academy-type report fields (surah-from/to, tajweed, next assignment, notes)
     * — the same template the demo seeder copies. Returns the field rows keyed by `key`.
     *
     * @return array<string,string> map of key => field id
     */
    protected function seedQuranReportFields(string $academyId): array
    {
        return $this->seedReportFields($academyId, [
            ['key' => 'surah_from', 'label_ar' => 'من سورة / آية', 'label_en' => 'From surah / ayah', 'field_type' => 'TEXT', 'options' => null, 'is_required' => true],
            ['key' => 'surah_to', 'label_ar' => 'إلى سورة / آية', 'label_en' => 'To surah / ayah', 'field_type' => 'TEXT', 'options' => null, 'is_required' => true],
            ['key' => 'tajweed_rating', 'label_ar' => 'تقييم التجويد', 'label_en' => 'Tajweed rating', 'field_type' => 'SELECT', 'options' => ['ممتاز', 'جيد جداً', 'جيد'], 'is_required' => false],
            ['key' => 'next_assignment', 'label_ar' => 'الوِرد القادم', 'label_en' => 'Next assignment', 'field_type' => 'TEXT', 'options' => null, 'is_required' => false],
            ['key' => 'notes', 'label_ar' => 'ملاحظات للأهل', 'label_en' => 'Notes for family', 'field_type' => 'TEXTAREA', 'options' => null, 'is_required' => false],
        ]);
    }

    /**
     * @param  list<array{key:string,label_ar:string,label_en:string,field_type:string,options?:?array,is_required?:bool,is_active?:bool,sort_order?:int}>  $fields
     * @return array<string,string> map of key => field id
     */
    protected function seedReportFields(string $academyId, array $fields): array
    {
        $this->asAcademy($academyId);
        $ids = [];
        foreach ($fields as $i => $field) {
            $id = (string) Str::uuid();
            DB::table('report_field_definitions')->insert([
                'id' => $id,
                'academy_id' => $academyId,
                'key' => $field['key'],
                'label_ar' => $field['label_ar'],
                'label_en' => $field['label_en'],
                'field_type' => $field['field_type'],
                'options' => isset($field['options']) && $field['options'] !== null ? json_encode($field['options']) : null,
                'sort_order' => $field['sort_order'] ?? $i,
                'is_required' => $field['is_required'] ?? false,
                'is_active' => $field['is_active'] ?? true,
            ]);
            $ids[$field['key']] = $id;
        }

        return $ids;
    }
}
