<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Super Admin LMS oversight (docs/lms) — the course-platform twin of the video oversight hatches
 * (2026_07_11_000001). Three audited cross-tenant readers following the `app.admin_video_stats()`
 * contract exactly: SECURITY DEFINER (so they bypass RLS), owned by the bypass role, guarded by a
 * SUPER_ADMIN check in the body, EXECUTE-locked to the app role, and returning a curated aggregate
 * projection — never a raw cross-tenant row dump.
 *
 *   - app.admin_lms_stats()                — one row per LMS client: catalogue size, learners,
 *                                            enrolments, access-code redemption, media storage and
 *                                            certificates, each against the effective plan cap;
 *                                            plus platform-wide totals for the header tiles.
 *   - app.admin_lms_academy(uuid)          — the per-client detail: the module subscription's
 *                                            effective status + limits + raw override, the same
 *                                            stats, and the courses / learners / codes / recent
 *                                            enrolment lists the control page acts on.
 *   - app.admin_lms_audit(uuid, int, int)  — the LMS activity feed (course/lesson/learner/code/
 *                                            enrolment/quiz/media actions), by academy/actor/time.
 *
 * LMS "status" is derived from the LMS `module_subscriptions` row, because that is what actually
 * grants the capability in Entitlement::resolveFromModules — an ACTIVE sub inside its trial window.
 * The same CASE is used by both readers so the list and the detail page can never disagree.
 *
 * The bypass role already holds SELECT on academies + audit_log + users + plans (the dashboard /
 * audit / academy-type migrations). Every LMS table and module_subscriptions are granted here.
 */
return new class extends Migration
{
    /** Tables the definer functions read that no earlier migration has granted to the bypass role. */
    private const READ_TABLES = [
        'module_subscriptions',
        'courses',
        'course_sections',
        'lessons',
        'media_assets',
        'learners',
        'enrollments',
        'lesson_progress',
        'access_codes',
        'code_redemptions',
        'course_certificates',
        'quiz_attempts',
    ];

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

        // The definer bypasses RLS but still needs table-level SELECT (idempotent).
        foreach (self::READ_TABLES as $table) {
            DB::unprepared("grant select on {$table} to {$bypass};");
        }

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
                -- The LMS module subscription (live rows only) + its effective status. ENDED rows are
                -- replaced history, so they never make an academy look like an LMS client.
                select
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
                where ms.module = 'LMS' and ms.status <> 'ENDED'
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
                  -- Effective caps: the per-academy override wins over the LMS plan's limits.
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
              where ms.academy_id = p_academy and ms.module = 'LMS' and ms.status <> 'ENDED'
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
                  -- Effective caps (override wins over the LMS plan) + the raw override the editor pre-fills.
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

        // ── Activity feed ────────────────────────────────────────────────────────
        DB::unprepared('drop function if exists app.admin_lms_audit(uuid, int, int);');
        DB::unprepared(<<<'SQL'
            create or replace function app.admin_lms_audit(
              p_academy uuid,
              p_limit   int,
              p_offset  int
            )
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare total bigint; rows jsonb;
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.admin_lms_audit requires SUPER_ADMIN';
              end if;

              select count(*) into total
              from audit_log al
              where al.action ~ '^(lms|lms_media|course|course_section|lesson|learner|enrollment|access_code|quiz)\.'
                and (p_academy is null or al.academy_id = p_academy);

              select coalesce(jsonb_agg(sub.j order by sub.created_at desc), '[]'::jsonb)
              into rows
              from (
                select jsonb_build_object(
                  'id',            al.id,
                  'academy_id',    al.academy_id,
                  'academy_name',  a.name,
                  'actor_user_id', al.actor_user_id,
                  'actor_name',    u.full_name,
                  'actor_role',    al.actor_role,
                  'action',        al.action,
                  'entity_type',   al.entity_type,
                  'entity_id',     al.entity_id,
                  'created_at',    al.created_at
                ) as j,
                al.created_at as created_at
                from audit_log al
                left join academies a on a.id = al.academy_id
                left join users u on u.id = al.actor_user_id
                where al.action ~ '^(lms|lms_media|course|course_section|lesson|learner|enrollment|access_code|quiz)\.'
                  and (p_academy is null or al.academy_id = p_academy)
                order by al.created_at desc
                limit greatest(p_limit, 0) offset greatest(p_offset, 0)
              ) sub;

              return jsonb_build_object('rows', rows, 'total', total);
            end;
            $$;
        SQL);

        DB::unprepared("alter function app.admin_lms_audit(uuid, int, int) owner to {$bypass};");
        DB::unprepared('revoke all on function app.admin_lms_audit(uuid, int, int) from public;');
        DB::unprepared("grant execute on function app.admin_lms_audit(uuid, int, int) to {$app};");
    }

    public function down(): void
    {
        DB::unprepared('drop function if exists app.admin_lms_stats();');
        DB::unprepared('drop function if exists app.admin_lms_academy(uuid);');
        DB::unprepared('drop function if exists app.admin_lms_audit(uuid, int, int);');
    }
};
