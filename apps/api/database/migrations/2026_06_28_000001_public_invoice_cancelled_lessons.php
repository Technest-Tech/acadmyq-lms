<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * #12 — surface cancelled lessons on the public invoice page.
 *
 * Cancelled lessons (by student OR teacher) are non-billable and so never get a stored line item.
 * The parent should still SEE them on their bill, for the record, without any charge. This redefines
 * app.public_invoice_by_token() to:
 *
 *   1. expose `session_status` on every line item (so the page can flag cancelled ones), and
 *   2. UNION in zero-amount informational rows for cancelled sessions that fall on this AUTO
 *      invoice's payer + period + currency — derived live from `sessions`, never stored.
 *
 * The cancelled match mirrors the billing engine's payer/currency resolution: the local month is
 * read in the academy timezone, and a lesson only attaches to the invoice whose currency matches the
 * student's active subscription (academy default when none) so a currency-split guardian never sees
 * the same cancelled lesson twice. MANUAL/advance invoices (kind <> 'AUTO') are left untouched.
 *
 * Preserves the payment_methods + duration_minutes payload from the prior definitions.
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
                    i.kind,
                    i.guardian_id,
                    i.student_id,
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
                    a.timezone                                                     as academy_tz,
                    a.default_currency                                             as academy_default_currency,
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
                                    'id',               u.id,
                                    'session_id',       u.session_id,
                                    'student_id',       u.student_id,
                                    'student_name',     u.student_name,
                                    'description',      u.description,
                                    'amount_minor',     u.amount_minor,
                                    'currency',         u.currency,
                                    'session_date',     u.session_date,
                                    'duration_minutes', u.duration_minutes,
                                    'session_status',   u.session_status
                                )
                                order by u.session_date asc nulls last,
                                         u.created_at   asc
                            )
                            from (
                                -- Real, stored line items
                                select
                                    li.id,
                                    li.session_id,
                                    li.student_id,
                                    s.full_name        as student_name,
                                    li.description,
                                    li.amount_minor,
                                    li.currency,
                                    li.session_date,
                                    sess.duration_minutes,
                                    sess.status        as session_status,
                                    li.created_at
                                from invoice_line_items li
                                left join students s    on s.id = li.student_id
                                left join sessions sess on sess.id = li.session_id
                                where li.invoice_id = v_invoice.id

                                union all

                                -- #12 — cancelled lessons as zero-amount informational rows (AUTO only)
                                select
                                    c.id,
                                    c.id               as session_id,
                                    c.student_id,
                                    st.full_name       as student_name,
                                    'Cancelled lesson' as description,
                                    0                  as amount_minor,
                                    v_invoice.currency as currency,
                                    (c.scheduled_at_utc at time zone v_invoice.academy_tz)::date as session_date,
                                    c.duration_minutes,
                                    c.status           as session_status,
                                    c.created_at
                                from sessions c
                                join students st on st.id = c.student_id
                                where v_invoice.kind = 'AUTO'
                                  and c.academy_id = v_invoice.academy_id
                                  and c.status in ('CANCELLED_BY_TEACHER', 'CANCELLED_BY_STUDENT')
                                  and extract(year  from (c.scheduled_at_utc at time zone v_invoice.academy_tz)) = v_invoice.period_year
                                  and extract(month from (c.scheduled_at_utc at time zone v_invoice.academy_tz)) = v_invoice.period_month
                                  and (
                                        (v_invoice.student_id is not null and c.student_id = v_invoice.student_id)
                                     or (v_invoice.student_id is null and st.guardian_id = v_invoice.guardian_id)
                                  )
                                  and coalesce(
                                        (
                                            select sub.currency from subscriptions sub
                                            where sub.student_id = c.student_id
                                              and sub.status = 'ACTIVE'
                                              and sub.deleted_at is null
                                            order by sub.start_date desc
                                            limit 1
                                        ),
                                        v_invoice.academy_default_currency
                                      ) = v_invoice.currency
                                  and not exists (
                                        select 1 from invoice_line_items li2 where li2.session_id = c.id
                                  )
                            ) u
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
            // The definer role reads subscriptions for the currency match on cancelled lessons.
            DB::unprepared("grant select on subscriptions to {$bypass};");
        }
    }

    public function down(): void
    {
        // Non-destructive: the prior definition is superseded in place and the extra payload fields
        // (session_status + cancelled rows) are harmless to any reader. Restoring the older body is
        // unnecessary and would only drift; a later redefinition supersedes this one cleanly.
    }
};
