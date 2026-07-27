<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * FIX: /admin/lms could not see a real LMS client (docs/lms/08).
 *
 * The readers in 2026_07_23_000001 identified the course-platform subscription as the row with
 * `module = 'LMS'`. That is NOT how an LMS client is actually provisioned: the academy-creation flow
 * writes ONE `module_subscriptions` row named **MANAGEMENT carrying the LMS plan**, so a genuine LMS
 * client has no `module = 'LMS'` row at all. The result: a freshly created client was invisible on
 * the roster (it only appeared once it had a course, via the course/learner union), and its detail
 * page reported status NONE with no plan and no caps.
 *
 * This is the same trap `Entitlement::applyLmsOnlyGuard` hit in 2026-07-22 — module ROW NAMES are not
 * a reliable signal of what a client bought. The reliable signal is the PLAN: `plans.module = 'LMS'`
 * marks an LMS plan, and only the LMS tier carries it.
 *
 * So both readers now resolve the LMS-bearing subscription as:
 *
 *     ms.module = 'LMS'  OR  the sub's plan has plans.module = 'LMS'
 *
 * preferring a dedicated `LMS` row when a client somehow has both (`distinct on` + the ordering),
 * so the two shapes can never produce two rows for one academy.
 *
 * Deliberately NOT keyed on the `lms` capability: FREE and PRO bundle every capability including
 * `lms`, so that would list every general client as a course-platform client. A PRO client who
 * actually publishes courses still appears — through the existing courses/learners union.
 *
 * Everything else in both functions is unchanged from 000001.
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
        $bypass = $this->role('bypass_role');
        $app = $this->role('app_role');

        // ── Per-academy usage + platform totals ──────────────────────────────────
        DB::unprepared('drop function if exists app.admin_lms_stats();');
        DB::unprepared(<<<'SQL'
            create or replace function app.admin_lms_stats()
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare result jsonb;
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.admin_lms_stats requires SUPER_ADMIN';
              end if;

              with sub as (
                -- The LMS-bearing subscription: a dedicated LMS module row, OR (the shape the
                -- creation flow actually produces) any live row carrying an LMS PLAN. One row per
                -- academy, preferring a real LMS module row when both exist.
                select distinct on (ms.academy_id)
                  ms.academy_id,
                  ms.status,
                  ms.is_trial,
                  ms.trial_end,
                  ms.overrides,
                  ms.plan_id,
                  case
                    when ms.status = 'PAUSED' then 'PAUSED'
                    when ms.status <> 'ACTIVE' then 'NONE'
                    when ms.is_trial and ms.trial_end is not null and ms.trial_end <= now() then 'EXPIRED'
                    when ms.is_trial then 'TRIAL'
                    else 'ACTIVE'
                  end as lms_status
                from module_subscriptions ms
                left join plans p on p.id = ms.plan_id
                where ms.status <> 'ENDED'
                  and (ms.module = 'LMS' or p.module = 'LMS')
                order by ms.academy_id, (ms.module = 'LMS') desc, ms.created_at desc
              ),
              course_agg as (
                select academy_id,
                  count(*) filter (where deleted_at is null)                            as courses_total,
                  count(*) filter (where deleted_at is null and status = 'PUBLISHED')   as courses_published,
                  count(*) filter (where deleted_at is null and status = 'DRAFT')       as courses_draft
                from courses group by academy_id
              ),
              lesson_agg as (
                select academy_id, count(*) as lessons from lessons group by academy_id
              ),
              learner_agg as (
                select academy_id,
                  count(*)                                     as learners,
                  count(*) filter (where status = 'ACTIVE')    as active_learners,
                  max(last_login_at)                           as last_login_at
                from learners group by academy_id
              ),
              enroll_agg as (
                select academy_id,
                  count(*)                                     as enrollments,
                  count(*) filter (where status = 'ACTIVE')     as active_enrollments,
                  max(enrolled_at)                             as last_enrolled_at
                from enrollments group by academy_id
              ),
              code_agg as (
                select academy_id,
                  count(*)                                          as codes,
                  count(*) filter (where is_active)                  as active_codes,
                  coalesce(sum(redemptions_count), 0)::bigint        as redeemed_codes
                from access_codes group by academy_id
              ),
              media_agg as (
                select academy_id,
                  coalesce(sum(size_bytes), 0)::bigint                          as storage_bytes,
                  count(*) filter (where status = 'PROCESSING')                 as media_processing,
                  count(*) filter (where status = 'FAILED')                     as media_failed
                from media_assets group by academy_id
              ),
              cert_agg as (
                select academy_id, count(*) as certificates from course_certificates group by academy_id
              ),
              ids as (
                select academy_id from sub
                union select academy_id from course_agg
                union select academy_id from learner_agg
              ),
              per_academy as (
                select
                  a.id                                   as academy_id,
                  a.name                                 as academy_name,
                  a.subdomain                            as subdomain,
                  a.created_at                           as created_at,
                  p.name                                 as plan_name,
                  lp.name                                as lms_plan_name,
                  coalesce(s.lms_status, 'NONE')         as lms_status,
                  s.trial_end                            as trial_end,
                  coalesce(
                    nullif(s.overrides->'limits'->>'maxCourses', '')::int,
                    nullif(lp.features->'limits'->>'maxCourses', '')::int
                  )                                      as max_courses,
                  coalesce(
                    nullif(s.overrides->'limits'->>'maxLearners', '')::int,
                    nullif(lp.features->'limits'->>'maxLearners', '')::int
                  )                                      as max_learners,
                  coalesce(
                    nullif(s.overrides->'limits'->>'maxStorageGb', '')::int,
                    nullif(lp.features->'limits'->>'maxStorageGb', '')::int
                  )                                      as max_storage_gb,
                  coalesce(ca.courses_total, 0)          as courses_total,
                  coalesce(ca.courses_published, 0)      as courses_published,
                  coalesce(ca.courses_draft, 0)          as courses_draft,
                  coalesce(la.lessons, 0)                as lessons,
                  coalesce(le.learners, 0)               as learners,
                  coalesce(le.active_learners, 0)        as active_learners,
                  coalesce(ea.enrollments, 0)            as enrollments,
                  coalesce(ea.active_enrollments, 0)     as active_enrollments,
                  coalesce(co.codes, 0)                  as codes,
                  coalesce(co.active_codes, 0)           as active_codes,
                  coalesce(co.redeemed_codes, 0)         as redeemed_codes,
                  coalesce(ma.storage_bytes, 0)          as storage_bytes,
                  coalesce(ma.media_processing, 0)       as media_processing,
                  coalesce(ma.media_failed, 0)           as media_failed,
                  coalesce(ce.certificates, 0)           as certificates,
                  greatest(
                    coalesce(ea.last_enrolled_at, to_timestamp(0)),
                    coalesce(le.last_login_at, to_timestamp(0))
                  )                                      as last_activity
                from ids
                join academies a          on a.id = ids.academy_id
                left join sub s           on s.academy_id = ids.academy_id
                left join plans p         on p.id = a.plan_id
                left join plans lp        on lp.id = s.plan_id
                left join course_agg ca   on ca.academy_id = ids.academy_id
                left join lesson_agg la   on la.academy_id = ids.academy_id
                left join learner_agg le  on le.academy_id = ids.academy_id
                left join enroll_agg ea   on ea.academy_id = ids.academy_id
                left join code_agg co     on co.academy_id = ids.academy_id
                left join media_agg ma    on ma.academy_id = ids.academy_id
                left join cert_agg ce     on ce.academy_id = ids.academy_id
              )
              select jsonb_build_object(
                'academies', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'academy_id',         academy_id,
                    'academy_name',       academy_name,
                    'subdomain',          subdomain,
                    'created_at',         created_at,
                    'plan_name',          plan_name,
                    'lms_plan_name',      lms_plan_name,
                    'lms_status',         lms_status,
                    'lms_enabled',        lms_status in ('ACTIVE', 'TRIAL'),
                    'trial_end',          trial_end,
                    'max_courses',        max_courses,
                    'max_learners',       max_learners,
                    'max_storage_gb',     max_storage_gb,
                    'courses_total',      courses_total,
                    'courses_published',  courses_published,
                    'courses_draft',      courses_draft,
                    'lessons',            lessons,
                    'learners',           learners,
                    'active_learners',    active_learners,
                    'enrollments',        enrollments,
                    'active_enrollments', active_enrollments,
                    'codes',              codes,
                    'active_codes',       active_codes,
                    'redeemed_codes',     redeemed_codes,
                    'storage_bytes',      storage_bytes,
                    'media_processing',   media_processing,
                    'media_failed',       media_failed,
                    'certificates',       certificates,
                    'last_activity',      nullif(last_activity, to_timestamp(0))
                  ) order by learners desc, courses_total desc, academy_name)
                  from per_academy
                ), '[]'::jsonb),
                'totals', (
                  select jsonb_build_object(
                    'academies',         count(*),
                    'active',            count(*) filter (where lms_status = 'ACTIVE'),
                    'trial',             count(*) filter (where lms_status = 'TRIAL'),
                    'courses',           coalesce(sum(courses_total), 0),
                    'published_courses', coalesce(sum(courses_published), 0),
                    'lessons',           coalesce(sum(lessons), 0),
                    'learners',          coalesce(sum(learners), 0),
                    'enrollments',       coalesce(sum(enrollments), 0),
                    'redeemed_codes',    coalesce(sum(redeemed_codes), 0),
                    'storage_bytes',     coalesce(sum(storage_bytes), 0),
                    'certificates',      coalesce(sum(certificates), 0)
                  )
                  from per_academy
                )
              )
              into result;

              return result;
            end;
            $$;
        SQL);

        DB::unprepared("alter function app.admin_lms_stats() owner to {$bypass};");
        DB::unprepared('revoke all on function app.admin_lms_stats() from public;');
        DB::unprepared("grant execute on function app.admin_lms_stats() to {$app};");

        // ── Per-academy detail ───────────────────────────────────────────────────
        DB::unprepared('drop function if exists app.admin_lms_academy(uuid);');
        DB::unprepared(<<<'SQL'
            create or replace function app.admin_lms_academy(p_academy uuid)
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare result jsonb; sub record; acad record;
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.admin_lms_academy requires SUPER_ADMIN';
              end if;

              select a.id, a.name, a.subdomain, a.created_at, a.default_currency, p.name as plan_name
              into acad
              from academies a left join plans p on p.id = a.plan_id
              where a.id = p_academy;

              if acad.id is null then
                return null;  -- the controller turns this into a 404
              end if;

              -- Same resolution as admin_lms_stats: a dedicated LMS module row, else the live row
              -- carrying an LMS plan (the shape the academy-creation flow produces).
              select ms.status, ms.is_trial, ms.trial_start, ms.trial_end, ms.plan_id, ms.overrides,
                     ms.current_period_start, ms.current_period_end, ms.total_cost_minor, ms.currency,
                     lp.name as lms_plan_name, lp.features as lms_features,
                     case
                       when ms.status = 'PAUSED' then 'PAUSED'
                       when ms.status <> 'ACTIVE' then 'NONE'
                       when ms.is_trial and ms.trial_end is not null and ms.trial_end <= now() then 'EXPIRED'
                       when ms.is_trial then 'TRIAL'
                       else 'ACTIVE'
                     end as lms_status
              into sub
              from module_subscriptions ms
              left join plans lp on lp.id = ms.plan_id
              where ms.academy_id = p_academy
                and ms.status <> 'ENDED'
                and (ms.module = 'LMS' or lp.module = 'LMS')
              order by (ms.module = 'LMS') desc, ms.created_at desc
              limit 1;

              select jsonb_build_object(
                'academy', jsonb_build_object(
                  'id',             acad.id,
                  'name',           acad.name,
                  'subdomain',      acad.subdomain,
                  'created_at',     acad.created_at,
                  'currency',       acad.default_currency,
                  'plan_name',      acad.plan_name,
                  'lms_plan_name',  sub.lms_plan_name,
                  'lms_status',     coalesce(sub.lms_status, 'NONE'),
                  'lms_enabled',    coalesce(sub.lms_status, 'NONE') in ('ACTIVE', 'TRIAL'),
                  'trial_start',    sub.trial_start,
                  'trial_end',      sub.trial_end,
                  'lms_limits', jsonb_strip_nulls(jsonb_build_object(
                    'maxCourses', coalesce(
                      nullif(sub.overrides->'limits'->>'maxCourses', '')::int,
                      nullif(sub.lms_features->'limits'->>'maxCourses', '')::int),
                    'maxLearners', coalesce(
                      nullif(sub.overrides->'limits'->>'maxLearners', '')::int,
                      nullif(sub.lms_features->'limits'->>'maxLearners', '')::int),
                    'maxStorageGb', coalesce(
                      nullif(sub.overrides->'limits'->>'maxStorageGb', '')::int,
                      nullif(sub.lms_features->'limits'->>'maxStorageGb', '')::int)
                  )),
                  'lms_overrides', nullif(coalesce(sub.overrides->'limits', '{}'::jsonb), '{}'::jsonb)
                ),
                'subscription', case when sub.status is null then null else jsonb_build_object(
                  'status',               sub.status,
                  'is_trial',             sub.is_trial,
                  'trial_start',          sub.trial_start,
                  'trial_end',            sub.trial_end,
                  'current_period_start', sub.current_period_start,
                  'current_period_end',   sub.current_period_end,
                  'total_cost_minor',     sub.total_cost_minor,
                  'currency',             sub.currency,
                  'plan_name',            sub.lms_plan_name
                ) end,
                'stats', jsonb_build_object(
                  'courses_total',      (select count(*) from courses where academy_id = p_academy and deleted_at is null),
                  'courses_published',  (select count(*) from courses where academy_id = p_academy and deleted_at is null and status = 'PUBLISHED'),
                  'courses_draft',      (select count(*) from courses where academy_id = p_academy and deleted_at is null and status = 'DRAFT'),
                  'lessons',            (select count(*) from lessons where academy_id = p_academy),
                  'learners',           (select count(*) from learners where academy_id = p_academy),
                  'active_learners',    (select count(*) from learners where academy_id = p_academy and status = 'ACTIVE'),
                  'enrollments',        (select count(*) from enrollments where academy_id = p_academy),
                  'active_enrollments', (select count(*) from enrollments where academy_id = p_academy and status = 'ACTIVE'),
                  'codes',              (select count(*) from access_codes where academy_id = p_academy),
                  'active_codes',       (select count(*) from access_codes where academy_id = p_academy and is_active),
                  'redeemed_codes',     (select coalesce(sum(redemptions_count), 0) from access_codes where academy_id = p_academy),
                  'storage_bytes',      (select coalesce(sum(size_bytes), 0) from media_assets where academy_id = p_academy),
                  'media_processing',   (select count(*) from media_assets where academy_id = p_academy and status = 'PROCESSING'),
                  'media_failed',       (select count(*) from media_assets where academy_id = p_academy and status = 'FAILED'),
                  'certificates',       (select count(*) from course_certificates where academy_id = p_academy),
                  'quiz_attempts',      (select count(*) from quiz_attempts where academy_id = p_academy),
                  'completed_lessons',  (select count(*) from lesson_progress where academy_id = p_academy and status = 'COMPLETED')
                ),
                'courses', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id',           c.id,
                    'title',        c.title,
                    'slug',         c.slug,
                    'status',       c.status,
                    'created_at',   c.created_at,
                    'published_at', c.published_at,
                    'lessons',      (select count(*) from lessons l where l.course_id = c.id),
                    'learners',     (select count(*) from enrollments e where e.course_id = c.id and e.status = 'ACTIVE')
                  ) order by c.created_at desc)
                  from courses c where c.academy_id = p_academy and c.deleted_at is null
                ), '[]'::jsonb),
                'learners', coalesce((
                  select jsonb_agg(j order by created_at desc) from (
                    select jsonb_build_object(
                      'id',            l.id,
                      'full_name',     l.full_name,
                      'email',         l.email,
                      'status',        l.status,
                      'created_at',    l.created_at,
                      'last_login_at', l.last_login_at,
                      'enrollments',   (select count(*) from enrollments e where e.learner_id = l.id and e.status = 'ACTIVE')
                    ) as j, l.created_at as created_at
                    from learners l where l.academy_id = p_academy
                    order by l.created_at desc limit 50
                  ) sub_l
                ), '[]'::jsonb),
                'recent_enrollments', coalesce((
                  select jsonb_agg(j order by enrolled_at desc) from (
                    select jsonb_build_object(
                      'id',           e.id,
                      'learner_name', l.full_name,
                      'course_title', c.title,
                      'enrolled_at',  e.enrolled_at
                    ) as j, e.enrolled_at as enrolled_at
                    from enrollments e
                    join learners l on l.id = e.learner_id
                    join courses c  on c.id = e.course_id
                    where e.academy_id = p_academy
                    order by e.enrolled_at desc limit 10
                  ) sub_e
                ), '[]'::jsonb)
              )
              into result;

              return result;
            end;
            $$;
        SQL);

        DB::unprepared("alter function app.admin_lms_academy(uuid) owner to {$bypass};");
        DB::unprepared('revoke all on function app.admin_lms_academy(uuid) from public;');
        DB::unprepared("grant execute on function app.admin_lms_academy(uuid) to {$app};");
    }

    public function down(): void
    {
        // Intentionally a no-op: rolling back would restore the module-name-only readers, i.e. the
        // bug. 000001's down() still drops both functions outright.
    }
};
