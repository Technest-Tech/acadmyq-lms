<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * XPay card payments on the public student invoice (docs.xpay.app). XPay was reserved as a payment
 * method back in 2026_06_19_000001_payment_settings but never wired; this migration makes it real.
 *
 * WHO OWNS THE KEYS. Unlike PayPal — where the academy types its own credentials into Settings →
 * Payment — an academy's XPay keys are provisioned by the SUPER ADMIN and the academy never sees
 * them. That forces the credentials OUT of `academy_payment_settings.config`, because
 * PaymentSettingsController::index hands that JSONB verbatim to anyone holding `invoice.read` (the
 * academy's own staff). So the split is:
 *
 *   academy_payment_settings (method 'XPAY')  is_active + a PUBLIC-SAFE config {publishable_key,
 *                                             mode}. Still the ONE writer of "does this channel show
 *                                             on the invoice page" — app.public_invoice_by_token
 *                                             keeps reading it, unchanged. `mode` here is THE fact
 *                                             of which key set is currently in force.
 *   academy_xpay_credentials                  the secrets (Laravel-encrypted at rest), readable only
 *                                             by server-side code through the SECURITY DEFINER
 *                                             functions below. Never in any API response.
 *
 * TWO KEY SETS, ONE IN FORCE. XPay issues completely separate credentials per environment, and
 * onboarding a client means running test payments first and only then switching to real money. If a
 * client could hold one key set at a time, going live would mean pasting over the test keys and
 * losing the ability to reproduce anything afterwards. So credentials are keyed by
 * (academy_id, mode): a client can hold both sets indefinitely, and `academy_payment_settings
 * .config->>'mode'` alone decides which one every payment path resolves. Flipping test → live is one
 * field, and flipping back to debug costs nothing.
 *
 * THE MONEY PATH. The payer opens /i/{token} → we create an XPay Checkout Session server-side and
 * redirect them to the hosted page → XPay POSTs `checkout.session.completed` to
 * /api/webhooks/xpay/{academy} → we mark the invoice PAID. The webhook is the source of truth (the
 * redirect back is a UX courtesy — the payer can close the tab), but XPay's docs also let us re-read
 * a session, so the return page has a sync fallback for clients who never configured a webhook.
 *
 * All three helper tables are written from the PUBLIC (unauthenticated) invoice + webhook routes,
 * which have no tenant context — hence the SECURITY DEFINER + BYPASSRLS functions, exactly as
 * app.paypal_config_by_token / app.paypal_mark_invoice_paid already do for PayPal.
 */
return new class extends Migration
{
    public function up(): void
    {
        // ── Credentials: Super-Admin-provisioned, encrypted, academy-invisible ──
        DB::unprepared(<<<'SQL'
            create table academy_xpay_credentials (
              academy_id         uuid not null references academies(id) on delete cascade,
              -- One row per environment. Which of them is in force lives on
              -- academy_payment_settings.config->>'mode', never here — a row is just "these are the
              -- client's test keys", with no opinion about whether they are the ones being used.
              mode               text not null check (mode in ('test', 'live')),
              -- Safe to expose (it is the browser-side key); kept per mode because XPay issues a
              -- different one per environment.
              publishable_key    text,
              -- Laravel Crypt::encryptString ciphertext (same pattern as academy_automation_settings
              -- .wasender_token). The plaintext sk_*/whsec_* never touches the database.
              secret_key_enc     text not null,
              webhook_secret_enc text,
              -- Display-only tails so the Super Admin can tell which key is loaded without ever
              -- round-tripping the secret itself back to the browser.
              secret_last4       text,
              webhook_last4      text,
              updated_by         uuid references users(id),
              created_at         timestamptz not null default now(),
              updated_at         timestamptz not null default now(),
              primary key (academy_id, mode)
            );

            alter table academy_xpay_credentials enable row level security;
            alter table academy_xpay_credentials force row level security;
            create policy tenant_isolation on academy_xpay_credentials
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        // ── The local order record: one row per Checkout Session we open ────────
        // Not strictly required to take money (metadata.invoice_id carries the link), but it is what
        // makes a payment reconcilable after the fact: which invoice, how much, what XPay said last.
        DB::unprepared(<<<'SQL'
            create table xpay_checkout_sessions (
              id             text primary key,                      -- cs_test_* / cs_live_*
              academy_id     uuid not null references academies(id) on delete cascade,
              invoice_id     uuid not null references invoices(id)  on delete cascade,
              amount_minor   bigint not null,
              currency       char(3) not null,
              status         text not null default 'open',          -- open | complete | expired
              payment_status text not null default 'unpaid',        -- unpaid | paid | no_payment_required
              url            text,
              created_at     timestamptz not null default now(),
              updated_at     timestamptz not null default now()
            );
            create index xpay_checkout_sessions_invoice_idx on xpay_checkout_sessions (invoice_id);
            create index xpay_checkout_sessions_academy_idx on xpay_checkout_sessions (academy_id);

            alter table xpay_checkout_sessions enable row level security;
            alter table xpay_checkout_sessions force row level security;
            create policy tenant_isolation on xpay_checkout_sessions
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        // ── Webhook replay guard ────────────────────────────────────────────────
        // XPay retries on every non-2xx and may re-deliver a successful one; `event.id` is stable
        // across retries, so an insert that conflicts IS the "already handled" signal.
        DB::unprepared(<<<'SQL'
            create table xpay_webhook_events (
              id          text primary key,                         -- evt_test_* / evt_live_*
              academy_id  uuid not null references academies(id) on delete cascade,
              type        text not null,
              payload     jsonb not null,
              received_at timestamptz not null default now()
            );
            create index xpay_webhook_events_academy_idx on xpay_webhook_events (academy_id, received_at desc);

            alter table xpay_webhook_events enable row level security;
            alter table xpay_webhook_events force row level security;
            create policy tenant_isolation on xpay_webhook_events
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        $bypass = (string) config('database.rls.bypass_role', '');
        $isBypass = $bypass !== '' && preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $bypass) === 1;

        // ── Server-side credential + invoice lookup for the public checkout route ──
        // Returns the ENCRYPTED secret; the controller decrypts in PHP. Mirrors
        // app.paypal_config_by_token, including the `is_active` gate: an academy whose XPay channel
        // is switched off resolves to null and the route 422s.
        DB::unprepared(<<<'SQL'
            create or replace function app.xpay_config_by_token(p_token text)
            returns json
            language plpgsql
            security definer
            set search_path = public, pg_catalog
            as $$
            declare
                v_result json;
            begin
                select json_build_object(
                    'invoice_id',     i.id,
                    'academy_id',     i.academy_id,
                    'academy_name',   a.name,
                    'status',         i.status,
                    'total_minor',    i.total_minor,
                    'amount_paid_minor', i.amount_paid_minor,
                    'currency',       i.currency,
                    'period_year',    i.period_year,
                    'period_month',   i.period_month,
                    'secret_key_enc', c.secret_key_enc,
                    'mode',           c.mode
                )
                into v_result
                from invoices i
                join academies a
                  on a.id = i.academy_id
                join academy_payment_settings ps
                  on ps.academy_id = i.academy_id
                -- The active mode selects the key set. A client holding only test keys while set to
                -- live resolves to nothing here, and the route 422s instead of charging with the
                -- wrong environment's credentials.
                join academy_xpay_credentials c
                  on c.academy_id = i.academy_id
                 and c.mode = coalesce(ps.config->>'mode', 'test')
                where i.public_token = p_token
                  and ps.method = 'XPAY'
                  and ps.is_active = true
                limit 1;

                return v_result;
            end;
            $$;
        SQL);

        // ── Webhook credential lookup, keyed by the academy in the callback URL ──
        // The URL's academy id only SELECTS which signing secret to check against; the HMAC is what
        // authenticates the request. Resolves the ACTIVE mode's secret, which is also the security
        // property that matters here: while a client is switched to live, a test-mode delivery
        // cannot verify, so play money can never close a real invoice.
        //
        // Deliberately ignores `is_active` so a late delivery landing just after the channel is
        // switched off still closes the invoice it was opened for.
        DB::unprepared(<<<'SQL'
            create or replace function app.xpay_credentials_for_academy(p_academy_id text)
            returns json
            language plpgsql
            security definer
            set search_path = public, pg_catalog
            as $$
            declare
                v_result json;
            begin
                select json_build_object(
                    'academy_id',         c.academy_id,
                    'secret_key_enc',     c.secret_key_enc,
                    'webhook_secret_enc', c.webhook_secret_enc,
                    'mode',               c.mode
                )
                into v_result
                from academy_payment_settings ps
                join academy_xpay_credentials c
                  on c.academy_id = ps.academy_id
                 and c.mode = coalesce(ps.config->>'mode', 'test')
                where ps.academy_id = p_academy_id::uuid
                  and ps.method = 'XPAY'
                limit 1;

                return v_result;
            end;
            $$;
        SQL);

        // ── Upsert the local order row (open on create, refreshed on every read) ──
        DB::unprepared(<<<'SQL'
            create or replace function app.xpay_record_session(
                p_id             text,
                p_academy_id     text,
                p_invoice_id     text,
                p_amount_minor   bigint,
                p_currency       text,
                p_status         text,
                p_payment_status text,
                p_url            text
            )
            returns void
            language plpgsql
            security definer
            set search_path = public, pg_catalog
            as $$
            begin
                insert into xpay_checkout_sessions
                    (id, academy_id, invoice_id, amount_minor, currency, status, payment_status, url)
                values
                    (p_id, p_academy_id::uuid, p_invoice_id::uuid, p_amount_minor, upper(p_currency),
                     p_status, p_payment_status, p_url)
                on conflict (id) do update
                    set status         = excluded.status,
                        payment_status = excluded.payment_status,
                        url            = coalesce(excluded.url, xpay_checkout_sessions.url),
                        updated_at     = now();
            end;
            $$;
        SQL);

        // ── Replay guard: true = first time we have seen this event, false = duplicate ──
        DB::unprepared(<<<'SQL'
            create or replace function app.xpay_record_event(
                p_event_id   text,
                p_academy_id text,
                p_type       text,
                p_payload    json
            )
            returns boolean
            language plpgsql
            security definer
            set search_path = public, pg_catalog
            as $$
            declare
                v_inserted integer;
            begin
                insert into xpay_webhook_events (id, academy_id, type, payload)
                values (p_event_id, p_academy_id::uuid, p_type, p_payload::jsonb)
                on conflict (id) do nothing;

                get diagnostics v_inserted = row_count;
                return v_inserted > 0;
            end;
            $$;
        SQL);

        // ── The amount WE opened the session for ────────────────────────────────
        // The webhook must check the paid amount against what we billed, and the only trustworthy
        // source for that is our own row — never a figure lifted out of the incoming payload.
        DB::unprepared(<<<'SQL'
            create or replace function app.xpay_session_amount(p_session_id text, p_invoice_id text)
            returns bigint
            language plpgsql
            security definer
            set search_path = public, pg_catalog
            as $$
            declare
                v_amount bigint;
            begin
                select s.amount_minor into v_amount
                from xpay_checkout_sessions s
                where s.id = p_session_id
                  and s.invoice_id = p_invoice_id::uuid
                limit 1;

                return v_amount;
            end;
            $$;
        SQL);

        // ── Read back an invoice's settled state from a public route ────────────
        // The return page has to tell the payer "paid" even when the webhook won the race and this
        // request's own settle() therefore changed nothing.
        DB::unprepared(<<<'SQL'
            create or replace function app.xpay_invoice_status(p_invoice_id text)
            returns text
            language plpgsql
            security definer
            set search_path = public, pg_catalog
            as $$
            declare
                v_status text;
            begin
                select i.status into v_status
                from invoices i
                where i.id = p_invoice_id::uuid
                limit 1;

                return v_status;
            end;
            $$;
        SQL);

        // ── Mark an invoice paid after a confirmed XPay payment ──────────────────
        // Same terminal-state guard as app.paypal_mark_invoice_paid: only OPEN/CLOSED invoices move,
        // so a duplicate delivery (or the return-page sync racing the webhook) is a no-op returning
        // false rather than a double write.
        DB::unprepared(<<<'SQL'
            create or replace function app.xpay_mark_invoice_paid(
                p_invoice_id text,
                p_session_id text
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
                    payment_reason    = concat('XPay — session ', p_session_id),
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

        if ($isBypass) {
            // The SECURITY DEFINER functions run as the BYPASSRLS role, which needs table-level
            // grants on the new tables (mirrors migration 10's grants and the payment_settings one).
            DB::unprepared("grant select on academy_xpay_credentials to {$bypass};");
            DB::unprepared("grant select, insert, update on xpay_checkout_sessions to {$bypass};");
            DB::unprepared("grant select, insert on xpay_webhook_events to {$bypass};");

            // Settling a payment UPDATES the invoice, but migration 10 only ever granted the bypass
            // role SELECT on invoices ('grant select on academies, invoices, ... to %s'). Without
            // this, app.xpay_mark_invoice_paid dies with "permission denied for table invoices".
            //
            // NOTE: this repairs PayPal too. app.paypal_mark_invoice_paid has always run the same
            // UPDATE as the same role and has always hit the same wall — it just had no test to
            // catch it, so every PayPal capture failed at the final step after the money moved.
            DB::unprepared("grant update on invoices to {$bypass};");

            foreach ([
                'app.xpay_config_by_token(text)',
                'app.xpay_credentials_for_academy(text)',
                'app.xpay_record_session(text,text,text,bigint,text,text,text,text)',
                'app.xpay_record_event(text,text,text,json)',
                'app.xpay_session_amount(text,text)',
                'app.xpay_invoice_status(text)',
                'app.xpay_mark_invoice_paid(text,text)',
            ] as $fn) {
                DB::unprepared("alter function {$fn} owner to {$bypass};");
            }
        }
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop function if exists app.xpay_mark_invoice_paid(text, text);
            drop function if exists app.xpay_invoice_status(text);
            drop function if exists app.xpay_session_amount(text, text);
            drop function if exists app.xpay_record_event(text, text, text, json);
            drop function if exists app.xpay_record_session(text, text, text, bigint, text, text, text, text);
            drop function if exists app.xpay_credentials_for_academy(text);
            drop function if exists app.xpay_config_by_token(text);
            drop table if exists xpay_webhook_events;
            drop table if exists xpay_checkout_sessions;
            drop policy if exists tenant_isolation on academy_xpay_credentials;
            drop table if exists academy_xpay_credentials;
        SQL);
    }
};
