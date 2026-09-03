<?php

declare(strict_types=1);

use App\Jobs\RollSessionWindowJob;
use App\Services\SessionGenerator;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

/**
 * The scheduled roll-forward, exercised END TO END — the job, not just the generator underneath.
 *
 * That gap is the whole reason this file exists. SessionGenerator was thoroughly tested; the job
 * that wraps it never was. So nobody noticed that its audit write passed a synthetic actor id
 * that has no row in `users`, against a column with a foreign key to it. Every run generated its
 * lessons, hit a 23503 on the audit insert, and rolled the whole tenant transaction back. In
 * production that silently cost two months of session generation — one academy had 19 timetables
 * quietly stop producing lessons, and the attendance page was simply empty for those students.
 *
 * Anything that calls the job's handle() against the real schema would have caught it in a
 * second, which is exactly what these tests are.
 */
uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

beforeEach(function () {
    Carbon::setTestNow('2026-05-15 06:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->teacher = $this->createTeacher($this->academy);
    $this->student = $this->createStudent($this->academy);
    $this->schedule = $this->createSchedule($this->academy, $this->student, $this->teacher);
    // Every Friday 17:00 Cairo. 2026-05-15 is itself a Friday, so the window holds several.
    $this->addSlot($this->academy, $this->schedule, 5, '17:00:00', 30);
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

it('creates the lessons its own audit entry claims it created', function () {
    $results = (new RollSessionWindowJob(onlyAcademyId: $this->academy))->handle(app(SessionGenerator::class));

    expect($results[$this->academy]['created'])->toBeGreaterThan(0);

    $this->asAcademy($this->academy);
    $sessions = DB::table('sessions')->where('schedule_id', $this->schedule)->count();
    $audit = DB::table('audit_log')->where('action', 'generator.run')->where('academy_id', $this->academy)->first();

    // The rows must SURVIVE the job. A failed audit insert rolls the tenant transaction back, so
    // a job that reports "created 711" and leaves nothing behind is the exact production bug.
    expect($sessions)->toBe($results[$this->academy]['created']);
    expect($audit)->not->toBeNull();
    // No human ran it: the system sentinel is not a `users` row, so the actor is null.
    expect($audit->actor_user_id)->toBeNull();
});

it('is idempotent — a second run creates nothing and deletes nothing', function () {
    (new RollSessionWindowJob(onlyAcademyId: $this->academy))->handle(app(SessionGenerator::class));
    $second = (new RollSessionWindowJob(onlyAcademyId: $this->academy))->handle(app(SessionGenerator::class));

    expect($second[$this->academy])->toBe(['created' => 0, 'removed' => 0]);
});

it('never invents history: a plain run creates nothing before now', function () {
    (new RollSessionWindowJob(onlyAcademyId: $this->academy))->handle(app(SessionGenerator::class));

    $this->asAcademy($this->academy);
    $past = DB::table('sessions')
        ->where('schedule_id', $this->schedule)
        ->where('scheduled_at_utc', '<', Carbon::now())
        ->count();

    expect($past)->toBe(0);
});

it('back-fills a gap when given an explicit floor', function () {
    // The repair path for a generator that was broken or never ran: the timetable always implied
    // these lessons, so materialise them rather than leaving holes in the attendance board.
    (new RollSessionWindowJob(onlyAcademyId: $this->academy, floor: '2026-05-01'))->handle(app(SessionGenerator::class));

    $this->asAcademy($this->academy);
    $backfilled = DB::table('sessions')
        ->where('schedule_id', $this->schedule)
        ->where('scheduled_at_utc', '<', Carbon::now())
        ->get();

    // Fridays before "now" inside the window: 2026-05-01 and 2026-05-08.
    expect($backfilled)->toHaveCount(2);
    // Back-filled lessons are unmarked, so nothing is billed until a human records an outcome.
    expect($backfilled->pluck('status')->unique()->all())->toBe(['SCHEDULED']);
});

it('does not duplicate a back-filled lesson on a second repair run', function () {
    (new RollSessionWindowJob(onlyAcademyId: $this->academy, floor: '2026-05-01'))->handle(app(SessionGenerator::class));
    (new RollSessionWindowJob(onlyAcademyId: $this->academy, floor: '2026-05-01'))->handle(app(SessionGenerator::class));

    $this->asAcademy($this->academy);
    $dates = DB::table('sessions')->where('schedule_id', $this->schedule)->pluck('occurrence_local_date');

    expect($dates->count())->toBe($dates->unique()->count());
});
