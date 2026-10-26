<?php

declare(strict_types=1);

use App\Support\Audit;
use App\Support\TenantContext;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Every academy's supervisors enrol people in full — including the ones on a CUSTOM role.
 *
 * The built-in SUPERVISOR already got the money fields of the people it enrols (2026_10_26_100001):
 * a student's price and packages, a teacher's pay and first sign-in. A custom role made from the
 * "New supervisor" preset is a snapshot, so it never received them, and its supervisors still could
 * not finish a student's subscription or a teacher's salary (Ahmed, 2026-10-27: "insure the
 * supervisor role at all the academies can add the student with its subscription and the teachers
 * with their salaries").
 *
 * A role does not remember which preset it came from, so a custom role counts as a supervisor role
 * by its NAME (مشرف / supervisor, any case). It gets only what matches what it can already do:
 *   can add students  (student.create)  → student.set_price, package.read, package.manage
 *   can add teachers  (teacher.create)  → teacher.set_pay, teacher.create_login
 * Invoices, receipts, payroll and staff salaries stay where they were. Each role changed gets a
 * `role.update` audit row and a line in the migrate output.
 */
return new class extends Migration
{
    private const BY_ABILITY = [
        'student.create' => ['student.set_price', 'package.read', 'package.manage'],
        'teacher.create' => ['teacher.set_pay', 'teacher.create_login'],
    ];

    public function up(): void
    {
        TenantContext::apply(userId: null, academyId: null, role: 'SUPER_ADMIN', local: false);

        try {
            $ids = DB::table('permissions')->pluck('id', 'code');

            foreach (DB::table('academies')->pluck('id')->all() as $academyId) {
                DB::statement("select set_config('app.current_academy_id', ?, false)", [(string) $academyId]);

                $roles = DB::table('academy_roles')
                    ->where('academy_id', $academyId)
                    ->where(fn ($q) => $q->where('name', 'like', '%مشرف%')->orWhere('name', 'ilike', '%supervisor%'))
                    ->get(['id', 'name']);

                foreach ($roles as $role) {
                    $held = DB::table('academy_role_permissions as rp')
                        ->join('permissions as p', 'p.id', '=', 'rp.permission_id')
                        ->where('rp.role_id', $role->id)
                        ->pluck('p.code')
                        ->all();

                    $grant = [];
                    foreach (self::BY_ABILITY as $ability => $codes) {
                        if (in_array($ability, $held, true)) {
                            $grant = array_merge($grant, array_diff($codes, $held));
                        }
                    }
                    $grant = array_values(array_unique(array_filter($grant, fn ($c) => isset($ids[$c]))));
                    if ($grant === []) {
                        continue;
                    }

                    foreach ($grant as $code) {
                        DB::table('academy_role_permissions')->updateOrInsert(
                            ['role_id' => $role->id, 'permission_id' => $ids[$code]],
                            ['academy_id' => $academyId],
                        );
                    }

                    Audit::log('role.update', 'role', (string) $role->id, (string) $academyId, null, 'SUPER_ADMIN',
                        after: ['granted' => $grant, 'reason' => 'custom supervisors enrol in full'],
                        before: ['permissions' => count($held)]);
                    fwrite(STDOUT, "  supervisor role \"{$role->name}\" ({$academyId}): +".implode(', ', $grant)."\n");
                }
            }
            DB::statement("select set_config('app.current_academy_id', '', false)");
        } finally {
            TenantContext::clear();
        }
    }

    public function down(): void
    {
        // Grants are left in place: removing them could take away what an owner later chose to keep.
    }
};
