<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Bilingual (AR/EN) WhatsApp message templates for the automation jobs. A platform-level catalog
 * (no academy_id): shared-read so every academy's job can render them, Super-Admin write — same RLS
 * shape as `plans`/`feature_flags`. Bodies use {{placeholder}} tokens interpolated by
 * App\Services\Whatsapp\MessageTemplateRenderer.
 *
 * Seeds the default set (student bill, unpaid dunning, lesson/trial reminder) BEFORE enabling RLS,
 * so the seed inserts need no tenant context (identical to the feature_flags seed).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table message_templates (
              id         uuid primary key default uuid_generate_v7(),
              key        text not null unique,
              channel    text not null default 'WHATSAPP',
              body_ar    text not null,
              body_en    text not null,
              variables  jsonb not null default '[]'::jsonb,
              is_active  boolean not null default true,
              created_at timestamptz not null default now(),
              updated_at timestamptz not null default now()
            );
        SQL);

        $templates = [
            [
                'key' => 'TYPE1_BILL',
                'body_en' => "Hello {{name}}, your invoice for {{period}} is {{amount}}. View or pay it here: {{url}}",
                'body_ar' => "مرحباً {{name}}، فاتورتكم لشهر {{period}} بقيمة {{amount}}. للاطلاع والدفع: {{url}}",
                'variables' => ['name', 'period', 'amount', 'url'],
            ],
            [
                'key' => 'TYPE1_DUNNING',
                'body_en' => "Reminder {{name}}: your invoice of {{amount}} for {{period}} is still unpaid. Pay here: {{url}}",
                'body_ar' => "تذكير {{name}}: فاتورتكم بقيمة {{amount}} لشهر {{period}} لا تزال غير مدفوعة. للدفع: {{url}}",
                'variables' => ['name', 'period', 'amount', 'url'],
            ],
            [
                'key' => 'TYPE2_REMINDER',
                'body_en' => "Reminder: {{student}} has a {{kind}} with {{teacher}} at {{time}}.",
                'body_ar' => "تذكير: لدى {{student}} {{kind}} مع {{teacher}} الساعة {{time}}.",
                'variables' => ['student', 'kind', 'teacher', 'time'],
            ],
        ];

        foreach ($templates as $tpl) {
            DB::table('message_templates')->insert([
                'id' => (string) Str::uuid(),
                'key' => $tpl['key'],
                'channel' => 'WHATSAPP',
                'body_ar' => $tpl['body_ar'],
                'body_en' => $tpl['body_en'],
                'variables' => json_encode($tpl['variables']),
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        DB::unprepared(<<<'SQL'
            -- Shared-read catalog, Super-Admin write (identical to plans / feature_flags).
            alter table message_templates enable row level security;
            alter table message_templates force row level security;
            create policy catalog_select on message_templates for select using (true);
            create policy catalog_mutate on message_templates for all
              using (app.is_super_admin()) with check (app.is_super_admin());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop table if exists message_templates;
        SQL);
    }
};
