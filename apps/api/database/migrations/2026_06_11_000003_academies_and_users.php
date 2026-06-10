<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The tenant root (academies) plus the identity tables (§6.1 academies, §6.2 users,
 * user_roles). `users` is created here — not in the framework migration — because it
 * is UUID-keyed and references academies(id), which must exist first.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            -- The tenant root. Has NO academy_id; it *is* the academy.
            create table academies (
              id                 uuid primary key default uuid_generate_v7(),
              name               text not null,
              academy_type_id    uuid not null references academy_types(id),
              status             academy_status not null default 'TRIAL',
              plan_id            uuid references plans(id),
              default_currency   char(3) not null,
              timezone           text not null default 'UTC',
              invoice_grouping   invoice_grouping not null default 'PER_GUARDIAN',
              billing_day        smallint not null default 1,
              -- Branding (reserved, R-BRA-1; unused in MVP).
              brand_logo_url     text,
              brand_display_name text,
              subdomain          text unique,
              created_at         timestamptz not null default now(),
              updated_at         timestamptz not null default now()
            );

            -- Login identities owned by Laravel/Sanctum (no Supabase auth.users).
            create table users (
              id                uuid primary key default uuid_generate_v7(),
              academy_id        uuid references academies(id),     -- NULL only for SUPER_ADMIN
              full_name         text not null,
              email             text not null unique,
              password          text not null,                     -- bcrypt/argon hash
              phone             text,
              is_active         boolean not null default true,
              remember_token    varchar(100),
              email_verified_at timestamptz,
              created_at        timestamptz not null default now(),
              updated_at        timestamptz not null default now()
            );

            -- RBAC assignment: a user has one or more roles within an academy.
            create table user_roles (
              id          uuid primary key default uuid_generate_v7(),
              user_id     uuid not null references users(id) on delete cascade,
              academy_id  uuid references academies(id),           -- NULL for SUPER_ADMIN
              role        app_role not null,
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now(),
              unique (user_id, academy_id, role)
            );
            create index user_roles_user_idx on user_roles (user_id);
            create index user_roles_academy_idx on user_roles (academy_id);
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop table if exists user_roles;
            drop table if exists users;
            drop table if exists academies;
        SQL);
    }
};
