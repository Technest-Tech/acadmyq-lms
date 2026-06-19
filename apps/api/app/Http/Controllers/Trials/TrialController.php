<?php

declare(strict_types=1);

namespace App\Http\Controllers\Trials;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Support\Audit;
use App\Support\DataTable;
use App\Support\Phone;
use App\Support\TimeHelper;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Free Trials (Free-Trials module). The owner finds an available teacher for a requested slot,
 * books a one-off trial — for an existing student OR a freshly-captured lead — tracks the
 * pipeline of scheduled/past trials, and converts a successful lead into a real student.
 *
 * Two capabilities gate this surface: `trial.read` (list, stats, availability search) and
 * `trial.manage` (book, update outcome, cancel, convert). Both are OWNER-only; RLS scopes every
 * query to the current academy. The availability matcher is CONFLICT-AWARE — it cross-checks the
 * teacher's declared `availability` windows AND any overlapping session/trial already on the
 * books — but, consistent with §3.7, conflicts are surfaced as flags, never a hard block.
 */
final class TrialController extends Controller
{
    use InteractsWithScheduling;

    /** Outcomes an owner may set directly; CONVERTED is reached only through convert(). */
    private const EDITABLE_STATUSES = ['SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'];

    /** GET /api/trials — server-driven pipeline of trials joined to teacher + (optional) student. */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('trial.read');

        $query = DB::table('trials as tr')
            ->leftJoin('teachers as t', 't.id', '=', 'tr.teacher_id')
            ->leftJoin('students as s', 's.id', '=', 'tr.student_id')
            ->whereNull('tr.deleted_at')
            ->select([
                'tr.id', 'tr.teacher_id', 'tr.student_id', 'tr.lead_name', 'tr.lead_whatsapp',
                'tr.lead_email', 'tr.timezone', 'tr.scheduled_at_utc', 'tr.duration_minutes',
                'tr.status', 'tr.outcome_notes', 'tr.converted_student_id', 'tr.created_at',
                't.full_name as teacher_name',
                's.full_name as student_name',
            ]);

        $result = DataTable::paginate($query, $request, [
            'idColumn' => 'tr.id',
            'searchable' => ['tr.lead_name', 's.full_name', 'tr.lead_whatsapp', 'tr.lead_email'],
            'sortable' => [
                'scheduled' => 'tr.scheduled_at_utc',
                'created_at' => 'tr.created_at',
                'status' => 'tr.status',
            ],
            'filters' => [
                'status' => fn ($q, $value) => $q->where('tr.status', strtoupper((string) $value)),
                'teacher_id' => fn ($q, $value) => $q->where('tr.teacher_id', (string) $value),
            ],
            'defaultSort' => '-scheduled',
        ]);

        $result['rows'] = $result['rows']->map(function (object $r): object {
            $r->scheduled_at_utc = Carbon::parse($r->scheduled_at_utc)->utc()->toIso8601String();
            $r->created_at = Carbon::parse($r->created_at)->utc()->toIso8601String();
            $r->duration_minutes = (int) $r->duration_minutes;
            $r->display_name = $r->student_name ?? $r->lead_name;
            $r->is_lead = $r->student_id === null;

            return $r;
        });

        return response()->json($result);
    }

    /** GET /api/trials/summary — headline stats for the page (counts + conversion rate). */
    public function summary(): JsonResponse
    {
        Gate::authorize('trial.read');

        $base = fn () => DB::table('trials')->whereNull('deleted_at');

        $byStatus = $base()
            ->select('status', DB::raw('count(*) as c'))
            ->groupBy('status')
            ->pluck('c', 'status');

        $scheduled = (int) ($byStatus['SCHEDULED'] ?? 0);
        $completed = (int) ($byStatus['COMPLETED'] ?? 0);
        $noShow = (int) ($byStatus['NO_SHOW'] ?? 0);
        $cancelled = (int) ($byStatus['CANCELLED'] ?? 0);
        $converted = (int) ($byStatus['CONVERTED'] ?? 0);

        // Conversion rate over trials that reached an outcome (i.e. excludes still-scheduled and
        // cancelled): converted ÷ (converted + completed-but-not-converted + no-show).
        $resolved = $converted + $completed + $noShow;
        $conversionRate = $resolved > 0 ? round(($converted / $resolved) * 100) : 0;

        $upcoming = (int) $base()
            ->where('status', 'SCHEDULED')
            ->where('scheduled_at_utc', '>=', now()->format('Y-m-d H:i:sP'))
            ->count();

        return response()->json([
            'total' => $scheduled + $completed + $noShow + $cancelled + $converted,
            'scheduled' => $scheduled,
            'upcoming' => $upcoming,
            'completed' => $completed,
            'no_show' => $noShow,
            'cancelled' => $cancelled,
            'converted' => $converted,
            'conversion_rate' => $conversionRate,
        ]);
    }

    /**
     * GET /api/trials/availability — the matcher. For a requested local date + time + duration,
     * return the teachers who can take it: their declared availability covers the slot (or they
     * have declared none, surfaced as "availability not set"), each annotated with whether they
     * already have an overlapping session/trial. Teachers whose declared windows clearly do NOT
     * cover the slot are excluded — this is a "who's free at Monday 9pm?" answer.
     */
    public function availability(Request $request): JsonResponse
    {
        Gate::authorize('trial.read');

        $data = $request->validate([
            'date' => ['required', 'date'],
            'time' => ['required', 'regex:/^\d{2}:\d{2}$/'],
            'duration_minutes' => ['required', 'integer', 'min:1', 'max:600'],
            'timezone' => ['sometimes', 'nullable', 'string', 'timezone'],
            'specialization' => ['sometimes', 'nullable', 'string', 'max:255'],
        ]);

        $academyId = $this->currentAcademyId();
        $timezone = $data['timezone'] ?? $this->academyTimezone($academyId);
        $duration = (int) $data['duration_minutes'];

        $startUtc = TimeHelper::toUtc($data['date'].' '.$data['time'], $timezone);
        $local = $startUtc->copy()->setTimezone($timezone);
        $weekday = $local->dayOfWeek;            // 0=Sun … 6=Sat
        $startMin = $local->hour * 60 + $local->minute;
        $endMin = $startMin + $duration;

        $teachers = DB::table('teachers')
            ->whereNull('deleted_at')
            ->when(! empty($data['specialization']), fn ($q) => $q->where('specialization', $data['specialization']))
            ->orderBy('full_name')
            ->get(['id', 'full_name', 'specialization', 'session_rate_minor', 'currency', 'availability']);

        $matches = [];
        foreach ($teachers as $teacher) {
            $raw = $teacher->availability;
            $windows = is_string($raw) ? (json_decode($raw, true) ?: []) : (array) ($raw ?? []);
            $known = $windows !== [];
            $covers = $known && $this->availabilityCovers($windows, $weekday, $startMin, $endMin);

            // Keep teachers who fit, plus those who simply haven't declared availability yet
            // (empty = "unspecified", not "never available", §3.7). Drop the definitively-busy.
            if ($known && ! $covers) {
                continue;
            }

            $conflict = $this->teacherConflicts((string) $teacher->id, $startUtc, $duration) !== []
                || $this->trialConflicts((string) $teacher->id, $startUtc, $duration) !== [];

            $matches[] = [
                'id' => (string) $teacher->id,
                'full_name' => $teacher->full_name,
                'specialization' => $teacher->specialization,
                'session_rate_minor' => (int) $teacher->session_rate_minor,
                'currency' => $teacher->currency,
                'availability_known' => $known,
                'available' => $covers,
                'has_conflict' => $conflict,
            ];
        }

        // Best first: declared-available & free → declared-available & conflicting → unspecified.
        usort($matches, function (array $a, array $b): int {
            $rank = fn (array $m): int => match (true) {
                $m['available'] && ! $m['has_conflict'] => 0,
                $m['available'] => 1,
                default => 2,
            };

            return [$rank($a), $a['full_name']] <=> [$rank($b), $b['full_name']];
        });

        return response()->json([
            'slot' => [
                'scheduled_at_utc' => $startUtc->toIso8601String(),
                'timezone' => $timezone,
                'weekday' => $weekday,
                'duration_minutes' => $duration,
            ],
            'teachers' => $matches,
        ]);
    }

    /**
     * GET /api/trials/availability-grid — a whole week of bookable slots for the calendar finder.
     * For the 7 days from `week_start`, returns the candidate start times (rows) and, per day×time
     * cell, the teachers whose declared availability covers that slot — each flagged for whether
     * they already have an overlapping session/trial. Bookings are loaded once for the week and
     * overlaps computed in memory, so the grid is a couple of queries, not one-per-cell.
     */
    public function availabilityGrid(Request $request): JsonResponse
    {
        Gate::authorize('trial.read');

        $data = $request->validate([
            'week_start' => ['required', 'date'],
            'duration_minutes' => ['required', 'integer', 'min:1', 'max:600'],
            'timezone' => ['sometimes', 'nullable', 'string', 'timezone'],
            'specialization' => ['sometimes', 'nullable', 'string', 'max:255'],
        ]);

        $academyId = $this->currentAcademyId();
        $timezone = $data['timezone'] ?? $this->academyTimezone($academyId);
        $duration = (int) $data['duration_minutes'];
        $step = 30; // calendar granularity, in minutes

        // The 7 local dates of the week (week_start is day 0).
        $start = Carbon::parse($data['week_start'])->startOfDay();
        $days = [];
        for ($i = 0; $i < 7; $i++) {
            $d = $start->copy()->addDays($i);
            $days[] = ['date' => $d->format('Y-m-d'), 'weekday' => (int) $d->dayOfWeek];
        }

        $teachers = DB::table('teachers')
            ->whereNull('deleted_at')
            ->when(! empty($data['specialization']), fn ($q) => $q->where('specialization', $data['specialization']))
            ->orderBy('full_name')
            ->get(['id', 'full_name', 'specialization', 'session_rate_minor', 'currency', 'availability']);

        // Decode each teacher's windows once and collect the distinct candidate start times.
        $windowsByTeacher = [];
        $rowMinutes = [];
        foreach ($teachers as $teacher) {
            $raw = $teacher->availability;
            $windows = is_string($raw) ? (json_decode($raw, true) ?: []) : (array) ($raw ?? []);
            $windowsByTeacher[(string) $teacher->id] = $windows;
            foreach ($windows as $w) {
                $ws = $this->hhmmToMinutes((string) ($w['start_local'] ?? '00:00'));
                $we = $this->hhmmToMinutes((string) ($w['end_local'] ?? '24:00'));
                if ($we === 0) {
                    $we = 1440;
                }
                $end = $we > $ws ? $we : $we + 1440; // unwrap a midnight-crossing window
                for ($t = $ws; $t + $duration <= $end; $t += $step) {
                    $rowMinutes[$t % 1440] = true;
                }
            }
        }
        ksort($rowMinutes);
        $times = array_map(fn (int $m) => sprintf('%02d:%02d', intdiv($m, 60), $m % 60), array_keys($rowMinutes));

        // Load the week's bookings (sessions + scheduled trials) once, grouped by teacher.
        $weekFrom = TimeHelper::toUtc($days[0]['date'].' 00:00', $timezone);
        $weekTo = TimeHelper::toUtc($start->copy()->addDays(7)->format('Y-m-d').' 00:00', $timezone);
        $busy = $this->teacherBusyIntervals($windowsByTeacher === [] ? [] : array_keys($windowsByTeacher), $weekFrom, $weekTo);

        $cells = [];
        foreach ($days as $day) {
            foreach ($times as $time) {
                $startMin = $this->hhmmToMinutes($time);
                $endMin = $startMin + $duration;
                $slotUtc = null; // computed lazily on first covering teacher
                $here = [];
                foreach ($teachers as $teacher) {
                    $tid = (string) $teacher->id;
                    if (! $this->availabilityCovers($windowsByTeacher[$tid], $day['weekday'], $startMin, $endMin)) {
                        continue;
                    }
                    $slotUtc ??= TimeHelper::toUtc($day['date'].' '.$time, $timezone);
                    $here[] = [
                        'id' => $tid,
                        'full_name' => $teacher->full_name,
                        'specialization' => $teacher->specialization,
                        'session_rate_minor' => (int) $teacher->session_rate_minor,
                        'currency' => $teacher->currency,
                        'availability_known' => true,
                        'available' => true,
                        'has_conflict' => $this->overlapsBusy($busy[$tid] ?? [], $slotUtc, $duration),
                    ];
                }
                if ($here !== []) {
                    $cells[$day['date'].'T'.$time] = $here;
                }
            }
        }

        return response()->json([
            'week_start' => $days[0]['date'],
            'timezone' => $timezone,
            'duration_minutes' => $duration,
            'times' => $times,
            'days' => $days,
            'cells' => $cells,
        ]);
    }

    /** POST /api/trials — book a trial for an existing student OR a freshly-captured lead. */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('trial.manage');

        $academyId = $this->currentAcademyId();
        $data = $request->validate([
            'teacher_id' => ['required', 'uuid'],
            'student_id' => ['sometimes', 'nullable', 'uuid'],
            'lead_name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'lead_whatsapp' => ['sometimes', 'nullable', 'string', 'max:32'],
            'lead_email' => ['sometimes', 'nullable', 'email', 'max:255'],
            'scheduled_at_utc' => ['sometimes', 'nullable', 'date'],
            'local_datetime' => ['sometimes', 'nullable', 'string'],
            'timezone' => ['sometimes', 'nullable', 'string', 'timezone'],
            'duration_minutes' => ['required', 'integer', 'min:1', 'max:600'],
            'outcome_notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        $this->assertActiveTeacher($data['teacher_id']);

        // Identity: an existing student, or a lead with at least a name + WhatsApp number.
        $studentId = $data['student_id'] ?? null;
        if ($studentId !== null) {
            if (DB::table('students')->where('id', $studentId)->whereNull('deleted_at')->doesntExist()) {
                throw ValidationException::withMessages(['student_id' => ['Unknown or inactive student.']]);
            }
            $leadName = $leadWhatsapp = $leadEmail = null;
        } else {
            $leadName = trim((string) ($data['lead_name'] ?? ''));
            $leadWhatsapp = Phone::normalize($data['lead_whatsapp'] ?? null, 'lead_whatsapp');
            $leadEmail = $data['lead_email'] ?? null;
            if ($leadName === '' || $leadWhatsapp === null) {
                throw ValidationException::withMessages([
                    'lead_name' => ['Pick an existing student, or give the new lead a name and WhatsApp number.'],
                ]);
            }
        }

        $timezone = $data['timezone'] ?? $this->academyTimezone($academyId);
        $startUtc = $this->resolveInstant($data, $timezone);
        $duration = (int) $data['duration_minutes'];

        $trialId = (string) Str::uuid();
        DB::table('trials')->insert([
            'id' => $trialId,
            'academy_id' => $academyId,
            'teacher_id' => $data['teacher_id'],
            'student_id' => $studentId,
            'lead_name' => $leadName,
            'lead_whatsapp' => $leadWhatsapp,
            'lead_email' => $leadEmail,
            'timezone' => $timezone,
            'scheduled_at_utc' => $startUtc->format('Y-m-d H:i:sP'),
            'duration_minutes' => $duration,
            'status' => 'SCHEDULED',
            'outcome_notes' => $data['outcome_notes'] ?? null,
        ]);

        Audit::log('trial.create', 'trial', $trialId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'teacher_id' => $data['teacher_id'],
            'student_id' => $studentId,
            'lead' => $studentId === null ? $leadName : null,
            'scheduled_at_utc' => $startUtc->toIso8601String(),
            'duration_minutes' => $duration,
        ]);

        return response()->json([
            'trialId' => $trialId,
            'warnings' => $this->schedulingWarnings((string) $data['teacher_id'], $startUtc, $duration, $timezone),
        ], 201);
    }

    /** PATCH /api/trials/{id} — record an outcome, edit notes, or reschedule the slot. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('trial.manage');

        $academyId = $this->currentAcademyId();
        $trial = DB::table('trials')->where('id', $id)->whereNull('deleted_at')->first();
        if ($trial === null) {
            abort(404, 'Trial not found.');
        }
        if ((string) $trial->status === 'CONVERTED') {
            throw ValidationException::withMessages(['status' => ['A converted trial can no longer be changed.']]);
        }

        $data = $request->validate([
            'status' => ['sometimes', 'nullable', Rule::in(self::EDITABLE_STATUSES)],
            'outcome_notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'scheduled_at_utc' => ['sometimes', 'nullable', 'date'],
            'local_datetime' => ['sometimes', 'nullable', 'string'],
            'timezone' => ['sometimes', 'nullable', 'string', 'timezone'],
            'duration_minutes' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:600'],
        ]);

        $after = [];
        $before = [];
        if (array_key_exists('status', $data) && $data['status'] !== null && (string) $data['status'] !== (string) $trial->status) {
            $before['status'] = $trial->status;
            $after['status'] = $data['status'];
        }
        if (array_key_exists('outcome_notes', $data) && (string) $data['outcome_notes'] !== (string) $trial->outcome_notes) {
            $before['outcome_notes'] = $trial->outcome_notes;
            $after['outcome_notes'] = $data['outcome_notes'];
        }

        // Reschedule: a new instant (explicit UTC or local wall-clock) and/or a new duration.
        if (! empty($data['scheduled_at_utc']) || ! empty($data['local_datetime'])) {
            $timezone = $data['timezone'] ?? (string) $trial->timezone;
            $newStart = $this->resolveInstant($data, $timezone);
            $before['scheduled_at_utc'] = Carbon::parse($trial->scheduled_at_utc)->utc()->toIso8601String();
            $after['scheduled_at_utc'] = $newStart->format('Y-m-d H:i:sP');
            $after['timezone'] = $timezone;
        }
        if (! empty($data['duration_minutes']) && (int) $data['duration_minutes'] !== (int) $trial->duration_minutes) {
            $before['duration_minutes'] = (int) $trial->duration_minutes;
            $after['duration_minutes'] = (int) $data['duration_minutes'];
        }

        if ($after === []) {
            return response()->json(['ok' => true, 'changed' => []]);
        }

        DB::table('trials')->where('id', $id)->update($after + ['updated_at' => now()]);
        Audit::log('trial.update', 'trial', $id, $academyId, $this->ctx()->userId, $this->ctx()->role, after: $after, before: $before);

        return response()->json(['ok' => true, 'changed' => array_keys($after)]);
    }

    /**
     * POST /api/trials/{id}/convert — link a completed lead trial to the real student it became.
     * The student is created first via the normal student-creation flow (POST /students), so this
     * endpoint only records the linkage: stamp `converted_student_id`, adopt `student_id`, and move
     * the trial to CONVERTED. Idempotency: a trial that is already CONVERTED is rejected.
     */
    public function convert(Request $request, string $id): JsonResponse
    {
        Gate::authorize('trial.manage');

        $academyId = $this->currentAcademyId();
        $trial = DB::table('trials')->where('id', $id)->whereNull('deleted_at')->first();
        if ($trial === null) {
            abort(404, 'Trial not found.');
        }
        if ((string) $trial->status === 'CONVERTED') {
            throw ValidationException::withMessages(['trial' => ['This trial has already been converted.']]);
        }

        $data = $request->validate([
            'student_id' => ['required', 'uuid'],
        ]);
        if (DB::table('students')->where('id', $data['student_id'])->whereNull('deleted_at')->doesntExist()) {
            throw ValidationException::withMessages(['student_id' => ['Unknown or inactive student.']]);
        }

        DB::table('trials')->where('id', $id)->update([
            'student_id' => $trial->student_id ?? $data['student_id'],
            'converted_student_id' => $data['student_id'],
            'status' => 'CONVERTED',
            'updated_at' => now(),
        ]);
        Audit::log('trial.convert', 'trial', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['converted_student_id' => $data['student_id'], 'status' => 'CONVERTED'],
            before: ['status' => $trial->status]);

        return response()->json(['ok' => true, 'studentId' => $data['student_id']]);
    }

    /** DELETE /api/trials/{id} — cancel a trial (kept in the pipeline as CANCELLED, not removed). */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('trial.manage');

        $academyId = $this->currentAcademyId();
        $trial = DB::table('trials')->where('id', $id)->whereNull('deleted_at')->first();
        if ($trial === null) {
            abort(404, 'Trial not found.');
        }
        if ((string) $trial->status === 'CONVERTED') {
            throw ValidationException::withMessages(['trial' => ['A converted trial cannot be cancelled.']]);
        }

        DB::table('trials')->where('id', $id)->update(['status' => 'CANCELLED', 'updated_at' => now()]);
        Audit::log('trial.cancel', 'trial', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['status' => 'CANCELLED'], before: ['status' => $trial->status]);

        return response()->json(['ok' => true]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /**
     * True when the slot [startMin, endMin) on $weekday fits ENTIRELY inside one declared
     * availability window. Windows are {weekday, start_local, end_local} in local wall-clock;
     * a window whose end ≤ start crosses midnight (the tail lands on the next weekday), matching
     * the convention in {@see InteractsWithScheduling::outsideAvailability()}.
     *
     * @param  list<array<string,mixed>>  $windows
     */
    private function availabilityCovers(array $windows, int $weekday, int $startMin, int $endMin): bool
    {
        foreach ($windows as $w) {
            $wday = (int) ($w['weekday'] ?? -1);
            $ws = $this->hhmmToMinutes((string) ($w['start_local'] ?? '00:00'));
            $we = $this->hhmmToMinutes((string) ($w['end_local'] ?? '24:00'));
            if ($we === 0) {
                $we = 1440; // an end of 00:00 means midnight — the end of the start day.
            }

            if ($we > $ws) {
                // Same-day window: the whole slot must sit within [ws, we) on this weekday.
                if ($wday === $weekday && $startMin >= $ws && $endMin <= $we) {
                    return true;
                }
            } else {
                // Crosses midnight: evening [ws, 24:00) on `wday` (+ its early-morning tail next day).
                if ($wday === $weekday && $startMin >= $ws && $endMin <= 1440 + $we) {
                    return true;
                }
                // The early-morning tail [00:00, we) belongs to the following weekday.
                if (((($wday + 1) % 7) === $weekday) && $startMin >= 0 && $endMin <= $we) {
                    return true;
                }
            }
        }

        return false;
    }

    private function hhmmToMinutes(string $hhmm): int
    {
        [$h, $m] = array_pad(explode(':', $hhmm), 2, '0');

        return ((int) $h) * 60 + (int) $m;
    }

    /**
     * Trials of the same teacher whose [start, start+duration) overlaps the candidate window.
     * Only still-SCHEDULED trials can clash (a cancelled/converted/past-outcome one cannot).
     *
     * @return list<array{id:string, scheduled_at_utc:string, duration_minutes:int}>
     */
    private function trialConflicts(string $teacherId, Carbon $startUtc, int $durationMinutes, ?string $excludeTrialId = null): array
    {
        $endUtc = $startUtc->copy()->addMinutes($durationMinutes);

        $candidates = DB::table('trials')
            ->where('teacher_id', $teacherId)
            ->where('status', 'SCHEDULED')
            ->whereNull('deleted_at')
            ->when($excludeTrialId !== null, fn ($q) => $q->where('id', '!=', $excludeTrialId))
            ->whereBetween('scheduled_at_utc', [
                $startUtc->copy()->subDay()->format('Y-m-d H:i:sP'),
                $endUtc->copy()->addDay()->format('Y-m-d H:i:sP'),
            ])
            ->get(['id', 'scheduled_at_utc', 'duration_minutes']);

        $conflicts = [];
        foreach ($candidates as $row) {
            $rowStart = Carbon::parse($row->scheduled_at_utc)->utc();
            $rowEnd = $rowStart->copy()->addMinutes((int) $row->duration_minutes);
            if ($startUtc->lessThan($rowEnd) && $rowStart->lessThan($endUtc)) {
                $conflicts[] = [
                    'id' => (string) $row->id,
                    'scheduled_at_utc' => $rowStart->toIso8601String(),
                    'duration_minutes' => (int) $row->duration_minutes,
                ];
            }
        }

        return $conflicts;
    }

    private function assertActiveTeacher(string $teacherId): void
    {
        if (DB::table('teachers')->where('id', $teacherId)->whereNull('deleted_at')->doesntExist()) {
            throw ValidationException::withMessages(['teacher_id' => ['Unknown or inactive teacher.']]);
        }
    }

    /**
     * Busy [start, end) UTC intervals per teacher across [from, to) — every booked session and
     * still-scheduled trial. Loaded once for the calendar grid so per-cell conflict checks are
     * pure in-memory comparisons (no query per slot).
     *
     * @param  list<string>  $teacherIds
     * @return array<string, list<array{0:Carbon,1:Carbon}>>
     */
    private function teacherBusyIntervals(array $teacherIds, Carbon $fromUtc, Carbon $toUtc): array
    {
        if ($teacherIds === []) {
            return [];
        }

        $from = $fromUtc->format('Y-m-d H:i:sP');
        $to = $toUtc->format('Y-m-d H:i:sP');

        $sessions = DB::table('sessions')
            ->whereIn('teacher_id', $teacherIds)
            ->whereIn('status', ['SCHEDULED', 'ATTENDED', 'FREE', 'ABSENT_UNEXCUSED', 'ABSENT_EXCUSED'])
            ->whereBetween('scheduled_at_utc', [$from, $to])
            ->get(['teacher_id', 'scheduled_at_utc', 'duration_minutes']);

        $trials = DB::table('trials')
            ->whereIn('teacher_id', $teacherIds)
            ->where('status', 'SCHEDULED')
            ->whereNull('deleted_at')
            ->whereBetween('scheduled_at_utc', [$from, $to])
            ->get(['teacher_id', 'scheduled_at_utc', 'duration_minutes']);

        $map = [];
        foreach ([$sessions, $trials] as $set) {
            foreach ($set as $row) {
                $s = Carbon::parse($row->scheduled_at_utc)->utc();
                $map[(string) $row->teacher_id][] = [$s, $s->copy()->addMinutes((int) $row->duration_minutes)];
            }
        }

        return $map;
    }

    /**
     * True when [start, start+duration) overlaps any of the teacher's busy intervals (half-open).
     *
     * @param  list<array{0:Carbon,1:Carbon}>  $intervals
     */
    private function overlapsBusy(array $intervals, Carbon $startUtc, int $durationMinutes): bool
    {
        $endUtc = $startUtc->copy()->addMinutes($durationMinutes);
        foreach ($intervals as [$busyStart, $busyEnd]) {
            if ($startUtc->lessThan($busyEnd) && $busyStart->lessThan($endUtc)) {
                return true;
            }
        }

        return false;
    }
}
