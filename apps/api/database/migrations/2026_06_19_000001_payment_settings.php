<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Per-academy payment settings — stores configuration for each payment channel
 * (bank transfer, PayPal, XPay) that the academy exposes to students on the
 * public invoice page. Each method has an `is_active` toggle and a `config` JSONB
 * blob whose shape is specific to the channel:
 *
 *   BANK_TRANSFER: { account_number, account_holder, bank_name, iban }
 *   PAYPAL:        { client_id, email, mode ("sandbox"|"live") }
 *   XPAY:          {} (placeholder, not yet wired)
 *
 * RLS scopes every row to the caller's academy. The existing
 * `app.public_invoice_by_token` SECURITY DEFINER function is extended to include
 * the academy's active payment methods in the public invoice payload so students
 * can see how to pay without authentication.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table academy_payment_settings (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id) on delete cascade,
              method      text not null,
              is_active   boolean not null default false,
              config      jsonb not null default '{}',
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now(),
              unique (academy_id, method),
              constraint payment_settings_method_chk check (
                method in ('BANK_TRANSFER', 'PAYPAL', 'XPAY')
              )
            );
            create index academy_payment_settings_academy_idx
              on academy_payment_settings (academy_id);

            alter table academy_payment_settings enable row level security;
            alter table academy_payment_settings force row level security;
            create policy tenant_isolation on academy_payment_settings
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        // ── Extend public invoice function to include active payment methods ──
        // The function is SECURITY DEFINER owned by the BYPASSRLS role so it can
        // read academy_payment_settings without needing a tenant context.
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
                                    -- Strip client_secret: it is server-side only and must
                                    -- never be sent to the browser via this public endpoint.
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
                            left join students      s  on s.id = li.student_id
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
            // The SECURITY DEFINER function runs as the bypass role, which still needs a
            // table-level SELECT grant on this new table (mirrors migration 10's grant on
            // academies/invoices/etc.). Without it the function 500s with
            // "permission denied for table academy_payment_settings".
            DB::unprepared("grant select on academy_payment_settings to {$bypass};");
        }

        // ── Server-side PayPal credential lookup (includes client_secret) ──
        // Called ONLY from the server-side PaypalOrderController, never sent to
        // the browser. SECURITY DEFINER + BYPASSRLS so the public route can
        // fetch academy credentials without a tenant context.
        DB::unprepared(<<<'SQL'
            create or replace function app.paypal_config_by_token(p_token text)
            returns json
            language plpgsql
            security definer
            set search_path = public, pg_catalog
            as $$
            declare
                v_result json;
            begin
                select json_build_object(
                    'invoice_id',    i.id,
                    'status',        i.status,
                    'total_minor',   i.total_minor,
                    'currency',      i.currency,
                    'client_id',     ps.config->>'client_id',
                    'client_secret', ps.config->>'client_secret',
                    'mode',          coalesce(ps.config->>'mode', 'live')
                )
                into v_result
                from invoices i
                join academy_payment_settings ps on ps.academy_id = i.academy_id
                where i.public_token = p_token
                  and ps.method = 'PAYPAL'
                  and ps.is_active = true
                limit 1;

                return v_result;
            end;
            $$;
        SQL);

        if ($bypass !== '' && preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $bypass)) {
            DB::unprepared("alter function app.paypal_config_by_token(text) owner to {$bypass};");
        }

        // ── PayPal mark-invoice-paid (SECURITY DEFINER, bypass-role) ────────
        // Updates an invoice to PAID after a successful PayPal capture. Runs as
        // the BYPASSRLS role so the public controller never needs a tenant context.
        DB::unprepared(<<<'SQL'
            create or replace function app.paypal_mark_invoice_paid(
                p_invoice_id text,
                p_order_id   text
            )
            returns boolean
            language plpgsql
            security definer
            set search_path = public, pg_catalog
            as $$
            declare
                v_updated integer;
            begin
                update invoices
                set status            = 'PAID',
                    payment_method    = 'GATEWAY',
                    payment_reason    = concat('PayPal — order ', p_order_id),
                    amount_paid_minor = total_minor,
                    paid_at           = now(),
                    updated_at        = now()
                where id     = p_invoice_id::uuid
                  and status in ('OPEN', 'CLOSED');

                get diagnostics v_updated = row_count;
                return v_updated > 0;
            end;
            $$;
        SQL);

        if ($bypass !== '' && preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $bypass)) {
            DB::unprepared("alter function app.paypal_mark_invoice_paid(text,text) owner to {$bypass};");
        }
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop function if exists app.paypal_mark_invoice_paid(text, text);
            drop function if exists app.paypal_config_by_token(text);
            drop policy if exists tenant_isolation on academy_payment_settings;
            drop table if exists academy_payment_settings;
        SQL);
    }
};
