<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Levels for a Quran academy, if it wants them (2026-11-10). A centre always has its levels list;
 * any other academy turns it on itself in Settings → Levels, and only then does the list show in
 * Settings and the level picker on the student form. `academies.levels_enabled`, false for every
 * academy, so nobody sees a change until they switch it on.
 *
 * Written through `app.update_academy_defaults` with a fifth argument (null = keep). The old
 * four-argument calls still resolve to it through the defaults, so this can run before the code.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table academies add column if not exists levels_enabled boolean not null default false;

            drop function if exists app.update_academy_defaults(text, text, text, text);
            create or replace function app.update_academy_defaults(
                p_country        text,
                p_currency       text,
                p_level_label    text default null,
                p_online_lessons text default null,
                p_levels_enabled boolean default null
            )
            returns boolean
            language plpgsql
            security definer
            set search_path = public, pg_catalog
            as $$
            declare
                v_updated integer;
            begin
                if app.current_academy_id() is null then
                    raise exception 'no academy context';
                end if;
                if p_online_lessons is not null and p_online_lessons not in ('AUTO', 'ON', 'OFF') then
                    raise exception 'bad online_lessons value';
                end if;

                update academies
                set country          = nullif(upper(p_country), ''),
                    default_currency = coalesce(nullif(upper(p_currency), ''), default_currency),
                    level_label      = coalesce(nullif(upper(p_level_label), ''), level_label),
                    online_lessons   = case p_online_lessons
                                         when 'AUTO' then null
                                         when 'ON' then true
                                         when 'OFF' then false
                                         else online_lessons
                                       end,
                    levels_enabled   = coalesce(p_levels_enabled, levels_enabled),
                    updated_at       = now()
                where id = app.current_academy_id();

                get diagnostics v_updated = row_count;
                return v_updated > 0;
            end;
            $$;
        SQL);

        $this->grants('text,text,text,text,boolean', 'levels_enabled');
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop function if exists app.update_academy_defaults(text, text, text, text, boolean);
            create or replace function app.update_academy_defaults(
                p_country        text,
                p_currency       text,
                p_level_label    text default null,
                p_online_lessons text default null
            )
            returns boolean
            language plpgsql
            security definer
            set search_path = public, pg_catalog
            as $$
            declare
                v_updated integer;
            begin
                if app.current_academy_id() is null then
                    raise exception 'no academy context';
                end if;
                if p_online_lessons is not null and p_online_lessons not in ('AUTO', 'ON', 'OFF') then
                    raise exception 'bad online_lessons value';
                end if;

                update academies
                set country          = nullif(upper(p_country), ''),
                    default_currency = coalesce(nullif(upper(p_currency), ''), default_currency),
                    level_label      = coalesce(nullif(upper(p_level_label), ''), level_label),
                    online_lessons   = case p_online_lessons
                                         when 'AUTO' then null
                                         when 'ON' then true
                                         when 'OFF' then false
                                         else online_lessons
                                       end,
                    updated_at       = now()
                where id = app.current_academy_id();

                get diagnostics v_updated = row_count;
                return v_updated > 0;
            end;
            $$;
            alter table academies drop column if exists levels_enabled;
        SQL);

        $this->grants('text,text,text,text', null);
    }

    /** The definer owns the function and may write exactly its columns; the app role may call it. */
    private function grants(string $signature, ?string $column): void
    {
        $bypass = (string) config('database.rls.bypass_role', '');
        if ($bypass !== '' && preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $bypass)) {
            DB::unprepared("alter function app.update_academy_defaults({$signature}) owner to {$bypass};");
            if ($column !== null) {
                DB::unprepared("grant update ({$column}) on academies to {$bypass};");
            }
        }

        $app = (string) config('database.rls.app_role', '');
        if ($app !== '' && preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $app)) {
            DB::unprepared("grant execute on function app.update_academy_defaults({$signature}) to {$app};");
        }
    }
};
