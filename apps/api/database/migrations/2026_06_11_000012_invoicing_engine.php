<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Sprint 7 – Invoicing engine additions.
 *
 * 1. invoices        : sent_at, sent_channel, amount_paid_minor
 * 2. invoice_line_items : session_date (denormalised snapshot)
 * 3. Backfill any NULL public_tokens (safety net; column is NOT NULL in practice)
 * 4. app.public_invoice_by_token(text) – SECURITY DEFINER function that returns
 *    a full invoice JSON for the public payment page without requiring tenant context.
 */
return new class extends Migration
{
    public function up(): void
    {
        // ------------------------------------------------------------------
        // 1 & 2 – Column additions
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            alter table invoices
                add column if not exists sent_at          timestamptz  null,
                add column if not exists sent_channel     text         null,
                add column if not exists amount_paid_minor bigint      not null default 0;

            alter table invoice_line_items
                add column if not exists session_date date null;
        SQL);

        // ------------------------------------------------------------------
        // 3 – Harden public_token (backfill any accidental NULLs with a
        //     deterministic-random 40-char hex string; no pgcrypto required)
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            update invoices
            set public_token = md5(id::text || random()::text || clock_timestamp()::text)
                            || md5(random()::text)
            where public_token is null;
        SQL);

        // ------------------------------------------------------------------
        // 4 – app schema + public invoice function
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            create schema if not exists app;
        SQL);

        DB::unprepared(<<<'SQL'
            drop function if exists app.public_invoice_by_token(text);
        SQL);

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
                -- Resolve the invoice row together with payer display fields
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

                -- Build the full JSON object including line items
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
                    'line_items',        coalesce(
                        (
                            select json_agg(
                                json_build_object(
                                    'id',           li.id,
                                    'session_id',   li.session_id,
                                    'student_id',   li.student_id,
                                    'student_name', s.full_name,
                                    'description',  li.description,
                                    'amount_minor', li.amount_minor,
                                    'currency',     li.currency,
                                    'session_date', li.session_date
                                )
                                order by li.session_date asc nulls last,
                                         li.created_at   asc
                            )
                            from invoice_line_items li
                            join students           s  on s.id = li.student_id
                            where li.invoice_id = v_invoice.id
                        ),
                        '[]'::json
                    )
                )
                into v_result;

                return v_result;
            end;
            $$;

            grant execute on function app.public_invoice_by_token(text) to public;
        SQL);

        // Transfer ownership to the BYPASSRLS role so the SECURITY DEFINER function runs
        // with row-level security bypassed (same contract as migration 10 established).
        // The rls.bypass_role config value is validated against an identifier pattern in
        // migration 10's role() helper; we replicate the same validation here.
        $bypass = (string) config('database.rls.bypass_role', '');
        if ($bypass !== '' && preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $bypass)) {
            DB::unprepared("alter function app.public_invoice_by_token(text) owner to {$bypass};");
        }
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop function if exists app.public_invoice_by_token(text);
        SQL);

        DB::unprepared(<<<'SQL'
            alter table invoice_line_items
                drop column if exists session_date;

            alter table invoices
                drop column if exists sent_at,
                drop column if exists sent_channel,
                drop column if exists amount_paid_minor;
        SQL);
    }
};
