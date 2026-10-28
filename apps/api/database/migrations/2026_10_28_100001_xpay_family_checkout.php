<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * One card payment for a whole family's dues (`/f/{token}`): the parent pays the total once, and the
 * money is split across every bill it covered — each package bill is still marked paid on its own.
 *
 *  1. `xpay_checkout_sessions` opened for a FAMILY carry `guardian_id` instead of `invoice_id` —
 *     exactly one of the two, so a session is always either one bill's or one family's.
 *  2. `xpay_checkout_session_invoices` — which bills a family session covers, and how much of each
 *     was due when it was opened. Written once with the session; the settle rule reads it back and
 *     never trusts a list from the gateway's payload.
 *  3. `app.xpay_settle_family_invoice` — marks one covered bill paid. Same terminal-state guard as
 *     app.xpay_mark_invoice_paid (a retried webhook writes nothing), but it also takes a
 *     PARTIALLY_PAID bill, because the family page lists those and the card charged what was left.
 *
 * The client purge discovers the new table by its academy_id column; the FKs cascade as well.
 */
return new class extends Migration
{
    private function role(string $key): string
    {
        $role = (string) config("database.rls.{$key}");
        if (! preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $role)) {
            throw new RuntimeException("Invalid RLS role identifier for {$key}: {$role}");
        }

        return $role;
    }

    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table xpay_checkout_sessions
              alter column invoice_id drop not null,
              add column guardian_id uuid references guardians(id) on delete cascade,
              add constraint xpay_checkout_sessions_owner_ck
                check ((invoice_id is null) <> (guardian_id is null));
            create index xpay_checkout_sessions_guardian_idx on xpay_checkout_sessions (guardian_id)
              where guardian_id is not null;

            create table xpay_checkout_session_invoices (
              session_id   text   not null references xpay_checkout_sessions(id) on delete cascade,
              academy_id   uuid   not null references academies(id) on delete cascade,
              invoice_id   uuid   not null references invoices(id) on delete cascade,
              amount_minor bigint not null check (amount_minor > 0),
              primary key (session_id, invoice_id)
            );
            create index xpay_checkout_session_invoices_invoice_idx on xpay_checkout_session_invoices (invoice_id);

            alter table xpay_checkout_session_invoices enable row level security;
            alter table xpay_checkout_session_invoices force row level security;
            create policy tenant_isolation on xpay_checkout_session_invoices
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            create or replace function app.xpay_settle_family_invoice(p_invoice_id text, p_session_id text)
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
                    payment_reason    = concat('XPay — family payment, session ', p_session_id),
                    amount_paid_minor = total_minor,
                    paid_at           = now(),
                    updated_at        = now()
                where id     = p_invoice_id::uuid
                  and status in ('OPEN', 'CLOSED', 'PARTIALLY_PAID');

                get diagnostics v_updated = row_count;
                return v_updated > 0;
            end;
            $$;
        SQL);

        $bypass = $this->role('bypass_role');
        $app = $this->role('app_role');

        // The family flow reads and writes its session under the academy's tenant context (the
        // single-bill flow goes through definer functions instead), so the app role needs both tables.
        DB::unprepared("grant select, insert, update on xpay_checkout_sessions to {$app};");
        DB::unprepared("grant select, insert, update, delete on xpay_checkout_session_invoices to {$app};");
        DB::unprepared("grant select on xpay_checkout_session_invoices to {$bypass};");
        DB::unprepared("alter function app.xpay_settle_family_invoice(text, text) owner to {$bypass};");
        DB::unprepared('revoke all on function app.xpay_settle_family_invoice(text, text) from public;');
        DB::unprepared("grant execute on function app.xpay_settle_family_invoice(text, text) to {$app};");
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop function if exists app.xpay_settle_family_invoice(text, text);
            drop table if exists xpay_checkout_session_invoices;
            delete from xpay_checkout_sessions where invoice_id is null;
            drop index if exists xpay_checkout_sessions_guardian_idx;
            alter table xpay_checkout_sessions
              drop constraint if exists xpay_checkout_sessions_owner_ck,
              drop column if exists guardian_id,
              alter column invoice_id set not null;
        SQL);
    }
};
