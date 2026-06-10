<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Platform-level catalog (§6.1) — NOT tenant-scoped, no academy_id. These are a shared
 * read catalog (RLS policies in the rls migration make them readable by all roles,
 * writable only by Super Admin).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            -- Subscription tiers the platform sells to academies.
            create table plans (
              id          uuid primary key default uuid_generate_v7(),
              code        text not null unique,
              name        text not null,
              price_minor bigint not null,
              currency    char(3) not null,
              features    jsonb not null default '{}'::jsonb,
              is_active   boolean not null default true,
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now()
            );

            -- Paid extras on top of a plan.
            create table add_ons (
              id          uuid primary key default uuid_generate_v7(),
              code        text not null unique,
              name        text not null,
              price_minor bigint not null,
              currency    char(3) not null,
              feature_key text not null,
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now()
            );

            -- Configurable academy category (Qur'an, Languages…). Data, not code (R-CRF).
            create table academy_types (
              id          uuid primary key default uuid_generate_v7(),
              code        text not null unique,
              name        text not null,
              description text,
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now()
            );

            -- Discrete RBAC capabilities (consumed by Sprint 2 Gates/Policies).
            create table permissions (
              id          uuid primary key default uuid_generate_v7(),
              code        text not null unique,
              description text,
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now()
            );

            -- Which capabilities each role has. Modeled as data so new roles need no code change.
            create table role_permissions (
              role          app_role not null,
              permission_id uuid not null references permissions(id) on delete cascade,
              primary key (role, permission_id)
            );
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop table if exists role_permissions;
            drop table if exists permissions;
            drop table if exists academy_types;
            drop table if exists add_ons;
            drop table if exists plans;
        SQL);
    }
};
