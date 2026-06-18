<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Add per-line session duration to the public invoice payload so the public payment page
 * can present billed hours (the academy bills PER_HOUR). Redefines
 * app.public_invoice_by_token() — preserving the payment_methods extension from the
 * payment_settings migration — and joins sessions to expose duration_minutes per line
 * (null for manual/itemized lines that have no session).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create or replace function app.public_invoice_by_token(token text)
            returns json
            language plpgsql
            security definer
            set search_path = public, pg_catalog
            as $$
            declare
                v_invoice   record;
                v_result    json;
            begin
                select
                    i.id,
                    i.status,
                    i.period_year,
                    i.period_month,
                    i.currency,
                    i.subtotal_minor,
                    i.total_minor,
                    i.amount_paid_minor,
                    i.sent_at,
                    i.sent_channel,
                    i.closed_at,
                    i.paid_at,
                    i.payment_method,
                    i.payment_reason,
                    i.academy_id,
                    a.name                                                         as academy_name,
                    coalesce(g.full_name,  s_payer.full_name)                      as payer_name,
                    coalesce(g.whatsapp_phone, s_payer.whatsapp_phone)             as payer_whatsapp
                into v_invoice
                from invoices         i
                join academies        a       on a.id = i.academy_id
                left join guardians   g       on g.id = i.guardian_id
                left join students    s_payer on s_payer.id = i.student_id
                where i.public_token = token
                limit 1;

                if not found then
                    return null;
                end if;

                select json_build_object(
                    'id',                v_invoice.id,
                    'status',            v_invoice.status,
                    'period_year',       v_invoice.period_year,
                    'period_month',      v_invoice.period_month,
                    'currency',          v_invoice.currency,
                    'subtotal_minor',    v_invoice.subtotal_minor,
                    'total_minor',       v_invoice.total_minor,
                    'amount_paid_minor', v_invoice.amount_paid_minor,
                    'sent_at',           v_invoice.sent_at,
                    'sent_channel',      v_invoice.sent_channel,
                    'closed_at',         v_invoice.closed_at,
                    'paid_at',           v_invoice.paid_at,
                    'payment_method',    v_invoice.payment_method,
                    'payment_reason',    v_invoice.payment_reason,
                    'academy_name',      v_invoice.academy_name,
                    'payer_name',        v_invoice.payer_name,
                    'payer_whatsapp',    v_invoice.payer_whatsapp,
                    'payment_methods',   coalesce(
                        (
                            select json_agg(
                                json_build_object(
                                    'method', ps.method,
                                    'config', ps.config - 'client_secret'
                                )
                                order by ps.method asc
                            )
                            from academy_payment_settings ps
                            where ps.academy_id = v_invoice.academy_id
                              and ps.is_active = true
                        ),
                        '[]'::json
                    ),
                    'line_items',        coalesce(
                        (
                            select json_agg(
                                json_build_object(
                                    'id',               li.id,
                                    'session_id',       li.session_id,
                                    'student_id',       li.student_id,
                                    'student_name',     s.full_name,
                                    'description',      li.description,
                                    'amount_minor',     li.amount_minor,
                                    'currency',         li.currency,
                                    'session_date',     li.session_date,
                                    'duration_minutes', sess.duration_minutes
                                )
                                order by li.session_date asc nulls last,
                                         li.created_at   asc
                            )
                            from invoice_line_items li
                            left join students s    on s.id = li.student_id
                            left join sessions sess on sess.id = li.session_id
                            where li.invoice_id = v_invoice.id
                        ),
                        '[]'::json
                    )
                )
                into v_result;

                return v_result;
            end;
            $$;
        SQL);

        $bypass = (string) config('database.rls.bypass_role', '');
        if ($bypass !== '' && preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $bypass)) {
            DB::unprepared("alter function app.public_invoice_by_token(text) owner to {$bypass};");
            // The definer role needs SELECT on sessions to read duration_minutes.
            DB::unprepared("grant select on sessions to {$bypass};");
        }
    }

    public function down(): void
    {
        // Non-destructive: leaving the duration_minutes field in the payload is harmless.
        // The function definition is superseded by any later redefinition.
    }
};
