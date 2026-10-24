<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The academy's own country, beside its default currency: the two things every new-person form
 * should open on (the country, the dial code, the currency) instead of a blank. Written from the
 * tenant through a security-definer function like the name and timezone, because `academies` is
 * Super-Admin-write under RLS.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table academies add column country char(2);

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
        SQL);

        $bypass = (string) config('database.rls.bypass_role', '');
        if ($bypass !== '' && preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $bypass)) {
            DB::unprepared("alter function app.update_academy_defaults(text,text) owner to {$bypass};");
            // The definer role only ever had SELECT on academies, so neither this function nor
            // app.update_academy_settings (the name / timezone card) could write a row: the card
            // 500'd on every save. The update right, for exactly the columns the two functions set.
            DB::unprepared("grant update (name, timezone, country, default_currency, updated_at) on academies to {$bypass};");
        }

        $app = (string) config('database.rls.app_role', '');
        if ($app !== '' && preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $app)) {
            DB::unprepared("grant execute on function app.update_academy_defaults(text,text) to {$app};");
        }
    }

    public function down(): void
    {
        DB::unprepared('drop function if exists app.update_academy_defaults(text, text); alter table academies drop column if exists country;');
    }
};
