<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\SessionGenerator;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\DryRunComplete;
use App\Support\StudentStatus;
use App\Support\Tenancy;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Move a client off the previous (pre-AcademiQ) Laravel app and into an academy here.
 *
 * The old app is one `users` table split by `user_type`, a `teacher_students` join, and a
 * `timetable` whose rows are weekly occurrences that were materialised years ahead. This command
 * reads the JSON that `tools/legacy-import/export-legacy.php` writes on the old server and lands
 * three things in an academy that already exists:
 *
 *   people        — teachers, and students under guardians
 *   the price     — each student's old hourly rate as a PER_HOUR subscription
 *   appointments  — each live timetable series collapsed back into the weekly RULE it came from
 *
 * Four decisions are baked in, and each is a deliberate answer to something the old schema cannot
 * express:
 *
 *  1. THE TIMETABLE IS A RULE AGAIN. The old app pre-generated every occurrence to 2033; we store
 *     a weekly rule and let the generator roll a window forward. So the rows are collapsed to
 *     (weekday, start time, duration) and re-expanded here. A series that already ran out is
 *     history, not an appointment, and is not imported.
 *
 *  2. NOTHING IS BACK-DATED. Imported timetables start on the import date (`--schedule-start`),
 *     never on the series' original first date. The generator honours a start date in the past by
 *     back-filling lessons, so an original start would invent months of lessons nobody taught —
 *     markable, billable, and wrong. Past lessons live in the old system's archive; the export
 *     carries them, this command deliberately does not write them.
 *
 *  3. A SHARED PHONE IS A FAMILY. The old app has no payer: it bills a student directly. Here a
 *     guardian owns the money and may own several students. Students sharing a WhatsApp number
 *     are therefore landed under ONE guardian — which is what siblings on one parent's phone
 *     actually are, and much cheaper to get right now than to split up later.
 *
 *  4. IT IS RE-RUNNABLE. Every row created is recorded in `legacy_import_map`, so a second run
 *     updates what it made the first time instead of creating a second copy of everybody. It
 *     never touches a row a human has since edited by hand beyond re-aligning names and phones.
 *
 *     `--sync` goes further, for a client that kept teaching on the old app after the first run:
 *     the old app is still the truth, so existing rows are brought in line with it — a changed
 *     price, a changed teacher, a moved family, a timetable that gained, lost or moved a slot, a
 *     series that ended. It refuses an academy that already marks lessons or bills here, because
 *     by then the new system is the truth and overwriting it would undo real work.
 *
 * Examples:
 *
 *     php artisan legacy:import storage/app/ehsan.json --academy=<uuid> --dry-run
 *     php artisan legacy:import storage/app/ehsan.json --academy=<uuid>
 */
final class LegacyImport extends Command
{
    protected $signature = 'legacy:import
        {file : JSON written by tools/legacy-import/export-legacy.php}
        {--academy= : Target academy id — it must already exist}
        {--source= : Override the source name recorded in legacy_import_map (default: the export\'s own)}
        {--timezone= : Timezone the old wall-clock times are in (default: the academy timezone)}
        {--schedule-start= : Local date imported timetables start producing lessons (default: today)}
        {--fallback-phone= : ONE guardian phone shared by every student who has none (default: skip them)}
        {--placeholder-phones : Give each contactless student their own unroutable +999 placeholder instead}
        {--max-duration=240 : A slot longer than this many minutes is corrupt; fall back to 60}
        {--teacher-rate=0 : Session rate for every imported teacher, in major units}
        {--teacher-currency= : Currency for teacher rates (default: the academy default)}
        {--no-generate : Skip the session generator afterwards}
        {--sync : Also bring EXISTING rows in line with the old app: prices, teachers, families, timetables}
        {--dry-run : Do the whole import against the real database, report, then roll it back}';

    protected $description = 'Import students, teachers and recurring appointments from a legacy academy app.';

    /** Not a `users` row — Audit maps it to a null actor rather than breaking the FK. */
    private const SYSTEM_ACTOR = Audit::SYSTEM_ACTOR_ID;

    /** How many real examples of a repeated note to print before summarising the rest. */
    private const NOTE_EXAMPLES = 5;

    /** The label the first run gives the old hourly rate — how --sync tells its own subscription apart. */
    private const IMPORTED_PLAN_LABEL = 'Imported hourly rate / سعر الساعة المستورد';

    /** @var list<array{code:string,detail:string}> */
    private array $notes = [];

    /** @var array<string,int> */
    private array $counts = [];

    public function handle(SessionGenerator $generator): int
    {
        $path = (string) $this->argument('file');
        if (! is_file($path)) {
            $this->error("No such file: {$path}");

            return self::FAILURE;
        }

        $payload = json_decode((string) file_get_contents($path), true);
        if (! is_array($payload) || ($payload['format'] ?? null) !== 'academiq.legacy-export/1') {
            $this->error('That file is not an academiq.legacy-export/1 export.');

            return self::FAILURE;
        }

        $academyId = (string) $this->option('academy');
        if (! Str::isUuid($academyId)) {
            $this->error('Pass the target academy: --academy=<uuid>. It must already exist.');

            return self::FAILURE;
        }

        $dryRun = (bool) $this->option('dry-run');
        $ctx = new AuthContext(self::SYSTEM_ACTOR, $academyId, 'SUPER_ADMIN', []);

        try {
            Tenancy::withContext($ctx, function () use ($payload, $academyId, $generator, $dryRun): void {
                $this->import($payload, $academyId, $generator);

                if ($dryRun) {
                    // Everything above really ran — every FK, CHECK and unique index has had its
                    // say — and is now thrown away. A dry run that skipped the writes would only
                    // prove that the plan parses, which is the part that was never in doubt.
                    throw new DryRunComplete;
                }
            });
        } catch (DryRunComplete) {
            $this->report(rolledBack: true);

            return self::SUCCESS;
        }

        $this->report(rolledBack: false);

        return self::SUCCESS;
    }

    /** @param array<string,mixed> $payload */
    private function import(array $payload, string $academyId, SessionGenerator $generator): void
    {
        $academy = DB::table('academies')->where('id', $academyId)->first();
        if ($academy === null) {
            throw new RuntimeException("Academy {$academyId} does not exist. Create the client in Super Admin first.");
        }

        $source = (string) ($this->option('source') ?: ($payload['source'] ?? 'legacy'));
        $timezone = (string) ($this->option('timezone') ?: $academy->timezone);
        $defaultCurrency = strtoupper((string) $academy->default_currency);
        $scheduleStart = $this->option('schedule-start')
            ? Carbon::parse((string) $this->option('schedule-start'))->toDateString()
            : Carbon::now($timezone)->toDateString();

        $this->line(sprintf(
            '<info>%s</info> → <info>%s</info>  (tz %s, default currency %s, timetables start %s)',
            $source, $academy->name, $timezone, $defaultCurrency, $scheduleStart
        ));

        $preexisting = DB::table('students')->where('academy_id', $academyId)->whereNull('deleted_at')->count()
            - DB::table('legacy_import_map')->where('academy_id', $academyId)->where('entity', 'student')->count();
        if ($preexisting > 0) {
            $this->note('academy_not_empty', "{$preexisting} student(s) already in this academy did not come from this import — check you are pointing at the right client.");
        }

        if ($this->option('sync')) {
            $marked = DB::table('sessions')->where('academy_id', $academyId)->where('status', '<>', 'SCHEDULED')->count();
            $invoices = DB::table('invoices')->where('academy_id', $academyId)->count();
            if ($marked > 0 || $invoices > 0) {
                throw new RuntimeException("--sync refused: this academy already works here ({$marked} marked lesson(s), {$invoices} invoice(s)). The new system is the truth now; re-run without --sync to only add what is new.");
            }
        }

        $teacherIds = $this->importTeachers($payload, $academyId, $source, $defaultCurrency);
        [$studentIds, $guardianIds] = $this->importPeople($payload, $academyId, $source, $defaultCurrency, $scheduleStart);
        $liveByStudent = $this->liveSchedulesByStudent($payload);
        $this->importAssignments($payload, $academyId, $studentIds, $teacherIds, $liveByStudent);
        if ($this->option('sync')) {
            $this->syncSchedules($academyId, $source, $timezone, $scheduleStart, $studentIds, $teacherIds, $liveByStudent);
        } else {
            $this->importSchedules($academyId, $source, $timezone, $scheduleStart, $studentIds, $teacherIds, $liveByStudent);
        }
        $this->reportMissing($payload, $academyId, $source);

        $this->counts['guardians'] = count($guardianIds);
        $this->counts['lessons_in_file_not_imported'] = count($payload['lessons'] ?? []);

        Audit::log('legacy.import', 'academy', $academyId, $academyId, self::SYSTEM_ACTOR, 'SUPER_ADMIN', after: [
            'source' => $source,
            'counts' => $this->counts,
            'schedule_start' => $scheduleStart,
            'notes' => count($this->notes),
        ]);

        if (! $this->option('no-generate')) {
            [$from, $to] = SessionGenerator::defaultWindow();
            $result = $generator->generateForAcademy($academyId, $from, $to);
            // The academy pass only reads ACTIVE timetables, so one that just ended would keep its
            // future lessons. Reconciling it on its own clears them (inactive → nothing intended).
            foreach ($this->endedSchedules as $scheduleId) {
                $r = $generator->generateForSchedule($scheduleId, $from, $to);
                $result['removed'] += $r['removed'];
            }
            $this->counts['sessions_generated'] = $result['created'];
            $this->counts['sessions_removed'] = $result['removed'];
        }
    }

    // ------------------------------------------------------------------ teachers

    /**
     * @param  array<string,mixed>  $payload
     * @return array<int,string> legacy teacher id → teacher uuid
     */
    private function importTeachers(array $payload, string $academyId, string $source, string $defaultCurrency): array
    {
        $rate = (int) round(((float) $this->option('teacher-rate')) * 100);
        $currency = strtoupper((string) ($this->option('teacher-currency') ?: $defaultCurrency));
        $map = [];
        $created = 0;
        $updated = 0;
        $rateless = 0;

        foreach ($payload['teachers'] ?? [] as $t) {
            $legacyId = (int) $t['legacy_id'];
            $phone = $this->phone($t['phone_raw'] ?? null, "teacher {$t['name']}");
            $existing = $this->mapped($academyId, $source, 'teacher', (string) $legacyId);

            if ($existing !== null) {
                DB::table('teachers')->where('id', $existing)->update([
                    'full_name' => $t['name'],
                    'phone' => $phone,
                    'updated_at' => now(),
                ]);
                $map[$legacyId] = $existing;
                $updated++;

                continue;
            }

            $id = (string) Str::uuid();
            DB::table('teachers')->insert([
                'id' => $id,
                'academy_id' => $academyId,
                'user_id' => null,       // the old logins are not migrated; the new system mints its own
                'full_name' => $t['name'],
                'phone' => $phone,
                'specialization' => null,
                'session_rate_minor' => $rate,
                'currency' => $currency,
                'timezone' => $t['timezone'] ?? null,
                'is_active' => true,
            ]);
            $this->remember($academyId, $source, 'teacher', (string) $legacyId, $id);
            Audit::log('teacher.create', 'teacher', $id, $academyId, self::SYSTEM_ACTOR, 'SUPER_ADMIN', after: [
                'full_name' => $t['name'],
                'session_rate_minor' => $rate,
                'currency' => $currency,
                'imported_from' => $source.'#'.$legacyId,
            ]);

            $map[$legacyId] = $id;
            $created++;
            if ($rate === 0) {
                $rateless++;
            }
        }

        $this->counts['teachers_created'] = $created;
        $this->counts['teachers_updated'] = $updated;
        if ($rateless > 0) {
            $this->note('teacher_rate_zero', "{$rateless} teacher(s) landed on a rate of 0 — the old system never stored one. Set their rates before the first payroll run.");
        }

        return $map;
    }

    // ------------------------------------------------------------------ guardians + students

    /**
     * Students sharing a WhatsApp number become siblings under one guardian (decision 3).
     *
     * @param  array<string,mixed>  $payload
     * @return array{0: array<int,string>, 1: array<string,string>} [legacy student id → uuid, guardian key → uuid]
     */
    private function importPeople(array $payload, string $academyId, string $source, string $defaultCurrency, string $scheduleStart): array
    {
        $fallback = $this->option('fallback-phone')
            ? $this->phone((string) $this->option('fallback-phone'), 'fallback-phone')
            : null;
        $placeholders = (bool) $this->option('placeholder-phones');

        if ($placeholders && $fallback !== null) {
            // One is "send everyone's invoices to this number", the other is "send nobody's
            // anywhere". Silently picking one would be a guess about who gets a parent's bill.
            throw new RuntimeException('Pass either --fallback-phone or --placeholder-phones, not both.');
        }

        $minted = 0;

        // Some of the old apps grew a real `families` table — a named household with its own
        // WhatsApp number. That is an answer the client wrote down, so it beats inferring a family
        // from a shared number, and two households that happen to share a phone stay separate.
        $declared = [];
        foreach ($payload['families'] ?? [] as $f) {
            $declared[(int) $f['legacy_id']] = $f;
        }

        /** @var array<string, array{name:?string, phone:string, explicit:bool, members:list<array<string,mixed>>}> $groups */
        $groups = [];
        $skipped = 0;
        $fromFamily = 0;

        foreach ($payload['students'] ?? [] as $s) {
            $own = $this->phone($s['phone_raw'] ?? null, "student {$s['name']}");
            $familyId = $s['family_legacy_id'] ?? null;
            $family = $familyId !== null ? ($declared[(int) $familyId] ?? null) : null;

            if ($family !== null) {
                // A household with no number of its own is still a household; bill it on the
                // number of the student who is in it.
                $phone = $this->phone($family['phone_raw'] ?? null, "family {$family['name']}") ?? $own ?? $fallback;
                if ($phone === null && $placeholders) {
                    $phone = $this->placeholderPhone($source, 'family', (int) $familyId);
                    $minted++;
                }
                $key = 'family:'.(int) $familyId;
                $name = (string) $family['name'];
                $explicit = true;
            } else {
                $phone = $own ?? $fallback;
                if ($phone === null && $placeholders) {
                    // Their OWN placeholder, never a shared one: a synthetic number that two
                    // students had in common would file them as siblings and put one family's
                    // invoice in front of another.
                    $phone = $this->placeholderPhone($source, 'student', (int) $s['legacy_id']);
                    $minted++;
                }
                $key = $phone !== null ? 'phone:'.$phone : null;
                $name = null;
                $explicit = false;
            }

            if ($phone === null || $key === null) {
                // A guardian must be reachable — `guardians.whatsapp_phone` is NOT NULL and E.164
                // checked, because it is where every report and invoice is sent. Inventing a
                // number to get the row in would be worse than leaving the student out.
                $this->note('student_no_phone', "Skipped \"{$s['name']}\" (legacy #{$s['legacy_id']}): no usable WhatsApp number. Re-run with --fallback-phone=+… to include them.");
                $skipped++;

                continue;
            }

            if (! isset($groups[$key])) {
                $groups[$key] = ['name' => $name, 'phone' => $phone, 'explicit' => $explicit, 'members' => []];
                if ($explicit) {
                    $fromFamily++;
                }
            }
            $groups[$key]['members'][] = $s;
        }

        $studentIds = [];
        $guardianIds = [];
        $studentsCreated = 0;
        $studentsUpdated = 0;
        $subscriptions = 0;
        $siblingGroups = 0;

        foreach ($groups as $guardianKey => $group) {
            $members = $group['members'];
            $phone = $group['phone'];
            usort($members, fn ($a, $b) => $a['legacy_id'] <=> $b['legacy_id']);
            if (count($members) > 1 && ! $group['explicit']) {
                $siblingGroups++;
            }

            $guardianCurrency = $this->commonCurrency($members) ?? $defaultCurrency;
            $guardianId = $this->mapped($academyId, $source, 'guardian', $guardianKey);

            if ($guardianId === null) {
                $guardianId = (string) Str::uuid();
                DB::table('guardians')->insert([
                    'id' => $guardianId,
                    'academy_id' => $academyId,
                    // The household's own name where the old app recorded one; otherwise the
                    // eldest record on the number, rather than an invented family name.
                    'full_name' => $group['name'] ?? $members[0]['name'],
                    'whatsapp_phone' => $phone,
                    'currency' => $guardianCurrency,
                ]);
                $this->remember($academyId, $source, 'guardian', $guardianKey, $guardianId);
            }
            $guardianIds[$guardianKey] = $guardianId;

            foreach ($members as $s) {
                $legacyId = (int) $s['legacy_id'];
                $existing = $this->mapped($academyId, $source, 'student', (string) $legacyId);

                if ($existing !== null) {
                    $update = [
                        'full_name' => $s['name'],
                        'whatsapp_phone' => $phone,
                        'updated_at' => now(),
                    ];
                    if ($this->option('sync')) {
                        // A changed number is a different household here: move the student to
                        // the guardian the number now belongs to, rather than leaving them
                        // billed to the parent whose phone they no longer share.
                        $was = DB::table('students')->where('id', $existing)->value('guardian_id');
                        if ((string) $was !== $guardianId) {
                            $update['guardian_id'] = $guardianId;
                            $update['is_self_guardian'] = count($members) === 1 && ! $group['explicit'];
                            $this->counts['students_moved_guardian'] = ($this->counts['students_moved_guardian'] ?? 0) + 1;
                        }
                        $this->syncPrice($academyId, $existing, $s, $guardianCurrency, $scheduleStart);
                    }
                    DB::table('students')->where('id', $existing)->update($update);
                    $studentIds[$legacyId] = $existing;
                    $studentsUpdated++;

                    continue;
                }

                $studentId = (string) Str::uuid();
                DB::table('students')->insert([
                    'id' => $studentId,
                    'academy_id' => $academyId,
                    'guardian_id' => $guardianId,
                    'full_name' => $s['name'],
                    'whatsapp_phone' => $phone,
                    'status' => StudentStatus::REGULAR,
                    'is_self_guardian' => count($members) === 1 && ! $group['explicit'],
                    'notes' => 'Imported from '.$source.' #'.$legacyId
                        .($s['student_type'] ?? null ? ' · '.$s['student_type'] : '')
                        .(str_starts_with($phone, '+999') ? ' · NO CONTACT NUMBER ON FILE' : ''),
                ]);
                $this->remember($academyId, $source, 'student', (string) $legacyId, $studentId);
                Audit::log('student.create', 'student', $studentId, $academyId, self::SYSTEM_ACTOR, 'SUPER_ADMIN', after: [
                    'full_name' => $s['name'],
                    'guardian_id' => $guardianId,
                    'imported_from' => $source.'#'.$legacyId,
                ]);

                // The old hourly rate maps exactly onto PER_HOUR: both charge the rate pro-rated
                // to the lesson's real length, so a 90-minute lesson costs 1.5× a 60-minute one.
                $hourly = $s['hour_price'] ?? null;
                if ($hourly !== null) {
                    DB::table('subscriptions')->insert([
                        'id' => (string) Str::uuid(),
                        'academy_id' => $academyId,
                        'student_id' => $studentId,
                        'plan_label' => self::IMPORTED_PLAN_LABEL,
                        'price_minor' => (int) round(((float) $hourly) * 100),
                        'currency' => $this->currencyOf($s) ?? $guardianCurrency,
                        'price_basis' => 'PER_HOUR',
                        'status' => 'ACTIVE',
                        'start_date' => $s['first_activity_date'] ?? $scheduleStart,
                    ]);
                    $subscriptions++;
                }

                $studentIds[$legacyId] = $studentId;
                $studentsCreated++;
            }
        }

        if ($this->option('sync')) {
            // A guardian everyone moved away from would sit in the parents list with nobody to
            // bill. Only the importer's own, and only while nothing hangs off them.
            $emptied = DB::table('guardians as g')
                ->join('legacy_import_map as m', function ($j) use ($academyId, $source) {
                    $j->on('m.target_id', '=', 'g.id')
                        ->where('m.academy_id', $academyId)->where('m.source', $source)->where('m.entity', 'guardian');
                })
                ->whereNull('g.deleted_at')
                ->whereNotExists(fn ($q) => $q->select(DB::raw(1))->from('students as s')->whereColumn('s.guardian_id', 'g.id')->whereNull('s.deleted_at'))
                ->pluck('g.id');
            if ($emptied->isNotEmpty()) {
                DB::table('guardians')->whereIn('id', $emptied)->update(['deleted_at' => now(), 'updated_at' => now()]);
                $this->counts['guardians_emptied_removed'] = $emptied->count();
            }
        }

        $this->counts['students_created'] = $studentsCreated;
        $this->counts['students_updated'] = $studentsUpdated;
        $this->counts['students_skipped'] = $skipped;
        $this->counts['subscriptions_created'] = $subscriptions;
        $this->counts['guardians_from_family_table'] = $fromFamily;
        $this->counts['placeholder_numbers_minted'] = $minted;
        if ($minted > 0) {
            $this->note('placeholder_phones', "{$minted} guardian(s) have a placeholder number on +999 because the old system held no real one. Nothing can be sent to them — WhatsApp reports and invoice links will fail until a real number is entered. They are tagged 'NO CONTACT NUMBER ON FILE' in the student's notes.");
        }
        if ($siblingGroups > 0) {
            $this->note('siblings_grouped', "{$siblingGroups} WhatsApp number(s) were shared by more than one student; each became one guardian with several students.");
        }

        return [$studentIds, $guardianIds];
    }

    // ------------------------------------------------------------------ teacher assignments

    /**
     * One student may have had several teachers over the years, but exactly one may be active
     * here (a partial unique index enforces it). The live timetable is the better evidence of who
     * teaches them TODAY than the join table, which only ever gained rows and never lost them.
     *
     * @param  array<string,mixed>  $payload
     * @param  array<int,string>  $studentIds
     * @param  array<int,string>  $teacherIds
     * @param  array<int, array<int,int>>  $liveByStudent  legacy student id → [legacy teacher id → slot count]
     */
    private function importAssignments(array $payload, string $academyId, array $studentIds, array $teacherIds, array $liveByStudent): void
    {
        /** @var array<int, list<array{teacher:int, at:?string}>> $history */
        $history = [];
        foreach ($payload['assignments'] ?? [] as $a) {
            $history[(int) $a['student_legacy_id']][] = [
                'teacher' => (int) $a['teacher_legacy_id'],
                'at' => $a['created_at'] ?? null,
            ];
        }

        $opened = 0;
        $closed = 0;
        $skipped = 0;
        $split = 0;

        foreach ($studentIds as $legacyStudentId => $studentId) {
            // Never re-write an assignment: a second run must not close the teacher an owner has
            // since chosen by hand and re-open the one the old system happened to remember.
            $already = DB::table('student_teacher_assignments')->where('student_id', $studentId)->exists();
            if ($already && $this->option('sync')) {
                [$o, $c] = $this->syncAssignments($academyId, $studentId, $liveByStudent[$legacyStudentId] ?? [], $teacherIds);
                $opened += $o;
                $closed += $c;
                if (count($liveByStudent[$legacyStudentId] ?? []) > 1) {
                    $split++;
                }

                continue;
            }
            if ($already) {
                $skipped++;

                continue;
            }

            $live = $liveByStudent[$legacyStudentId] ?? [];
            if (count($live) > 1) {
                $split++;
            }

            // Today's teacher: whoever owns the most live timetable slots, else the most recent
            // row in the old join table.
            $activeLegacy = null;
            if ($live !== []) {
                arsort($live);
                $activeLegacy = (int) array_key_first($live);
            } else {
                $rows = $history[$legacyStudentId] ?? [];
                usort($rows, fn ($a, $b) => (string) $a['at'] <=> (string) $b['at']);
                $last = $rows === [] ? null : $rows[count($rows) - 1];
                $activeLegacy = $last === null ? null : (int) $last['teacher'];
            }

            if ($activeLegacy === null || ! isset($teacherIds[$activeLegacy])) {
                continue;
            }

            // Everyone else the student was ever with becomes a closed assignment, so the history
            // page is not blank for a student who has been here two years.
            $past = [];
            foreach ($history[$legacyStudentId] ?? [] as $row) {
                if ($row['teacher'] !== $activeLegacy && isset($teacherIds[$row['teacher']])) {
                    $past[] = $row;
                }
            }
            usort($past, fn ($a, $b) => (string) $a['at'] <=> (string) $b['at']);

            foreach ($past as $i => $row) {
                $startedAt = $row['at'] !== null ? Carbon::parse($row['at']) : now();
                $endedAt = isset($past[$i + 1]) && $past[$i + 1]['at'] !== null
                    ? Carbon::parse($past[$i + 1]['at'])
                    : now();
                DB::table('student_teacher_assignments')->insert([
                    'id' => (string) Str::uuid(),
                    'academy_id' => $academyId,
                    'student_id' => $studentId,
                    'teacher_id' => $teacherIds[$row['teacher']],
                    'started_at' => $startedAt,
                    'ended_at' => $endedAt->lessThan($startedAt) ? $startedAt : $endedAt,
                ]);
                $closed++;
            }

            $activeStart = null;
            foreach ($history[$legacyStudentId] ?? [] as $row) {
                if ($row['teacher'] === $activeLegacy && $row['at'] !== null) {
                    $activeStart = Carbon::parse($row['at']);
                    break;
                }
            }

            DB::table('student_teacher_assignments')->insert([
                'id' => (string) Str::uuid(),
                'academy_id' => $academyId,
                'student_id' => $studentId,
                'teacher_id' => $teacherIds[$activeLegacy],
                'started_at' => $activeStart ?? now(),
                'ended_at' => null,
            ]);
            $opened++;
        }

        $this->counts['assignments_active'] = $opened;
        $this->counts['assignments_historical'] = $closed;
        $this->counts['assignments_left_alone'] = $skipped;
        if ($split > 0 && $this->option('sync')) {
            $this->note('two_teachers_one_student', "{$split} student(s) are taught by more than one teacher in the old timetable; each teacher got their own timetable for their own slots.");
        } elseif ($split > 0) {
            $this->note('two_teachers_one_student', "{$split} student(s) are taught by more than one teacher in the old timetable. Here a student has one teacher, so every lesson went to whichever teacher holds more of their slots — check those students and move the odd lesson by hand.");
        }
    }

    // ------------------------------------------------------------------ schedules

    /**
     * Collapse the old pre-materialised occurrences back into the weekly rule they came from.
     *
     * @param  array<int,string>  $studentIds
     * @param  array<int,string>  $teacherIds
     * @param  array<int, array<int,int>>  $liveByStudent
     */
    private function importSchedules(
        string $academyId,
        string $source,
        string $timezone,
        string $scheduleStart,
        array $studentIds,
        array $teacherIds,
        array $liveByStudent,
    ): void {
        $created = 0;
        $updated = 0;
        $slotsWritten = 0;

        foreach ($this->slotsByStudent as $legacyStudentId => $slots) {
            if (! isset($studentIds[$legacyStudentId])) {
                continue;   // student was skipped (no phone)
            }
            $studentId = $studentIds[$legacyStudentId];

            $live = $liveByStudent[$legacyStudentId] ?? [];
            arsort($live);
            $teacherLegacy = $live === [] ? null : (int) array_key_first($live);
            if ($teacherLegacy === null || ! isset($teacherIds[$teacherLegacy])) {
                continue;
            }

            $key = 'student:'.$legacyStudentId;
            $scheduleId = $this->mapped($academyId, $source, 'schedule', $key);

            if ($scheduleId === null) {
                // A student may already have a schedule made by hand here; adopt it rather than
                // creating a second active one (only one active schedule per student is read).
                $adopted = DB::table('schedules')
                    ->where('student_id', $studentId)->where('is_active', true)->whereNull('deleted_at')
                    ->value('id');
                $scheduleId = $adopted !== null ? (string) $adopted : null;
            }

            if ($scheduleId === null) {
                $scheduleId = (string) Str::uuid();
                DB::table('schedules')->insert([
                    'id' => $scheduleId,
                    'academy_id' => $academyId,
                    'student_id' => $studentId,
                    'teacher_id' => $teacherIds[$teacherLegacy],
                    'timezone' => $timezone,
                    // Decision 2: today, never the series' own first date.
                    'start_date' => $scheduleStart,
                    'is_active' => true,
                    'version' => 1,
                ]);
                $created++;
            } else {
                DB::table('schedules')->where('id', $scheduleId)->update([
                    'teacher_id' => $teacherIds[$teacherLegacy],
                    'timezone' => $timezone,
                    'is_active' => true,
                    'deleted_at' => null,
                    'version' => DB::raw('version + 1'),
                    'updated_at' => now(),
                ]);
                $updated++;
            }
            $this->remember($academyId, $source, 'schedule', $key, $scheduleId);

            foreach ($slots as $slot) {
                // `unique (schedule_id, weekday, start_time_local)` makes this the natural key;
                // an existing slot has its length re-aligned rather than being duplicated.
                $existing = DB::table('schedule_slots')
                    ->where('schedule_id', $scheduleId)
                    ->where('weekday', $slot['weekday'])
                    ->where('start_time_local', $slot['start_time'])
                    ->value('id');

                if ($existing !== null) {
                    DB::table('schedule_slots')->where('id', $existing)->update([
                        'duration_minutes' => $slot['duration_minutes'],
                        'updated_at' => now(),
                    ]);
                } else {
                    DB::table('schedule_slots')->insert([
                        'id' => (string) Str::uuid(),
                        'academy_id' => $academyId,
                        'schedule_id' => $scheduleId,
                        'weekday' => $slot['weekday'],
                        'start_time_local' => $slot['start_time'],
                        'duration_minutes' => $slot['duration_minutes'],
                    ]);
                }
                $slotsWritten++;
            }
        }

        $this->counts['timetables_created'] = $created;
        $this->counts['timetables_updated'] = $updated;
        $this->counts['timetable_slots'] = $slotsWritten;
    }

    // ------------------------------------------------------------------ --sync

    /** @var list<string> timetables --sync switched off, whose future lessons still need clearing */
    private array $endedSchedules = [];

    /**
     * Make the timetables match the old app exactly: one per (student, teacher), holding exactly
     * that teacher's live slots. Slots the old app dropped are removed, and a student whose series
     * all ended has their timetable switched off — the two things a plain re-run never does.
     *
     * The student's main teacher keeps the original `student:<id>` key, so the timetable made by
     * the first run is the one that carries on. Each further teacher gets `student:<id>|teacher:<id>`.
     *
     * @param  array<int,string>  $studentIds
     * @param  array<int,string>  $teacherIds
     * @param  array<int, array<int,int>>  $liveByStudent
     */
    private function syncSchedules(
        string $academyId,
        string $source,
        string $timezone,
        string $scheduleStart,
        array $studentIds,
        array $teacherIds,
        array $liveByStudent,
    ): void {
        $created = 0;
        $updated = 0;
        $slotsWritten = 0;
        $slotsRemoved = 0;
        $wanted = [];

        foreach ($this->slotsByStudent as $legacyStudentId => $slots) {
            if (! isset($studentIds[$legacyStudentId])) {
                continue;   // student was skipped (no phone)
            }
            $studentId = $studentIds[$legacyStudentId];

            $live = $liveByStudent[$legacyStudentId] ?? [];
            arsort($live);
            $main = null;
            foreach (array_keys($live) as $t) {
                if (isset($teacherIds[(int) $t])) {
                    $main = (int) $t;
                    break;
                }
            }
            if ($main === null) {
                continue;
            }

            $byTeacher = [];
            foreach ($slots as $slot) {
                // A slot whose teacher did not come across stays with the student's main teacher
                // rather than being dropped — a lesson under the wrong name beats a lost lesson.
                $t = isset($teacherIds[$slot['teacher']]) ? $slot['teacher'] : $main;
                $byTeacher[$t][] = $slot;
            }

            foreach ($byTeacher as $teacherLegacy => $teacherSlots) {
                $key = $teacherLegacy === $main
                    ? 'student:'.$legacyStudentId
                    : 'student:'.$legacyStudentId.'|teacher:'.$teacherLegacy;
                $teacherId = $teacherIds[$teacherLegacy];
                $scheduleId = $this->mapped($academyId, $source, 'schedule', $key);

                if ($scheduleId === null) {
                    // Adopt this teacher's timetable for the student if one was made by hand,
                    // but never one this import already files under another key.
                    $adopted = DB::table('schedules')
                        ->where('student_id', $studentId)->where('teacher_id', $teacherId)
                        ->where('is_active', true)->whereNull('deleted_at')
                        ->whereNotIn('id', DB::table('legacy_import_map')
                            ->where('academy_id', $academyId)->where('source', $source)->where('entity', 'schedule')
                            ->select('target_id'))
                        ->value('id');
                    $scheduleId = $adopted !== null ? (string) $adopted : null;
                }

                if ($scheduleId === null) {
                    $scheduleId = (string) Str::uuid();
                    DB::table('schedules')->insert([
                        'id' => $scheduleId,
                        'academy_id' => $academyId,
                        'student_id' => $studentId,
                        'teacher_id' => $teacherId,
                        'timezone' => $timezone,
                        // Decision 2 still holds: a timetable new to us starts today.
                        'start_date' => $scheduleStart,
                        'is_active' => true,
                        'version' => 1,
                    ]);
                    $created++;
                } else {
                    DB::table('schedules')->where('id', $scheduleId)->update([
                        'teacher_id' => $teacherId,
                        'timezone' => $timezone,
                        'is_active' => true,
                        'deleted_at' => null,
                        'version' => DB::raw('version + 1'),
                        'updated_at' => now(),
                    ]);
                    $updated++;
                }
                $this->remember($academyId, $source, 'schedule', $key, $scheduleId);
                $wanted[$scheduleId] = true;

                [$written, $removed] = $this->reconcileSlots($academyId, $scheduleId, $teacherSlots);
                $slotsWritten += $written;
                $slotsRemoved += $removed;
            }
        }

        // Every timetable this import made that the old app no longer has a live series for.
        $ended = DB::table('legacy_import_map as m')
            ->join('schedules as s', 's.id', '=', 'm.target_id')
            ->where('m.academy_id', $academyId)->where('m.source', $source)->where('m.entity', 'schedule')
            ->where('s.is_active', true)->whereNull('s.deleted_at')
            ->pluck('s.id')
            ->map(fn ($id) => (string) $id)
            ->reject(fn ($id) => isset($wanted[$id]))
            ->values()->all();
        if ($ended !== []) {
            DB::table('schedules')->whereIn('id', $ended)->update([
                'is_active' => false,
                'deleted_at' => now(),
                'updated_at' => now(),
            ]);
            $this->endedSchedules = $ended;
        }

        $this->counts['timetables_created'] = $created;
        $this->counts['timetables_updated'] = $updated;
        $this->counts['timetables_ended'] = count($ended);
        $this->counts['timetable_slots'] = $slotsWritten;
        $this->counts['timetable_slots_removed'] = $slotsRemoved;
    }

    /**
     * Exactly these slots, keyed by (weekday, start time) — ScheduleController::reconcileSlots'
     * rule. A kept slot keeps its id so its generated lessons stay matched; a dropped one loses
     * its future untouched lessons, and anything past or touched is detached, never deleted.
     *
     * @param  list<array{weekday:int,start_time:string,duration_minutes:int}>  $slots
     * @return array{0:int,1:int} [slots written, slots removed]
     */
    private function reconcileSlots(string $academyId, string $scheduleId, array $slots): array
    {
        $key = fn ($weekday, $time) => $weekday.'|'.substr((string) $time, 0, 5);
        $desired = [];
        foreach ($slots as $slot) {
            $desired[$key($slot['weekday'], $slot['start_time'])] = $slot;
        }

        $removed = 0;
        $current = [];
        foreach (DB::table('schedule_slots')->where('schedule_id', $scheduleId)->get() as $row) {
            $k = $key($row->weekday, $row->start_time_local);
            if (isset($desired[$k])) {
                $current[$k] = $row;

                continue;
            }
            DB::table('sessions')->where('slot_id', $row->id)
                ->where('status', 'SCHEDULED')
                ->whereNull('original_session_id')
                ->where('scheduled_at_utc', '>=', now())
                ->whereNotExists(fn ($q) => $q->select(DB::raw(1))->from('session_reports as sr')->whereColumn('sr.session_id', 'sessions.id'))
                ->delete();
            DB::table('sessions')->where('slot_id', $row->id)->update(['slot_id' => null, 'updated_at' => now()]);
            DB::table('schedule_slots')->where('id', $row->id)->delete();
            $removed++;
        }

        foreach ($desired as $k => $slot) {
            if (isset($current[$k])) {
                if ((int) $current[$k]->duration_minutes !== $slot['duration_minutes']) {
                    DB::table('schedule_slots')->where('id', $current[$k]->id)
                        ->update(['duration_minutes' => $slot['duration_minutes'], 'updated_at' => now()]);
                }

                continue;
            }
            DB::table('schedule_slots')->insert([
                'id' => (string) Str::uuid(),
                'academy_id' => $academyId,
                'schedule_id' => $scheduleId,
                'weekday' => $slot['weekday'],
                'start_time_local' => $slot['start_time'],
                'duration_minutes' => $slot['duration_minutes'],
            ]);
        }

        return [count($desired), $removed];
    }

    /**
     * The student's active teachers become exactly the teachers holding their live slots. A
     * student with no live series keeps whoever they have: their lessons stop, their teacher
     * does not (the same rule as deleting a timetable by hand).
     *
     * @param  array<int,int>  $live  legacy teacher id → slot count
     * @param  array<int,string>  $teacherIds
     * @return array{0:int,1:int} [opened, closed]
     */
    private function syncAssignments(string $academyId, string $studentId, array $live, array $teacherIds): array
    {
        $want = [];
        foreach (array_keys($live) as $t) {
            if (isset($teacherIds[(int) $t])) {
                $want[$teacherIds[(int) $t]] = true;
            }
        }
        if ($want === []) {
            return [0, 0];
        }

        $active = DB::table('student_teacher_assignments')
            ->where('student_id', $studentId)->whereNull('ended_at')
            ->pluck('teacher_id')->map(fn ($id) => (string) $id)->all();

        $closed = 0;
        foreach ($active as $teacherId) {
            if (! isset($want[$teacherId])) {
                DB::table('student_teacher_assignments')
                    ->where('student_id', $studentId)->where('teacher_id', $teacherId)->whereNull('ended_at')
                    ->update(['ended_at' => now(), 'updated_at' => now()]);
                $closed++;
            }
        }

        $opened = 0;
        foreach (array_keys($want) as $teacherId) {
            if (! in_array($teacherId, $active, true)) {
                DB::table('student_teacher_assignments')->insert([
                    'id' => (string) Str::uuid(),
                    'academy_id' => $academyId,
                    'student_id' => $studentId,
                    'teacher_id' => $teacherId,
                    'started_at' => now(),
                    'ended_at' => null,
                ]);
                $opened++;
            }
        }
        if ($opened > 0 || $closed > 0) {
            $this->counts['students_teacher_changed'] = ($this->counts['students_teacher_changed'] ?? 0) + 1;
        }

        return [$opened, $closed];
    }

    /**
     * The old hourly rate, re-applied to the subscription the first run made. A subscription a
     * human set up here (any other label) is theirs and is left alone.
     *
     * @param  array<string,mixed>  $s
     */
    private function syncPrice(string $academyId, string $studentId, array $s, string $guardianCurrency, string $scheduleStart): void
    {
        $hourly = $s['hour_price'] ?? null;
        if ($hourly === null) {
            return;
        }
        $price = (int) round(((float) $hourly) * 100);
        $currency = $this->currencyOf($s) ?? $guardianCurrency;

        $active = DB::table('subscriptions')
            ->where('student_id', $studentId)->where('status', 'ACTIVE')->whereNull('deleted_at')
            ->get(['id', 'plan_label', 'price_minor', 'currency']);

        $imported = $active->firstWhere('plan_label', self::IMPORTED_PLAN_LABEL);
        if ($imported !== null) {
            if ((int) $imported->price_minor !== $price || strtoupper(trim((string) $imported->currency)) !== $currency) {
                DB::table('subscriptions')->where('id', $imported->id)->update([
                    'price_minor' => $price,
                    'currency' => $currency,
                    'updated_at' => now(),
                ]);
                $this->counts['prices_changed'] = ($this->counts['prices_changed'] ?? 0) + 1;
            }

            return;
        }

        if ($active->isEmpty()) {
            // Had no price at the first run and has one now.
            DB::table('subscriptions')->insert([
                'id' => (string) Str::uuid(),
                'academy_id' => $academyId,
                'student_id' => $studentId,
                'plan_label' => self::IMPORTED_PLAN_LABEL,
                'price_minor' => $price,
                'currency' => $currency,
                'price_basis' => 'PER_HOUR',
                'status' => 'ACTIVE',
                'start_date' => $s['first_activity_date'] ?? $scheduleStart,
            ]);
            $this->counts['subscriptions_added_by_sync'] = ($this->counts['subscriptions_added_by_sync'] ?? 0) + 1;
        }
    }

    /**
     * People this import made that the old app no longer has. Reported, never deleted: a row
     * gone from the old database may be a mistake there, and removing a student here winds down
     * their lessons and package — a decision for a person.
     *
     * @param  array<string,mixed>  $payload
     */
    private function reportMissing(array $payload, string $academyId, string $source): void
    {
        foreach (['teacher' => 'teachers', 'student' => 'students'] as $entity => $table) {
            $inFile = array_map(fn ($r) => (string) $r['legacy_id'], $payload[$table] ?? []);
            $gone = DB::table('legacy_import_map as m')
                ->join($table.' as t', 't.id', '=', 'm.target_id')
                ->where('m.academy_id', $academyId)->where('m.source', $source)->where('m.entity', $entity)
                ->whereNull('t.deleted_at')
                ->whereNotIn('m.legacy_key', $inFile)
                ->pluck('t.full_name')->all();
            if ($gone !== []) {
                $this->counts[$table.'_gone_from_old_app'] = count($gone);
                foreach ($gone as $name) {
                    $this->note($entity.'_gone', ucfirst($entity)." \"{$name}\" is no longer in the old app. Left as is here — deactivate them by hand if they really left.");
                }
            }
        }
    }

    // ------------------------------------------------------------------ reading the export

    /** @var array<int, list<array{weekday:int,start_time:string,duration_minutes:int}>> */
    private array $slotsByStudent = [];

    /**
     * Read the live series once: who teaches each student (weighted by slots) and the merged set
     * of weekly slots. A student with two live series keeps BOTH sets of lessons — losing one
     * would take a real lesson off the board, which is worse than showing it under the teacher
     * who holds the majority of their week.
     *
     * @param  array<string,mixed>  $payload
     * @return array<int, array<int,int>> legacy student id → [legacy teacher id → slot count]
     */
    private function liveSchedulesByStudent(array $payload): array
    {
        $maxDuration = (int) $this->option('max-duration');
        $byStudent = [];
        $merged = [];
        $dropped = 0;
        $clamped = 0;
        $overnight = 0;

        foreach ($payload['schedules'] ?? [] as $series) {
            if (! ($series['is_live'] ?? false)) {
                $dropped++;

                continue;
            }

            $studentId = (int) $series['student_legacy_id'];
            $teacherId = (int) $series['teacher_legacy_id'];

            foreach ($series['slots'] ?? [] as $slot) {
                $duration = (int) $slot['duration_minutes'];
                if ($duration > $maxDuration || $duration <= 0) {
                    // e.g. 23:50 → 12:00, which reads as a 12-hour lesson. That is a typo in the
                    // old data, not a lesson; an hour is the overwhelmingly common length there.
                    $this->note('slot_duration_implausible', sprintf(
                        'Student #%d, %s %s–%s reads as %d minutes; imported as 60.',
                        $studentId, $this->weekdayName((int) $slot['weekday']), $slot['start_time'], $slot['end_time'] ?? '?', $duration
                    ));
                    $duration = 60;
                    $clamped++;
                } elseif ($slot['crosses_midnight'] ?? false) {
                    $overnight++;
                }

                $key = $slot['weekday'].'|'.$slot['start_time'];
                // Two series on the same weekday and time is one lesson recorded twice; the
                // longer length wins so nobody is billed for less than they taught.
                if (! isset($merged[$studentId][$key]) || $merged[$studentId][$key]['duration_minutes'] < $duration) {
                    $merged[$studentId][$key] = [
                        'weekday' => (int) $slot['weekday'],
                        'start_time' => (string) $slot['start_time'],
                        'duration_minutes' => $duration,
                        // Whose lesson it is, so --sync can give each teacher their own timetable.
                        'teacher' => $teacherId,
                    ];
                }

                $byStudent[$studentId][$teacherId] = ($byStudent[$studentId][$teacherId] ?? 0) + 1;
            }
        }

        foreach ($merged as $studentId => $slots) {
            $this->slotsByStudent[$studentId] = array_values($slots);
        }

        $this->counts['series_expired_skipped'] = $dropped;
        if ($clamped > 0) {
            $this->note('slot_clamped', "{$clamped} slot(s) had an impossible length and were imported as 60 minutes.");
        }
        if ($overnight > 0) {
            $this->note('slot_overnight', "{$overnight} slot(s) run past midnight; their length was recovered by wrapping to the next day.");
        }

        return $byStudent;
    }

    // ------------------------------------------------------------------ helpers

    /**
     * The old app stores WhatsApp numbers as bare digits with the country code but no '+'
     * ("447533711592"). `Support\Phone` rejects that on purpose — a bare string of digits from a
     * human typing into a form could be a local number, and guessing would silently misroute a
     * parent's invoice. Here the provenance is known: every one of them already carries its
     * country code, so adding the '+' is a restatement, not a guess.
     */
    private function phone(?string $raw, string $who): ?string
    {
        if ($raw === null) {
            return null;
        }

        $cleaned = preg_replace('/(?!^)\+|[^0-9+]/', '', trim($raw)) ?? '';
        if (str_starts_with($cleaned, '00')) {
            $cleaned = '+'.substr($cleaned, 2);
        }
        if ($cleaned !== '' && ! str_starts_with($cleaned, '+')) {
            $cleaned = '+'.$cleaned;
        }

        if (! preg_match('/^\+[1-9][0-9]{1,14}$/', $cleaned)) {
            $this->note('phone_unusable', "Could not read \"{$raw}\" as a phone number ({$who}); left blank.");

            return null;
        }

        return $cleaned;
    }

    /**
     * A number that is guaranteed to reach nobody.
     *
     * Some of the old apps never really collected a phone: the column is required, so whoever was
     * entering students typed a single letter to get past it. There is no number to migrate, but a
     * guardian must have one (`guardians.whatsapp_phone` is NOT NULL and E.164 checked), and the
     * two obvious escapes are both worse than this. Skipping loses the whole roster. Pointing them
     * all at one real number puts a hundred families' invoices and reports in one stranger's chat.
     *
     * So: country code 999, which ITU-T E.164 reserves and has never assigned to anyone. It passes
     * our format check, it is unmistakably not a real number, and a send to it fails instead of
     * reaching a person. One per student, never shared, so nobody is filed as somebody's sibling
     * by accident. The source code in the middle keeps two legacy systems from colliding if they
     * are ever merged into one academy.
     */
    private function placeholderPhone(string $source, string $kind, int $id): string
    {
        $sourceCode = str_pad((string) (crc32($source) % 1000), 3, '0', STR_PAD_LEFT);

        return '+999'.$sourceCode.($kind === 'family' ? '1' : '0').str_pad((string) $id, 6, '0', STR_PAD_LEFT);
    }

    /** @param list<array<string,mixed>> $members */
    private function commonCurrency(array $members): ?string
    {
        $tally = [];
        foreach ($members as $m) {
            $c = $this->currencyOf($m);
            if ($c !== null) {
                $tally[$c] = ($tally[$c] ?? 0) + 1;
            }
        }
        if ($tally === []) {
            return null;
        }
        arsort($tally);
        if (count($tally) > 1) {
            $this->note('family_currency_mixed', 'Students sharing a phone are priced in different currencies ('.implode(', ', array_keys($tally)).'); the guardian took the commonest. Their own prices are unchanged.');
        }

        return (string) array_key_first($tally);
    }

    /** @param array<string,mixed> $person */
    private function currencyOf(array $person): ?string
    {
        $c = $person['currency'] ?? null;

        return is_string($c) && strlen($c) === 3 ? strtoupper($c) : null;
    }

    private function mapped(string $academyId, string $source, string $entity, string $legacyKey): ?string
    {
        $id = DB::table('legacy_import_map')
            ->where('academy_id', $academyId)->where('source', $source)
            ->where('entity', $entity)->where('legacy_key', $legacyKey)
            ->value('target_id');

        return $id !== null ? (string) $id : null;
    }

    private function remember(string $academyId, string $source, string $entity, string $legacyKey, string $targetId): void
    {
        DB::table('legacy_import_map')->updateOrInsert(
            ['academy_id' => $academyId, 'source' => $source, 'entity' => $entity, 'legacy_key' => $legacyKey],
            ['target_id' => $targetId, 'updated_at' => now()],
        );
    }

    private function weekdayName(int $weekday): string
    {
        return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][$weekday] ?? (string) $weekday;
    }

    private function note(string $code, string $detail): void
    {
        $this->notes[] = ['code' => $code, 'detail' => $detail];
    }

    private function report(bool $rolledBack): void
    {
        $this->newLine();
        $rows = [];
        foreach ($this->counts as $k => $v) {
            $rows[] = [str_replace('_', ' ', $k), (string) $v];
        }
        $this->table(['what', 'count'], $rows);

        if ($this->notes !== []) {
            $this->newLine();
            $this->warn('Needs a human:');

            // A hundred lines of "could not read this phone number" buries the one line that says
            // what happened to all of them. Each kind of note shows a few real examples and then
            // says how many more there were; nothing is hidden, but the report stays readable.
            $byCode = [];
            foreach ($this->notes as $n) {
                $byCode[$n['code']][$n['detail']] = true;
            }

            foreach ($byCode as $details) {
                $lines = array_keys($details);
                foreach (array_slice($lines, 0, self::NOTE_EXAMPLES) as $line) {
                    $this->line('  • '.$line);
                }
                $extra = count($lines) - self::NOTE_EXAMPLES;
                if ($extra > 0) {
                    $this->line("    …and {$extra} more like it.");
                }
            }
        }

        $this->newLine();
        if ($rolledBack) {
            $this->warn('DRY RUN — every write above was rolled back. Re-run without --dry-run to keep it.');
        } else {
            $this->info('Imported. Re-running this command is safe: it updates what it made rather than duplicating it.');
        }
    }
}
