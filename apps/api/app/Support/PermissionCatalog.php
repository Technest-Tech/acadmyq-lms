<?php

declare(strict_types=1);

namespace App\Support;

/**
 * The canonical RBAC capability catalog (Sprint 2 §5.3) and the default role → capability
 * mapping (§5.4). This is the *seed source* only — at runtime authorization is resolved
 * purely from the `permissions` / `role_permissions` tables (PermissionResolver), so a new
 * role or a re-mapping is a data change, never a code change (Master Spec §4 design note).
 */
final class PermissionCatalog
{
    /** Every capability code the platform recognises (§5.3). */
    public const PERMISSIONS = [
        'academy.create', 'academy.suspend', 'academy.configure', 'academy.enter', 'academy.read',
        'plan.manage',
        'user.invite', 'role.assign',
        'teacher.read', 'teacher.read_own', 'teacher.create', 'teacher.update', 'teacher.deactivate',
        'guardian.read', 'guardian.create', 'guardian.update',
        'student.read', 'student.create', 'student.update', 'student.deactivate',
        'schedule.read', 'schedule.manage',
        'session.read', 'session.mark_attendance', 'session.write_report',
        'session.reschedule', 'session.cancel',
        'invoice.read', 'invoice.close', 'invoice.mark_paid', 'invoice.send_link',
        'payout.read', 'payout.read_own',
        'report_field.manage',
        'audit.read',
    ];

    /**
     * Default role → capability mapping (§5.4).
     *
     * @return array<string, list<string>>
     */
    public static function roleMap(): array
    {
        $academyScoped = [
            'user.invite', 'role.assign',
            'teacher.read', 'teacher.create', 'teacher.update', 'teacher.deactivate',
            'guardian.read', 'guardian.create', 'guardian.update',
            'student.read', 'student.create', 'student.update', 'student.deactivate',
            'schedule.read', 'schedule.manage',
            'session.read', 'session.mark_attendance', 'session.write_report',
            'session.reschedule', 'session.cancel',
            'invoice.read', 'invoice.close', 'invoice.mark_paid', 'invoice.send_link',
            'payout.read',
            'report_field.manage',
            'audit.read',
        ];

        return [
            // Platform capabilities + the ability to act within an entered academy.
            // Onboarding (Sprint 3) is Super-Admin-only: provisioning the first owner login
            // (user.invite) and seeding/editing an academy's report fields
            // (report_field.manage) are platform actions the Super Admin performs in the new
            // academy's context (§3.4, §4.2, §7).
            'SUPER_ADMIN' => [
                'academy.create', 'academy.suspend', 'academy.configure', 'academy.enter', 'academy.read',
                'plan.manage', 'user.invite', 'role.assign', 'report_field.manage', 'audit.read',
            ],
            // All academy-scoped capabilities, never the platform ones.
            'ACADEMY_OWNER' => $academyScoped,
            // Own schedule / sessions / students, their own teacher record, and their own
            // payout only. `student.read` is row-filtered to assigned students and
            // `teacher.read_own` to their own teacher row at the controller layer (§3.6).
            'TEACHER' => [
                'schedule.read',
                'session.read', 'session.mark_attendance', 'session.write_report',
                'session.reschedule', 'session.cancel',
                'student.read',
                'teacher.read_own',
                'payout.read_own',
            ],
        ];
    }
}
