<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Foundation for the whole schema (Sprint 1 §5, §4 contract, §12 uuid fallback).
 *
 *  - `app` schema holding the tenant-context accessor functions RLS policies read.
 *  - `uuid_generate_v7()` implemented in pure PL/pgSQL (no extension dependency —
 *    Supabase availability of pg uuid extensions is not assumed; §12 mitigation).
 *    Built on the built-in gen_random_uuid() (PG13+) for the random bits.
 *  - The 8 canonical enum types (§9 / §5 of the sprint doc).
 *  - The `app.current_*()` accessors that return NULL (never error) when a GUC is
 *    unset, which is what makes RLS fail *closed* (academy_id = NULL matches nothing).
 *
 * The bypass role is granted USAGE/CREATE on the `app` schema so later migrations can
 * hand it ownership of the SECURITY DEFINER escape-hatch functions.
 */
return new class extends Migration
{
    private function bypassRole(): string
    {
        $role = (string) config('database.rls.bypass_role', 'academiq_rls_bypass');
        if (! preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $role)) {
            throw new RuntimeException("Invalid RLS bypass role identifier: {$role}");
        }

        return $role;
    }

    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create schema if not exists app;
        SQL);

        DB::unprepared(sprintf('grant usage, create on schema app to %s;', $this->bypassRole()));

        // --- uuid v7 (time-ordered) without any extension --------------------
        DB::unprepared(<<<'SQL'
            create or replace function uuid_generate_v7()
            returns uuid
            language plpgsql
            volatile
            as $$
            declare
              ts_ms bytea;
              b bytea;
            begin
              -- 48-bit big-endian unix timestamp in milliseconds (drop the top 2 bytes of int8)
              ts_ms := substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3);
              b := uuid_send(gen_random_uuid());
              b := overlay(b placing ts_ms from 1 for 6);
              -- set the version nibble to 7, preserving the low 4 bits of byte 6
              b := set_byte(b, 6, 112 + (get_byte(b, 6) & 15));
              -- variant bits (10xx) are already RFC-4122 from gen_random_uuid()
              return encode(b, 'hex')::uuid;
            end;
            $$;
        SQL);

        // --- tenant-context accessors (read by every RLS policy) -------------
        // STABLE, SECURITY INVOKER. `true` second arg to current_setting => return
        // NULL (no error) if the GUC was never set => fail closed.
        DB::unprepared(<<<'SQL'
            create or replace function app.current_academy_id() returns uuid
            language sql stable as $$
              select nullif(current_setting('app.current_academy_id', true), '')::uuid
            $$;

            create or replace function app.current_user_id() returns uuid
            language sql stable as $$
              select nullif(current_setting('app.current_user_id', true), '')::uuid
            $$;

            create or replace function app.current_role() returns text
            language sql stable as $$
              select nullif(current_setting('app.current_role', true), '')
            $$;

            create or replace function app.is_super_admin() returns boolean
            language sql stable as $$
              select app.current_role() = 'SUPER_ADMIN'
            $$;
        SQL);

        // --- canonical enums (§9) -------------------------------------------
        DB::unprepared(<<<'SQL'
            create type session_status as enum (
              'SCHEDULED','ATTENDED','ABSENT_UNEXCUSED','ABSENT_EXCUSED',
              'CANCELLED_BY_TEACHER','CANCELLED_BY_STUDENT','RESCHEDULED'
            );
            create type invoice_status as enum (
              'OPEN','CLOSED','PAID','PARTIALLY_PAID','VOID'
            );
            create type payment_method as enum (
              'CASH','BANK_TRANSFER','GATEWAY','OTHER'
            );
            create type academy_status as enum ('ACTIVE','SUSPENDED','TRIAL');
            create type subscription_status as enum ('ACTIVE','PAUSED','ENDED');
            create type report_field_type as enum ('TEXT','TEXTAREA','NUMBER','SELECT','RATING');
            create type app_role as enum ('SUPER_ADMIN','ACADEMY_OWNER','TEACHER');
            create type invoice_grouping as enum ('PER_GUARDIAN','PER_STUDENT');
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop type if exists invoice_grouping;
            drop type if exists app_role;
            drop type if exists report_field_type;
            drop type if exists subscription_status;
            drop type if exists academy_status;
            drop type if exists payment_method;
            drop type if exists invoice_status;
            drop type if exists session_status;

            drop function if exists app.is_super_admin();
            drop function if exists app.current_role();
            drop function if exists app.current_user_id();
            drop function if exists app.current_academy_id();
            drop function if exists uuid_generate_v7();
        SQL);

        DB::unprepared('drop schema if exists app cascade;');
    }
};
