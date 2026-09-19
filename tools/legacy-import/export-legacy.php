<?php

declare(strict_types=1);

/**
 * Legacy exporter — reads one of the OLD (pre-AcademiQ) Laravel academy apps and writes a single
 * JSON file that `php artisan legacy:import` consumes.
 *
 * It runs INSIDE the old app (it boots that app's own Laravel so it uses that app's own .env and
 * database credentials — nothing is ever typed, copied or transported). Upload it next to the old
 * app's `artisan` and run:
 *
 *     php export-legacy.php --source=ehsan --out=/tmp/ehsan.json
 *
 * The old family of apps is not uniform — some have a `timetable`, some don't; some have
 * `courses`, some have `families`. Every table beyond `users` is therefore probed before it is
 * read, and a missing one downgrades the export rather than failing it.
 *
 * WHAT IT DOES NOT DO: it never writes to the old database, and it never reads `users.password`.
 * The old logins are not migrated — the new system mints its own.
 */

// ---------------------------------------------------------------------------- args

$opts = [];
foreach (array_slice($argv, 1) as $arg) {
    if (preg_match('/^--([a-z0-9-]+)(?:=(.*))?$/i', $arg, $m)) {
        $opts[$m[1]] = $m[2] ?? true;
    }
}

$source = isset($opts['source']) && is_string($opts['source']) ? $opts['source'] : basename(getcwd());
$out = isset($opts['out']) && is_string($opts['out']) ? $opts['out'] : getcwd().'/'.$source.'-export.json';
$withLessons = ! isset($opts['no-lessons']);

// ---------------------------------------------------------------------------- boot the old app

$root = getcwd();
if (! is_file($root.'/vendor/autoload.php') || ! is_file($root.'/bootstrap/app.php')) {
    fwrite(STDERR, "Run this from the root of the old Laravel app (the folder holding `artisan`).\n");
    exit(1);
}

require $root.'/vendor/autoload.php';
$app = require $root.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

$warnings = [];
$warn = function (string $code, string $message, array $context = []) use (&$warnings): void {
    $warnings[] = ['code' => $code, 'message' => $message, 'context' => $context];
};

$has = fn (string $table): bool => Schema::hasTable($table);

// ---------------------------------------------------------------------------- people

/** Old `users` is one table for every role; `user_type` splits it. */
$userRows = DB::table('users')
    ->select('id', 'user_name', 'email', 'user_type', 'whatsapp_number', 'hour_price', 'currency', 'timezone', 'created_at')
    ->orderBy('id')
    ->get();

$teachers = [];
$students = [];
$others = [];

foreach ($userRows as $u) {
    $person = [
        'legacy_id' => (int) $u->id,
        'name' => trim((string) $u->user_name),
        'email' => $u->email !== null && $u->email !== '' ? strtolower(trim((string) $u->email)) : null,
        'phone_raw' => $u->whatsapp_number !== null && trim((string) $u->whatsapp_number) !== '' ? trim((string) $u->whatsapp_number) : null,
        'hour_price' => $u->hour_price !== null ? (float) $u->hour_price : null,
        'currency' => $u->currency !== null && $u->currency !== '' ? strtoupper(trim((string) $u->currency)) : null,
        'timezone' => $u->timezone !== null && $u->timezone !== '' ? (string) $u->timezone : null,
        'created_at' => $u->created_at !== null ? (string) $u->created_at : null,
    ];

    match ((string) $u->user_type) {
        'teacher' => $teachers[] = $person,
        'student' => $students[] = $person,
        default => $others[] = $person + ['user_type' => (string) $u->user_type],
    };
}

$knownIds = [];
foreach ($userRows as $u) {
    $knownIds[(int) $u->id] = true;
}

// ---------------------------------------------------------------------------- teacher ↔ student

$assignments = [];

if ($has('teacher_students')) {
    foreach (DB::table('teacher_students')->orderBy('created_at')->orderBy('id')->get() as $r) {
        $sid = (int) $r->student_id;
        $tid = (int) $r->teacher_id;
        if (! isset($knownIds[$sid]) || ! isset($knownIds[$tid])) {
            $warn('assignment_orphan', 'teacher_students row points at a user that no longer exists; skipped.', ['student_id' => $sid, 'teacher_id' => $tid]);

            continue;
        }
        $assignments[] = [
            'student_legacy_id' => $sid,
            'teacher_legacy_id' => $tid,
            'created_at' => $r->created_at !== null ? (string) $r->created_at : null,
        ];
    }
} else {
    $warn('no_teacher_students', 'This app has no `teacher_students` table; assignments will be inferred from the timetable and lessons only.');
}

// ---------------------------------------------------------------------------- the timetable (the appointments)

$schedules = [];

if ($has('timetable')) {
    $today = date('Y-m-d');

    // One old "series" = one recurring appointment the academy set up. Its rows are the already
    // materialised weekly occurrences (start_date == end_date on every row), so the recurring
    // RULE has to be recovered by collapsing them back down to (weekday, time, duration).
    $seriesRows = DB::table('timetable')
        ->selectRaw('series_id, student_id, teacher_id, min(lesson_name) as lesson_name, min(start_date) as first_date, max(start_date) as last_date, count(*) as occurrences')
        ->groupBy('series_id', 'student_id', 'teacher_id')
        ->orderBy('student_id')
        ->get();

    $slotRows = DB::table('timetable')
        ->selectRaw('series_id, day, start_time, end_time, count(*) as occurrences, min(start_date) as first_date, max(start_date) as last_date')
        ->groupBy('series_id', 'day', 'start_time', 'end_time')
        ->get()
        ->groupBy('series_id');

    foreach ($seriesRows as $s) {
        $seriesId = (string) $s->series_id;
        $sid = (int) $s->student_id;
        $tid = (int) $s->teacher_id;

        if (! isset($knownIds[$sid]) || ! isset($knownIds[$tid])) {
            $warn('series_orphan', 'Timetable series points at a user that no longer exists; skipped.', ['series_id' => $seriesId, 'student_id' => $sid, 'teacher_id' => $tid]);

            continue;
        }

        $slots = [];
        foreach ($slotRows->get($seriesId, []) as $slot) {
            $start = substr((string) $slot->start_time, 0, 8);
            $end = substr((string) $slot->end_time, 0, 8);

            // end <= start means the lesson runs through midnight — the old app stored a bare
            // time with no date, so the wrap has to be recovered here rather than guessed later.
            $minutes = (strtotime('1970-01-01 '.$end) - strtotime('1970-01-01 '.$start)) / 60;
            $wrapped = false;
            if ($minutes <= 0) {
                $minutes += 1440;
                $wrapped = true;
            }

            $slots[] = [
                'weekday' => (int) $slot->day,          // 0=Sun … 6=Sat — identical to ours, verified against the real dates
                'start_time' => $start,
                'end_time' => $end,
                'duration_minutes' => (int) $minutes,
                'crosses_midnight' => $wrapped,
                'occurrences' => (int) $slot->occurrences,
                'first_date' => (string) $slot->first_date,
                'last_date' => (string) $slot->last_date,
            ];
        }

        usort($slots, fn ($a, $b) => [$a['weekday'], $a['start_time']] <=> [$b['weekday'], $b['start_time']]);

        $schedules[] = [
            'series_id' => $seriesId,
            'student_legacy_id' => $sid,
            'teacher_legacy_id' => $tid,
            'lesson_name' => $s->lesson_name !== null && trim((string) $s->lesson_name) !== '' ? trim((string) $s->lesson_name) : null,
            'first_date' => (string) $s->first_date,
            'last_date' => (string) $s->last_date,
            'occurrences' => (int) $s->occurrences,
            'is_live' => (string) $s->last_date >= $today,   // a series that ran out is history, not an appointment
            'slots' => $slots,
        ];
    }
} else {
    $warn('no_timetable', 'This app has no `timetable` table — there are no recurring appointments to export.');
}

// ---------------------------------------------------------------------------- lesson history (archive only)

$lessons = [];

if ($withLessons && $has('lessons')) {
    $courseNames = $has('courses')
        ? DB::table('courses')->pluck('course_name', 'id')->all()
        : [];

    foreach (DB::table('lessons')->orderBy('lesson_date')->orderBy('id')->get() as $l) {
        $sid = (int) $l->student_id;
        $tid = (int) $l->teacher_id;
        if (! isset($knownIds[$sid]) || ! isset($knownIds[$tid])) {
            $warn('lesson_orphan', 'Lesson points at a user that no longer exists; skipped.', ['lesson_id' => (int) $l->id, 'student_id' => $sid, 'teacher_id' => $tid]);

            continue;
        }

        $lessons[] = [
            'legacy_id' => (int) $l->id,
            'student_legacy_id' => $sid,
            'teacher_legacy_id' => $tid,
            'date' => substr((string) $l->lesson_date, 0, 10),   // the old app stored a date with no time
            'hours' => (float) $l->lesson_duration,
            'name' => isset($l->lesson_name) && trim((string) $l->lesson_name) !== '' ? trim((string) $l->lesson_name) : null,
            'course_name' => isset($l->course_id) ? ($courseNames[$l->course_id] ?? null) : null,
        ];
    }
}

// ---------------------------------------------------------------------------- when each student first appeared

$firstActivity = [];

if ($has('lessons')) {
    foreach (DB::table('lessons')->selectRaw('student_id, min(date(lesson_date)) as d')->groupBy('student_id')->get() as $r) {
        $firstActivity[(int) $r->student_id] = (string) $r->d;
    }
}
if ($has('timetable')) {
    foreach (DB::table('timetable')->selectRaw('student_id, min(start_date) as d')->groupBy('student_id')->get() as $r) {
        $sid = (int) $r->student_id;
        $d = (string) $r->d;
        if (! isset($firstActivity[$sid]) || $d < $firstActivity[$sid]) {
            $firstActivity[$sid] = $d;
        }
    }
}
foreach ($students as &$student) {
    // A date before the app existed is corrupt input (the old table holds a stray year 0206),
    // not a real enrolment; the importer falls back to the subscription start it is given.
    $d = $firstActivity[$student['legacy_id']] ?? null;
    $student['first_activity_date'] = ($d !== null && $d >= '2000-01-01' && $d <= date('Y-m-d')) ? $d : null;
}
unset($student);

// ---------------------------------------------------------------------------- write

$payload = [
    'format' => 'academiq.legacy-export/1',
    'source' => $source,
    'exported_at' => date('c'),
    'app' => [
        'name' => (string) config('app.name'),
        'url' => (string) config('app.url'),
        'database' => (string) DB::connection()->getDatabaseName(),
    ],
    'counts' => [
        'teachers' => count($teachers),
        'students' => count($students),
        'other_users' => count($others),
        'assignments' => count($assignments),
        'schedules' => count($schedules),
        'schedules_live' => count(array_filter($schedules, fn ($s) => $s['is_live'])),
        'lessons' => count($lessons),
    ],
    'teachers' => $teachers,
    'students' => $students,
    'other_users' => $others,
    'assignments' => $assignments,
    'schedules' => $schedules,
    'lessons' => $lessons,      // archive: the importer records the count and does not write them
    'warnings' => $warnings,
];

$json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
if ($json === false) {
    fwrite(STDERR, 'Could not encode the export: '.json_last_error_msg()."\n");
    exit(1);
}

if (file_put_contents($out, $json) === false) {
    fwrite(STDERR, "Could not write {$out}\n");
    exit(1);
}

printf("Wrote %s (%s)\n", $out, number_format(strlen($json) / 1024, 1).' KB');
foreach ($payload['counts'] as $k => $v) {
    printf("  %-16s %d\n", $k, $v);
}
if ($warnings !== []) {
    printf("  %-16s %d (see `warnings` in the file)\n", 'warnings', count($warnings));
}
