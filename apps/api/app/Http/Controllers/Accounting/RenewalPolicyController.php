<?php

declare(strict_types=1);

namespace App\Http\Controllers\Accounting;

use App\Http\Controllers\Controller;
use App\Services\RenewalPolicy;
use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * A family's renewal policy (RenewalPolicy): renew freely, or pay first. Set on the family card for
 * the whole family, or on a student's profile for that student alone (a self-guardian, or one
 * child); either saying PAY_FIRST holds the student. Relaxing it releases what it held back.
 *
 *   PATCH /accounting/family/{guardianId}/renewal-policy   { policy }
 *   GET   /accounting/students/{studentId}/renewal-policy
 *   PATCH /accounting/students/{studentId}/renewal-policy  { policy }
 *
 * Behind `entitled:accounting`. Reading is `invoice.read`, changing it `invoice.mark_paid` — the
 * family card's other money decisions (discounts, notes) sit on the same one.
 */
final class RenewalPolicyController extends Controller
{
    public function __construct(private readonly RenewalPolicy $policy) {}

    public function updateFamily(Request $request, string $guardianId): JsonResponse
    {
        Gate::authorize('invoice.mark_paid');
        $data = $request->validate(['policy' => ['required', Rule::in(RenewalPolicy::POLICIES)]]);
        $before = DB::table('guardians')->where('id', $guardianId)->value('renewal_policy');
        if ($before === null) {
            abort(404, 'Family not found.');
        }

        DB::table('guardians')->where('id', $guardianId)->update(['renewal_policy' => $data['policy'], 'updated_at' => now()]);
        $this->audit('guardian', $guardianId, (string) $before, $data['policy']);
        $this->releaseIfRelaxed($data['policy'], RenewalPolicy::studentsOf(['guardian_id' => $guardianId]));

        return response()->json(['policy' => $data['policy']]);
    }

    public function showStudent(string $studentId): JsonResponse
    {
        Gate::authorize('invoice.read');

        return response()->json($this->studentState($studentId));
    }

    public function updateStudent(Request $request, string $studentId): JsonResponse
    {
        Gate::authorize('invoice.mark_paid');
        $data = $request->validate(['policy' => ['required', Rule::in(RenewalPolicy::POLICIES)]]);
        $before = $this->studentState($studentId)['policy'];

        DB::table('students')->where('id', $studentId)->update(['renewal_policy' => $data['policy'], 'updated_at' => now()]);
        $this->audit('student', $studentId, $before, $data['policy']);
        $this->releaseIfRelaxed($data['policy'], [$studentId]);

        return response()->json($this->studentState($studentId));
    }

    /** @return array{policy: string, family_policy: ?string, guardian_id: ?string, effective: string} */
    private function studentState(string $studentId): array
    {
        $row = DB::table('students as s')
            ->leftJoin('guardians as g', 'g.id', '=', 's.guardian_id')
            ->where('s.id', $studentId)
            ->first(['s.renewal_policy', 's.guardian_id', 'g.renewal_policy as family_policy']);
        if ($row === null) {
            abort(404, 'Student not found.');
        }

        return [
            'policy' => (string) $row->renewal_policy,
            'family_policy' => $row->family_policy !== null ? (string) $row->family_policy : null,
            'guardian_id' => $row->guardian_id !== null ? (string) $row->guardian_id : null,
            'effective' => $row->renewal_policy === RenewalPolicy::PAY_FIRST || $row->family_policy === RenewalPolicy::PAY_FIRST
                ? RenewalPolicy::PAY_FIRST
                : RenewalPolicy::FREE,
        ];
    }

    /** @param  list<string>  $studentIds */
    private function releaseIfRelaxed(string $policy, array $studentIds): void
    {
        if ($policy === RenewalPolicy::FREE) {
            $ctx = app(AuthContext::class);
            $this->policy->release((string) $ctx->academyId, $studentIds, $ctx->userId, $ctx->role);
        }
    }

    private function audit(string $entity, string $id, string $before, string $after): void
    {
        $ctx = app(AuthContext::class);
        Audit::log('accounting.renewal_policy_changed', $entity, $id, (string) $ctx->academyId, $ctx->userId, $ctx->role,
            after: ['renewal_policy' => $after], before: ['renewal_policy' => $before]);
    }
}
