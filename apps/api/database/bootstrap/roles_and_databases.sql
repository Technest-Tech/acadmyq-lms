-- ============================================================================
-- Sprint 1 — Local/CI database bootstrap (run ONCE as a Postgres superuser).
-- ============================================================================
-- Production note: on Supabase this provisioning is done in the dashboard / by
-- the platform. The roles below mirror the *contract* the app relies on:
--
--   academiq_app          The single role Laravel connects as for BOTH migrations
--                         and runtime requests. NOSUPERUSER, NOBYPASSRLS — so it
--                         is fully subject to RLS. It OWNS every table; FORCE ROW
--                         LEVEL SECURITY (set in migrations) is therefore what makes
--                         RLS apply to it (an owner is otherwise exempt).
--
--   academiq_rls_bypass   NOLOGIN, BYPASSRLS. Owns the few SECURITY DEFINER
--                         "escape hatch" functions (app.public_invoice_by_token,
--                         app.admin_list_academies). Because the definer role
--                         bypasses RLS, those functions can cross tenant rows in a
--                         single, audited, allow-listed way. academiq_app is GRANTed
--                         membership so a migration (run as academiq_app) can hand
--                         ownership of those functions to this role. NOTE: BYPASSRLS
--                         is a role *attribute* and is NEVER inherited via membership,
--                         so academiq_app itself stays subject to RLS.
--
-- Run:
--   psql -h 127.0.0.1 -p 5432 -d postgres -f database/bootstrap/roles_and_databases.sql
-- (as a superuser; on this machine that is the OS user, e.g. `psql ... -U ahmedomar`).
-- ============================================================================

-- Roles ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'academiq_rls_bypass') then
    create role academiq_rls_bypass nologin bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'academiq_app') then
    create role academiq_app login password 'academiq' nosuperuser nobypassrls createdb;
  end if;
end $$;

grant academiq_rls_bypass to academiq_app;

-- Databases -----------------------------------------------------------------
-- Owned by academiq_app so migrations (run as academiq_app) can create the
-- `app` schema, tables, functions, etc. without superuser help.
select 'create database academiq owner academiq_app'
  where not exists (select 1 from pg_database where datname = 'academiq')\gexec
select 'create database academiq_test owner academiq_app'
  where not exists (select 1 from pg_database where datname = 'academiq_test')\gexec
