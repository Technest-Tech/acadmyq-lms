<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Public payment proof for academy bills. An academy pays its platform bill offline (InstaPay /
 * Vodafone Cash) and uploads a transfer screenshot on the public pay page; a Super Admin reviews it
 * and marks the bill paid. The screenshot file lives on the PRIVATE disk; only its path is stored.
 *
 * Two SECURITY DEFINER (bypass-role) functions back the no-auth public page, mirroring
 * app.public_invoice_by_token:
 *   • app.public_academy_invoice_by_token(token) — curated bill JSON + the platform's active
 *     receiving methods (read from platform_settings.platform_payment_methods).
 *   • app.submit_academy_payment(token, method, path, amount, note) — inserts a PENDING submission
 *     without any tenant context (the public controller has none).
 *
 * The table itself is tenant-scoped (standard tenant_isolation) so the Super Admin reviews in the
 * academy's context and the owner could see their own submissions.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create type academy_payment_review_status as enum ('PENDING', 'APPROVED', 'REJECTED');

            create table academy_payment_submissions (
              id                 uuid primary key default uuid_generate_v7(),
              academy_invoice_id uuid not null references academy_invoices(id) on delete cascade,
              academy_id         uuid not null references academies(id) on delete cascade,
              method             text not null check (method in ('INSTAPAY', 'VODAFONE_CASH')),
              screenshot_path    text not null,
              amount_minor       bigint,
              note               text,
              review_status      academy_payment_review_status not null default 'PENDING',
              reviewed_by        uuid references users(id),
              reviewed_at        timestamptz,
              created_at         timestamptz not null default now(),
              updated_at         timestamptz not null default now()
            );
            create index academy_payment_submissions_invoice_idx
              on academy_payment_submissions (academy_invoice_id);
            create index academy_payment_submissions_status_idx
              on academy_payment_submissions (review_status);

            alter table academy_payment_submissions enable row level security;
            alter table academy_payment_submissions force row level security;
            create policy tenant_isolation on academy_payment_submissions
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        // ── Public bill view by token (+ platform receiving methods) ──
        DB::unprepared(<<<'SQL'
            create or replace function app.public_academy_invoice_by_token(token text)
            returns json
            language plpgsql
            security definer
            set search_path = public, pg_catalog
            as $$
            declare
                v        record;
                v_methods jsonb;
                v_result json;
            begin
                select ai.id, ai.status, ai.period_start, ai.period_end, ai.currency,
                       ai.total_minor, ai.amount_paid_minor, ai.due_date, ai.paid_at,
                       ai.academy_id, a.name as academy_name
                into v
                from academy_invoices ai
                join academies a on a.id = ai.academy_id
                where ai.public_token = token
                limit 1;

                if not found then
                    return null;
                end if;

                select value into v_methods from platform_settings where key = 'platform_payment_methods';

                select json_build_object(
                    'id',                v.id,
                    'status',            v.status,
                    'period_start',      v.period_start,
                    'period_end',        v.period_end,
                    'currency',          v.currency,
                    'total_minor',       v.total_minor,
                    'amount_paid_minor', v.amount_paid_minor,
                    'due_date',          v.due_date,
                    'paid_at',           v.paid_at,
                    'academy_name',      v.academy_name,
                    'payment_methods',   coalesce(v_methods, '{}'::jsonb)
                )
                into v_result;

                return v_result;
            end;
            $$;
        SQL);

        // ── Anonymous payment-proof submission ──
        DB::unprepared(<<<'SQL'
            create or replace function app.submit_academy_payment(
                p_token  text,
                p_method text,
                p_path   text,
                p_amount bigint,
                p_note   text
            )
            returns json
            language plpgsql
            security definer
            set search_path = public, pg_catalog
            as $$
            declare
                v_bill record;
                v_id   uuid;
            begin
                select id, academy_id, status into v_bill
                from academy_invoices where public_token = p_token limit 1;

                if not found then
                    return null;
                end if;
                if v_bill.status in ('PAID', 'VOID') then
                    return json_build_object('ok', false, 'reason', 'closed');
                end if;

                v_id := uuid_generate_v7();
                insert into academy_payment_submissions
                    (id, academy_invoice_id, academy_id, method, screenshot_path, amount_minor, note, review_status)
                values
                    (v_id, v_bill.id, v_bill.academy_id, p_method, p_path, p_amount, p_note, 'PENDING');

                return json_build_object('ok', true, 'submission_id', v_id);
            end;
            $$;
        SQL);

        $bypass = (string) config('database.rls.bypass_role', '');
        if ($bypass !== '' && preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $bypass)) {
            DB::unprepared("alter function app.public_academy_invoice_by_token(text) owner to {$bypass};");
            DB::unprepared("alter function app.submit_academy_payment(text,text,text,bigint,text) owner to {$bypass};");
            DB::unprepared("grant select on academy_invoices to {$bypass};");
            DB::unprepared("grant select on platform_settings to {$bypass};");
            DB::unprepared("grant insert, select on academy_payment_submissions to {$bypass};");
        }

        // Seed default platform receiving methods (Super Admin edits these in Settings). Set the
        // role GUC transaction-locally so the insert passes platform_settings' is_super_admin RLS.
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
        DB::table('platform_settings')->updateOrInsert(
            ['key' => 'platform_payment_methods'],
            [
                'value' => json_encode([
                    'INSTAPAY' => ['enabled' => true, 'display_name' => 'InstaPay', 'handle' => ''],
                    'VODAFONE_CASH' => ['enabled' => true, 'display_name' => 'Vodafone Cash', 'number' => ''],
                ]),
                'updated_at' => now(),
            ],
        );
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop function if exists app.submit_academy_payment(text, text, text, bigint, text);
            drop function if exists app.public_academy_invoice_by_token(text);
            drop policy if exists tenant_isolation on academy_payment_submissions;
            drop table if exists academy_payment_submissions;
            drop type if exists academy_payment_review_status;
        SQL);
    }
};
