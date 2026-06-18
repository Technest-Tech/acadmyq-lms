<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Allow an Academy Owner to update their own academy's name and timezone from the
 * Settings page. The `academies_update` RLS policy is Super-Admin-only (§10), so
 * a SECURITY DEFINER function owned by the BYPASSRLS role is the pattern used here
 * (mirrors app.paypal_mark_invoice_paid). The function scopes the update to
 * `app.current_academy_id()` so it is still tenant-confined.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create or replace function app.update_academy_settings(
                p_name     text,
                p_timezone text
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
                set name       = p_name,
                    timezone   = p_timezone,
                    updated_at = now()
                where id = app.current_academy_id();

                get diagnostics v_updated = row_count;
                return v_updated > 0;
            end;
            $$;
        SQL);

        $bypass = (string) config('database.rls.bypass_role', '');
        if ($bypass !== '' && preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $bypass)) {
            DB::unprepared("alter function app.update_academy_settings(text,text) owner to {$bypass};");
        }

        $app = (string) config('database.rls.app_role', '');
        if ($app !== '' && preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $app)) {
            DB::unprepared("grant execute on function app.update_academy_settings(text,text) to {$app};");
        }
    }

    public function down(): void
    {
        DB::unprepared('drop function if exists app.update_academy_settings(text, text);');
    }
};
