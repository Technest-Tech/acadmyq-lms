<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The one writer for the `trials` table — the trial a prospect sits in before they are a student.
 * Two surfaces book one: the CRM (moving a lead into the TRIAL stage) and the Trials module's own
 * POST /api/trials. Keeping the insert here means both produce identical rows, and the identity
 * rules ("who is this trial for?") are stated once:
 *
 *   • an existing STUDENT (student_id), or
 *   • a CRM LEAD (lead_id — the lead row IS the contact record), or
 *   • an inline prospect captured on the spot (lead_name + lead_whatsapp).
 *
 * The DB's `trials_identity_chk` is the backstop on exactly that set; this class fails first, with
 * a field-keyed 422 a form can render.
 *
 * A trial is deliberately NOT a `sessions` row: a lead has no student_id, and sessions require
 * one. The calendar reads both feeds instead (see CalendarController), so a booked trial shows up
 * next to the lessons without inventing a phantom student.
 */
final class TrialBooking
{
    /**
     * Insert one SCHEDULED trial and audit it; returns the new trial id.
     *
     * @param  array{
     *     teacher_id: string,
     *     student_id?: string|null,
     *     lead_id?: string|null,
     *     lead_name?: string|null,
     *     lead_whatsapp?: string|null,
     *     lead_email?: string|null,
     *     timezone: string,
     *     duration_minutes: int,
     *     outcome_notes?: string|null,
     * }  $data
     */
    public static function book(
        string $academyId,
        array $data,
        Carbon $startUtc,
        ?string $userId,
        ?string $role,
    ): string {
        $teacherId = (string) $data['teacher_id'];
        if (DB::table('teachers')->where('id', $teacherId)->whereNull('deleted_at')->doesntExist()) {
            throw ValidationException::withMessages(['teacher_id' => ['Unknown or inactive teacher.']]);
        }

        $studentId = $data['student_id'] ?? null;
        $leadId = $data['lead_id'] ?? null;
        $leadName = $leadWhatsapp = $leadEmail = null;

        if ($studentId !== null) {
            if (DB::table('students')->where('id', $studentId)->whereNull('deleted_at')->doesntExist()) {
                throw ValidationException::withMessages(['student_id' => ['Unknown or inactive student.']]);
            }
        } else {
            // A trial for someone who is not a student yet: their contact details travel with the
            // trial so the trials page and the teacher can read it without joining the CRM.
            $leadName = trim((string) ($data['lead_name'] ?? ''));
            $leadWhatsapp = Phone::normalize($data['lead_whatsapp'] ?? null, 'lead_whatsapp');
            $leadEmail = $data['lead_email'] ?? null;
            $leadName = $leadName === '' ? null : $leadName;

            // Only an INLINE prospect must hand over a phone number — a CRM lead is already a
            // contact record, and demanding a number it may not hold would block the stage move.
            if ($leadId === null && ($leadName === null || $leadWhatsapp === null)) {
                throw ValidationException::withMessages([
                    'lead_name' => ['Pick an existing student, or give the new lead a name and WhatsApp number.'],
                ]);
            }
        }

        $trialId = (string) Str::uuid();
        $duration = (int) $data['duration_minutes'];

        DB::table('trials')->insert([
            'id' => $trialId,
            'academy_id' => $academyId,
            'teacher_id' => $teacherId,
            'student_id' => $studentId,
            'lead_id' => $leadId,
            'lead_name' => $leadName,
            'lead_whatsapp' => $leadWhatsapp,
            'lead_email' => $leadEmail,
            'timezone' => $data['timezone'],
            'scheduled_at_utc' => $startUtc->format('Y-m-d H:i:sP'),
            'duration_minutes' => $duration,
            'status' => 'SCHEDULED',
            'outcome_notes' => $data['outcome_notes'] ?? null,
        ]);

        Audit::log('trial.create', 'trial', $trialId, $academyId, $userId, $role, after: [
            'teacher_id' => $teacherId,
            'student_id' => $studentId,
            'lead_id' => $leadId,
            'lead' => $leadName,
            'scheduled_at_utc' => $startUtc->toIso8601String(),
            'duration_minutes' => $duration,
        ]);

        return $trialId;
    }
}
