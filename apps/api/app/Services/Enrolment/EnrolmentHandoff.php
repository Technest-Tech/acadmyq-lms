<?php

declare(strict_types=1);

namespace App\Services\Enrolment;

use App\Support\Audit;
use Illuminate\Support\Facades\DB;

/**
 * Where an enrolment request's story is finished by something that happened elsewhere.
 *
 * The staff book a placement lesson from the inbox — that is a `trials` row, made through the same
 * TrialBooking the trials board uses — and later convert that trial to a student on the trials
 * board (TrialController::convert), which is the existing flow and knows nothing of this inbox.
 * The one call it makes here closes the loop: the request that booked the trial becomes ENROLLED
 * and points at the student. No request behind the trial ⇒ nothing happens, so a Quran academy's
 * conversions, and a centre's walk-in trials, run exactly as before.
 */
final class EnrolmentHandoff
{
    public function trialConverted(string $trialId, string $studentId, ?string $userId, ?string $role): void
    {
        $rows = DB::table('enrolment_requests')
            ->where('trial_id', $trialId)
            ->where('status', '<>', 'ENROLLED')
            ->get(['id', 'academy_id', 'status']);

        foreach ($rows as $row) {
            DB::table('enrolment_requests')->where('id', $row->id)->update([
                'student_id' => $studentId,
                'status' => 'ENROLLED',
                'status_changed_at' => now(),
                'handled_by' => $userId !== null && $userId !== '' ? $userId : null,
                'updated_at' => now(),
            ]);
            Audit::log('enrolment.request_enrolled', 'enrolment_request', (string) $row->id, (string) $row->academy_id, $userId, $role,
                after: ['status' => 'ENROLLED', 'student_id' => $studentId, 'trial_id' => $trialId],
                before: ['status' => $row->status]);
        }
    }
}
