<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The "online lessons" switch (docs/centre-profile/02-COHERENCE-AUDIT §1, §5.5). The Enter button,
 * the teacher's meeting link and the Punctuality tab are right for an online English centre and
 * noise for a room-based one. `academies.online_lessons`: true / false when the academy has said,
 * null = automatic (App\Support\OnlineLessons works it out). No row changes here.
 *
 * Written through `app.update_academy_defaults` with a fourth argument, because null is a value of
 * its own here: AUTO | ON | OFF, and a null argument = keep what is there.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table academies add column if not exists online_lessons boolean;

            drop function if exists app.update_academy_defaults(text, text, text);
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
        SQL);

        $this->grants('text,text,text,text', 'online_lessons');
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop function if exists app.update_academy_defaults(text, text, text, text);
            create or replace function app.update_academy_defaults(
                p_country     text,
                p_currency    text,
                p_level_label text default null
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

                update academies
                set country          = nullif(upper(p_country), ''),
                    default_currency = coalesce(nullif(upper(p_currency), ''), default_currency),
                    level_label      = coalesce(nullif(upper(p_level_label), ''), level_label),
                    updated_at       = now()
                where id = app.current_academy_id();

                get diagnostics v_updated = row_count;
                return v_updated > 0;
            end;
            $$;
            alter table academies drop column if exists online_lessons;
        SQL);

        $this->grants('text,text,text', null);
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
