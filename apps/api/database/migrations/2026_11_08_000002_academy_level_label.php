<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * What the classification is called (docs/centre-profile/02-COHERENCE-AUDIT §3). English and
 * curriculum centres share one profile and differ in one word: an English academy has LEVELs
 * (A1 … C2), a curriculum centre GRADEs (أولى إعدادي …), a British-style school YEARs. That word is
 * `academies.level_label`; null reads as LEVEL, which is what every screen said before, so no
 * academy sees a change until it picks another word.
 *
 * Written from the tenant through `app.update_academy_defaults` — the security-definer function the
 * country and default currency already go through, because `academies` is Super-Admin-write under
 * RLS — now with a third argument (null = keep).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table academies add column if not exists level_label text;
            alter table academies drop constraint if exists academies_level_label_chk;
            alter table academies add constraint academies_level_label_chk
              check (level_label is null or level_label in ('LEVEL', 'GRADE', 'YEAR'));

            drop function if exists app.update_academy_defaults(text, text);
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
        SQL);

        $this->grants('text,text,text', 'level_label');
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop function if exists app.update_academy_defaults(text, text, text);
            create or replace function app.update_academy_defaults(
                p_country  text,
                p_currency text
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
                    updated_at       = now()
                where id = app.current_academy_id();

                get diagnostics v_updated = row_count;
                return v_updated > 0;
            end;
            $$;
            alter table academies drop constraint if exists academies_level_label_chk;
            alter table academies drop column if exists level_label;
        SQL);

        $this->grants('text,text', null);
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
