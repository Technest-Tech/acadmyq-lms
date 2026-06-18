<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Services\Whatsapp\WhatsAppSender;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Tenancy;
use App\Support\TenantContext;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Type 2 automation — lesson & trial reminders over WhatsApp. Hourly, for every academy with
 * `type2_lessons_enabled`, find upcoming SCHEDULED sessions starting within the lead window and
 * remind BOTH the student (guardian/student WhatsApp) and the teacher through the WhatsApp seam
 * (Wasender when a token is set, otherwise a deep link logged for manual follow-up).
 *
 * Idempotent per (session, recipient) via the send-log dedupe key; per-academy tenant-isolated.
 * The bilingual body is built inline so the "lesson"/"trial" word reads naturally in each language.
 */
final class LessonReminderJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    /** Remind for sessions starting within this many minutes of the run. */
    private const LEAD_MINUTES = 120;

    private const TRIAL_STATUSES = ['TRIAL', 'TRIAL_BOOKED'];

    public function __construct(private readonly ?string $onlyAcademyId = null) {}

    /**
     * @return array<string, int> academyId → number of reminders sent/queued
     */
    public function handle(WhatsAppSender $sender): array
    {
        $from = now();
        $to = now()->addMinutes(self::LEAD_MINUTES);

        $results = [];
        foreach ($this->targetAcademyIds() as $academyId) {
            $ctx = new AuthContext(
                userId: self::SYSTEM_USER_ID,
                academyId: $academyId,
                role: 'SUPER_ADMIN',
                permissions: [],
            );

            $results[$academyId] = Tenancy::withContext($ctx, fn () => $this->remindForAcademy($academyId, $from, $to, $sender));
        }

        return $results;
    }

    private function remindForAcademy(string $academyId, Carbon $from, Carbon $to, WhatsAppSender $sender): int
    {
        if (! DB::table('academy_automation_settings')->where('academy_id', $academyId)->where('type2_lessons_enabled', true)->exists()) {
            return 0;
        }

        $tz = (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?? 'UTC');

        $sessions = DB::table('sessions as se')
            ->join('students as st', 'st.id', '=', 'se.student_id')
            ->leftJoin('guardians as g', 'g.id', '=', 'st.guardian_id')
            ->leftJoin('teachers as te', 'te.id', '=', 'se.teacher_id')
            ->where('se.academy_id', $academyId)
            ->where('se.status', 'SCHEDULED')
            ->whereBetween('se.scheduled_at_utc', [$from->format('Y-m-d H:i:sP'), $to->format('Y-m-d H:i:sP')])
            ->get([
                'se.id', 'se.scheduled_at_utc',
                'st.full_name as student_name', 'st.status as student_status',
                DB::raw('coalesce(g.whatsapp_phone, st.whatsapp_phone) as student_phone'),
                'te.full_name as teacher_name', 'te.phone as teacher_phone', 'te.id as teacher_id',
            ]);

        $sent = 0;
        foreach ($sessions as $s) {
            $isTrial = in_array($s->student_status, self::TRIAL_STATUSES, true);
            $time = Carbon::parse($s->scheduled_at_utc)->setTimezone($tz)->format('Y-m-d H:i');
            $kindAr = $isTrial ? 'حصة تجريبية' : 'حصة';
            $kindEn = $isTrial ? 'trial' : 'lesson';

            // Reminder to the student/guardian.
            if ((string) ($s->student_phone ?? '') !== '') {
                $msg = implode("\n\n", [
                    "تذكير: لديك {$kindAr} مع {$s->teacher_name} الساعة {$time}.",
                    "Reminder: you have a {$kindEn} with {$s->teacher_name} at {$time}.",
                ]);
                $res = $sender->sendOrLink($academyId, (string) $s->student_phone, $msg, [
                    'automation_type' => 'TYPE2_LESSON',
                    'recipient_kind' => 'STUDENT',
                    'ref_type' => 'session',
                    'ref_id' => $s->id,
                    'dedupe_key' => "type2:{$s->id}:student",
                ]);
                if (! $res['duplicate']) {
                    $sent++;
                }
            }

            // Reminder to the teacher.
            if ((string) ($s->teacher_phone ?? '') !== '') {
                $msg = implode("\n\n", [
                    "تذكير: لديك {$kindAr} مع {$s->student_name} الساعة {$time}.",
                    "Reminder: you have a {$kindEn} with {$s->student_name} at {$time}.",
                ]);
                $res = $sender->sendOrLink($academyId, (string) $s->teacher_phone, $msg, [
                    'automation_type' => 'TYPE2_LESSON',
                    'recipient_kind' => 'TEACHER',
                    'recipient_id' => (string) $s->teacher_id,
                    'ref_type' => 'session',
                    'ref_id' => $s->id,
                    'dedupe_key' => "type2:{$s->id}:teacher",
                ]);
                if (! $res['duplicate']) {
                    $sent++;
                }
            }
        }

        if ($sent > 0) {
            Audit::log('automation.send', 'academy', $academyId, $academyId, null, 'SUPER_ADMIN', after: [
                'type' => 'TYPE2_LESSON', 'count' => $sent,
            ]);
        }

        return $sent;
    }

    /** @return list<string> */
    private function targetAcademyIds(): array
    {
        if ($this->onlyAcademyId !== null) {
            return [$this->onlyAcademyId];
        }

        TenantContext::apply(userId: self::SYSTEM_USER_ID, academyId: null, role: 'SUPER_ADMIN', local: false);
        try {
            return DB::table('academies')
                ->whereIn('status', ['ACTIVE', 'TRIAL'])
                ->pluck('id')
                ->map(fn ($id) => (string) $id)
                ->all();
        } finally {
            TenantContext::clear();
        }
    }
}
