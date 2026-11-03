<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Support\AcademyProfile;
use App\Support\StudentStatus;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * One row per academy: the profile it is ON, the switches it holds, and what it actually has
 * DATA in — so a move between profiles (`profile:set`) is decided on facts, never on a guess.
 *
 * The `verdict` column is the summary: `quran` / `centre` when the data agrees with the profile,
 * `MIXED` when a Quran academy holds centre data (receipts, groups, lesson subscriptions) or a
 * centre holds hour packages — those are the ones to look at by name before touching anything.
 *
 * Every tenant table is behind RLS, so the counts run one academy at a time inside that
 * academy's context (the same way the nightly jobs fan out).
 *
 *   php artisan profile:survey [--mixed]
 */
final class ProfileSurvey extends Command
{
    protected $signature = 'profile:survey
        {--mixed : Only the academies whose data disagrees with their profile}';

    protected $description = 'Every academy with its profile, its switches and the centre/Quran data it holds.';

    public function handle(): int
    {
        $rows = DB::transaction(function (): array {
            DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

            $academies = DB::table('academies as a')
                ->leftJoin('academy_types as t', 't.id', '=', 'a.academy_type_id')
                ->where('a.client_type', 'MANAGEMENT')
                ->orderBy('a.status')->orderBy('a.name')
                ->get(['a.id', 'a.name', 'a.status', 't.code as type_code']);

            $rows = [];
            foreach ($academies as $academy) {
                DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $academy->id]);
                $counts = DB::selectOne($this->sql(), [implode(',', StudentStatus::ACTIVE)]);
                $rows[] = (object) array_merge((array) $academy, (array) $counts);
            }

            return $rows;
        });

        $out = [];
        foreach ($rows as $r) {
            $profile = AcademyProfile::fromTypeCode($r->type_code);
            $centreData = (int) $r->groups + (int) $r->receipts + (int) $r->pk_lessons + (int) $r->disc;
            $quranData = (int) $r->pk_hours + (int) $r->follows + (int) $r->rep_tpl + (int) $r->card_tpl;
            $verdict = match (true) {
                $profile === AcademyProfile::CENTRE && $quranData > 0 => 'MIXED',
                $profile === AcademyProfile::QURAN && $centreData > 0 => 'MIXED',
                default => strtolower($profile),
            };
            if ($this->option('mixed') && $verdict !== 'MIXED') {
                continue;
            }

            $out[] = [
                $r->name,
                $r->status,
                $profile,
                $verdict,
                implode(' ', array_filter([
                    $r->centre_on ? 'centre' : null,
                    $r->receipts_on ? 'receipts' : null,
                    $r->groups_on ? 'groups' : null,
                    $r->lesson_report_on ? 'lesson_report' : null,
                ])),
                $r->students, $r->teachers, $r->les_30d,
                $r->groups, $r->pk_lessons, $r->receipts, $r->disc,
                $r->pk_hours, $r->follows, $r->trials, (int) $r->rep_tpl + (int) $r->card_tpl,
            ];
        }

        $this->table(
            ['academy', 'status', 'profile', 'verdict', 'switches',
                'students', 'teachers', 'lessons/30d',
                'groups', 'subs(lessons)', 'receipts', 'discounts',
                'pk(hours)', 'follows', 'trials', 'templates'],
            $out,
        );
        $this->line(count($out).' academies.');

        return self::SUCCESS;
    }

    /** The counts for the academy in context (every table here is RLS-scoped to it). */
    private function sql(): string
    {
        return <<<'SQL'
        with ov as (
          select overrides::jsonb as o
          from module_subscriptions
          where module = 'MANAGEMENT' and status <> 'ENDED'
          order by created_at desc
          limit 1
        )
        select
          coalesce((select jsonb_exists(coalesce(o -> 'enabled', '[]'::jsonb), 'centre') from ov), false)        as centre_on,
          coalesce((select jsonb_exists(coalesce(o -> 'enabled', '[]'::jsonb), 'accounting') from ov), false)    as receipts_on,
          coalesce((select jsonb_exists(coalesce(o -> 'enabled', '[]'::jsonb), 'lesson_report') from ov), false) as lesson_report_on,
          coalesce((select not jsonb_exists(coalesce(o -> 'disabled', '[]'::jsonb), 'groups') from ov), false)   as groups_on,
          (select count(*) from students s where s.deleted_at is null and s.status = any(string_to_array(?, ','))) as students,
          (select count(*) from teachers te where te.deleted_at is null and te.is_active) as teachers,
          (select count(*) from sessions se where se.scheduled_at_utc > now() - interval '30 days' and se.hidden_at is null) as les_30d,
          (select count(*) from class_groups) as groups,
          (select count(*) from lesson_packages p where p.lesson_minutes is null) as pk_hours,
          (select count(*) from lesson_packages p where p.lesson_minutes is not null) as pk_lessons,
          (select count(*) from receipts) as receipts,
          (select count(*) from discount_presets) as disc,
          (select count(*) from trials tr where tr.deleted_at is null) as trials,
          (select count(*) from session_follow_ups) as follows,
          (select count(*) from lesson_report_templates) as rep_tpl,
          (select count(*) from report_card_templates) as card_tpl
        SQL;
    }
}
