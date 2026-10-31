<?php

declare(strict_types=1);

namespace App\Services\Reports;

use App\Support\Audit;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Ready-made lesson reports an academy starts from (Settings → Lesson report, or
 * `php artisan lesson-report:preset` when we set a client up ourselves).
 *
 * Applying one REPLACES the academy's form: its fields are created (or brought back and reshaped
 * when the key already exists) and every other active field is deactivated — never deleted, so a
 * past report still shows what it carried. The message is overwritten. Runs inside the academy's
 * tenant context (RLS scopes every write).
 */
final class LessonReportPresets
{
    /**
     * The Quran circle: four scores out of ten, then the next homework, as Quran academies send it
     * to parents (modelled on أكاديمية أنا مسلم's own report).
     */
    private const QURAN = [
        'name_ar' => 'حلقة قرآن',
        'name_en' => 'Quran circle',
        'fields' => [
            ['key' => 'hifz_score', 'label_ar' => 'درجة الحفظ', 'label_en' => 'Memorisation', 'field_type' => 'NUMBER', 'max_value' => 10, 'section' => 'التقييم'],
            ['key' => 'recent_review_score', 'label_ar' => 'درجة الماضي القريب', 'label_en' => 'Recent revision', 'field_type' => 'NUMBER', 'max_value' => 10, 'section' => 'التقييم'],
            ['key' => 'old_review_score', 'label_ar' => 'درجة الماضي البعيد', 'label_en' => 'Older revision', 'field_type' => 'NUMBER', 'max_value' => 10, 'section' => 'التقييم'],
            ['key' => 'behaviour_score', 'label_ar' => 'درجة السلوك', 'label_en' => 'Behaviour', 'field_type' => 'NUMBER', 'max_value' => 10, 'section' => 'التقييم'],
            ['key' => 'next_hifz', 'label_ar' => 'الحفظ الجديد', 'label_en' => 'New memorisation', 'field_type' => 'TEXT', 'max_value' => null, 'section' => 'الواجب القادم'],
            ['key' => 'next_recent_review', 'label_ar' => 'الماضي القريب', 'label_en' => 'Recent revision', 'field_type' => 'TEXT', 'max_value' => null, 'section' => 'الواجب القادم'],
            ['key' => 'next_old_review', 'label_ar' => 'الماضي البعيد', 'label_en' => 'Older revision', 'field_type' => 'TEXT', 'max_value' => null, 'section' => 'الواجب القادم'],
            ['key' => 'reflection', 'label_ar' => 'المعنى التدبري', 'label_en' => 'Reflection', 'field_type' => 'TEXTAREA', 'max_value' => null, 'section' => 'الواجب القادم'],
            ['key' => 'religious_education', 'label_ar' => 'التربية الدينية', 'label_en' => 'Religious education', 'field_type' => 'TEXT', 'max_value' => null, 'section' => 'الواجب القادم'],
        ],
        'message' => <<<'TXT'
*🌼{academy}🌼*

🌺 المعلم : {teacher}

🌺 الطالب : {student}

*التقييم*
✅️ درجة الحفظ: {hifz_score}
✅️ درجة الماضي القريب: {recent_review_score}
✅️ درجة الماضي البعيد: {old_review_score}
✅️ درجة السلوك: {behaviour_score}
ـــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــ
*الواجب القادم*
🌺 الحفظ الجديد: {next_hifz}

🌺 الماضي القريب: {next_recent_review}

🌺 الماضي البعيد: {next_old_review}

🌺 المعنى التدبري: {reflection}

🌺 التربية الدينية : {religious_education}

ـــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــ
🗓 حلقة يوم: {day}

📝 الموافق: {date}

📋 الحضور: {attendance}

⏱️ مدة الحلقة: {duration}

جعلنا الله وإياكم من أهل القرآن العاملين به 🌹🌹🌹
TXT,
    ];

    /** @return array<string, array{name_ar:string, name_en:string}> */
    public static function catalog(): array
    {
        return ['quran' => ['name_ar' => self::QURAN['name_ar'], 'name_en' => self::QURAN['name_en']]];
    }

    /** Replace $academyId's form and message with the preset's. */
    public function apply(string $academyId, string $preset, ?string $actorUserId, string $actorRole): void
    {
        $definition = match ($preset) {
            'quran' => self::QURAN,
            default => throw ValidationException::withMessages(['preset' => ['Unknown template. / قالب غير معروف.']]),
        };

        $keys = array_column($definition['fields'], 'key');
        foreach ($definition['fields'] as $i => $field) {
            $row = [
                'label_ar' => $field['label_ar'],
                'label_en' => $field['label_en'],
                'field_type' => $field['field_type'],
                'options' => null,
                'max_value' => $field['max_value'],
                'section' => $field['section'],
                'sort_order' => $i + 1,
                'is_required' => false,
                'is_active' => true,
                'updated_at' => now(),
            ];
            $existing = DB::table('report_field_definitions')->where('academy_id', $academyId)->where('key', $field['key'])->value('id');
            if ($existing !== null) {
                DB::table('report_field_definitions')->where('id', $existing)->update($row);
            } else {
                DB::table('report_field_definitions')->insert($row + [
                    'id' => (string) Str::uuid(),
                    'academy_id' => $academyId,
                    'key' => $field['key'],
                ]);
            }
        }

        $retired = DB::table('report_field_definitions')
            ->where('academy_id', $academyId)
            ->where('is_active', true)
            ->whereNotIn('key', $keys)
            ->pluck('key')->all();
        DB::table('report_field_definitions')
            ->where('academy_id', $academyId)
            ->whereIn('key', $retired)
            ->update(['is_active' => false, 'updated_at' => now()]);

        self::saveMessage($academyId, $definition['message']);

        Audit::log('lesson_report.preset_applied', 'academy', $academyId, $academyId, $actorUserId, $actorRole,
            after: ['preset' => $preset, 'fields' => $keys, 'deactivated' => $retired]);
    }

    /** Upsert the academy's message (one row per academy, created on first save). */
    public static function saveMessage(string $academyId, string $message): void
    {
        $updated = DB::table('lesson_report_templates')->where('academy_id', $academyId)
            ->update(['message' => $message, 'updated_at' => now()]);
        if ($updated === 0) {
            DB::table('lesson_report_templates')->insert([
                'id' => (string) Str::uuid(),
                'academy_id' => $academyId,
                'message' => $message,
            ]);
        }
    }
}
