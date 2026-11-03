<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\LessonPackages;
use App\Support\AuthContext;
use App\Support\Tenancy;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Lessons an undo was refused on, but that lost their place on the package anyway (lingo, 2026-11-03).
 * The payout refused after the package had already given the minutes back, and the request's
 * transaction committed the half that ran: the lesson still says attended and is paid, while the
 * package no longer counts it. AttendanceService now does the two as one; this puts these back on
 * the package they came off. A lesson someone took off by hand ("remove from this package") is left.
 *
 * Lists what it would do; `--apply` does it.
 *
 *   php artisan lessons:restore-half-undone [--academy=<uuid>] [--apply]
 */
final class RestoreHalfUndoneLessons extends Command
{
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    protected $signature = 'lessons:restore-half-undone
        {--academy= : Limit to one academy id}
        {--apply : Put them back (default: only list)}';

    protected $description = 'Put back on their package the lessons a refused undo took off.';

    public function handle(LessonPackages $packages): int
    {
        $apply = (bool) $this->option('apply');
        foreach ($this->academies() as $academyId => $name) {
            $ctx = new AuthContext(userId: self::SYSTEM_USER_ID, academyId: $academyId, role: 'SUPER_ADMIN', permissions: []);
            $lessons = Tenancy::withContext($ctx, fn () => $this->halfUndone());
            if ($lessons->isEmpty()) {
                continue;
            }

            $this->info("{$name} ({$academyId})");
            foreach ($lessons as $l) {
                $this->line(sprintf('  %s · %s · %s  (%d/%d, %s)', $l->student_name, $l->scheduled_at_utc, $l->label, $l->minutes_consumed, $l->minutes_total, $l->package_status));
            }
            if (! $apply) {
                continue;
            }

            Tenancy::withContext($ctx, function () use ($lessons, $packages): void {
                foreach ($lessons->where('package_status', 'ACTIVE') as $l) {
                    $packages->attachSession((string) $l->package_id, (string) $l->session_id, null, 'SUPER_ADMIN');
                }
            });
            $this->info('  → restored');
        }
        $this->info($apply ? 'Done.' : 'Listed only — run again with --apply to put them back.');

        return self::SUCCESS;
    }

    /** Attended, released from a package, on nothing now, and nobody took it off by hand. */
    private function halfUndone(): Collection
    {
        return DB::table('audit_log as r')
            ->join('sessions as se', DB::raw('se.id::text'), '=', DB::raw("r.after->>'session_id'"))
            ->join('students as s', 's.id', '=', 'se.student_id')
            ->join('lesson_packages as p', DB::raw('p.id::text'), '=', DB::raw('r.entity_id::text'))
            ->where('r.action', 'lesson_package.released')
            ->where('se.status', 'ATTENDED')
            ->whereNull('s.deleted_at')
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('lesson_package_credits as c')->whereColumn('c.session_id', 'se.id'))
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('invoice_line_items as li')->whereColumn('li.session_id', 'se.id'))
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('audit_log as d')
                ->where('d.action', 'lesson_package.lesson_detached')
                ->whereRaw("d.before->>'session_id' = se.id::text"))
            ->orderBy('r.created_at')
            ->get(['se.id as session_id', 'se.scheduled_at_utc', 's.full_name as student_name', 'p.id as package_id', 'p.label', 'p.status as package_status', 'p.minutes_total', 'p.minutes_consumed'])
            ->unique('session_id')
            ->values();
    }

    /** @return array<string, string> id => name */
    private function academies(): array
    {
        TenantContext::apply(userId: self::SYSTEM_USER_ID, academyId: null, role: 'SUPER_ADMIN', local: false);
        try {
            return DB::table('academies')
                ->when($this->option('academy'), fn ($q, $id) => $q->where('id', $id))
                ->where('status', 'ACTIVE')
                ->orderBy('name')
                ->pluck('name', 'id')
                ->mapWithKeys(fn ($n, $id) => [(string) $id => (string) $n])
                ->all();
        } finally {
            TenantContext::clear();
        }
    }
}
