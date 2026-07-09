<?php

declare(strict_types=1);

namespace App\Support;

/**
 * The canonical RBAC capability catalog (Sprint 2 §5.3) and the default role → capability
 * mapping (§5.4). This is the *seed source* for the SYSTEM roles only — at runtime
 * authorization is resolved from the tables via PermissionResolver (system roles from
 * `role_permissions`, per-academy custom roles from `academy_role_permissions`), so a new
 * role or a re-mapping is a data change, never a code change (Master Spec §4 design note).
 */
final class PermissionCatalog
{
    /** Every capability code the platform recognises (§5.3). */
    public const PERMISSIONS = [
        'academy.create', 'academy.suspend', 'academy.configure', 'academy.enter', 'academy.read',
        'plan.manage',
        // Platform↔Academy subscription billing + per-academy WhatsApp automation (Super-Admin only).
        'academy_billing.manage', 'automation.manage',
        'user.invite', 'role.assign', 'user.read_platform',
        // Create/edit/delete an academy's own CUSTOM roles and assign them (academy_roles).
        'role.manage',
        'platform.manage',
        'teacher.read', 'teacher.read_own', 'teacher.create', 'teacher.update', 'teacher.deactivate',
        'guardian.read', 'guardian.create', 'guardian.update',
        'student.read', 'student.create', 'student.update', 'student.deactivate',
        'schedule.read', 'schedule.manage',
        'session.read', 'session.mark_attendance', 'session.write_report',
        'session.reschedule', 'session.cancel',
        'session.cancel_request', 'session.cancel_approve',
        // Mark a lesson FREE. Like a cancellation, the per-academy billing decision (charge the
        // student? pay the teacher?) is made in a popup, and a TEACHER cannot apply it directly —
        // they raise a request (session.free_request) the OWNER approves (session.free_approve).
        'session.free', 'session.free_request', 'session.free_approve',
        'trial.read', 'trial.manage',
        'notification.read',
        'invoice.read', 'invoice.create', 'invoice.close', 'invoice.mark_paid', 'invoice.send_link',
        'payout.read', 'payout.read_own', 'payout.finalize', 'payout.adjust',
        'report_field.manage',
        'specialization.manage',
        'payment_settings.manage',
        'teacher_report.manage',
        'student_report.submit', 'student_report.review',
        'certificate.read', 'certificate.manage',
        'audit.read',
        'staff.read', 'staff.create', 'staff.update', 'staff.deactivate',
        'staff_department.manage',
        // Video classroom (docs/video-platform). The academy OWNS the room (V-CTL-1): owners
        // create/manage rooms and recordings; teachers join. Gated by the `video.conferencing`
        // entitlement on top of these RBAC capabilities. `room.monitor` = enter supervisor (ghost)
        // mode to silently observe + record a session for quality & safety (08-ROOM-ACCESS §5).
        'room.read', 'room.create', 'room.join', 'room.manage', 'recording.view', 'room.monitor',
    ];

    /**
     * Default role → capability mapping (§5.4).
     *
     * @return array<string, list<string>>
     */
    public static function roleMap(): array
    {
        $academyScoped = [
            'user.invite', 'role.assign', 'role.manage',
            'teacher.read', 'teacher.create', 'teacher.update', 'teacher.deactivate',
            'guardian.read', 'guardian.create', 'guardian.update',
            'student.read', 'student.create', 'student.update', 'student.deactivate',
            'schedule.read', 'schedule.manage',
            'session.read', 'session.mark_attendance', 'session.write_report',
            'session.reschedule', 'session.cancel', 'session.cancel_approve',
            // Mark free directly (with the billing popup) + approve teachers' free requests.
            'session.free', 'session.free_approve',
            'trial.read', 'trial.manage',
            'notification.read',
            'invoice.read', 'invoice.create', 'invoice.close', 'invoice.mark_paid', 'invoice.send_link',
            'payout.read', 'payout.finalize', 'payout.adjust',
            'report_field.manage',
            'specialization.manage',
            'payment_settings.manage',
            'teacher_report.manage',
            'student_report.review',
            'certificate.read', 'certificate.manage',
            'audit.read',
            'staff.read', 'staff.create', 'staff.update', 'staff.deactivate',
            // Video classroom — the owner provisions/manages rooms and views recordings (V-CTL-1),
            // and may enter supervisor (monitor) mode. Composable into a custom management role.
            'room.read', 'room.create', 'room.join', 'room.manage', 'recording.view', 'room.monitor',
        ];

        return [
            // Platform capabilities + the ability to act within an entered academy.
            // Onboarding (Sprint 3) is Super-Admin-only: provisioning the first owner login
            // (user.invite) and seeding/editing an academy's report fields
            // (report_field.manage) are platform actions the Super Admin performs in the new
            // academy's context (§3.4, §4.2, §7).
            'SUPER_ADMIN' => [
                'academy.create', 'academy.suspend', 'academy.configure', 'academy.enter', 'academy.read',
                'plan.manage', 'academy_billing.manage', 'automation.manage',
                'user.invite', 'role.assign', 'role.manage', 'user.read_platform', 'platform.manage', 'report_field.manage', 'specialization.manage', 'teacher_report.manage', 'audit.read',
                'staff_department.manage',
            ],
            // All academy-scoped capabilities, never the platform ones.
            'ACADEMY_OWNER' => $academyScoped,
            // Own schedule / sessions / students, their own teacher record, and their own
            // payout only. `student.read` is row-filtered to assigned students and
            // `teacher.read_own` to their own teacher row at the controller layer (§3.6).
            // A Teacher no longer cancels a class directly — they raise a cancellation REQUEST
            // (session.cancel_request) the Owner must approve (Notifications page). The
            // Notifications page itself is OWNER-only: a Teacher has no notification.read, so the
            // page, its sidebar link, and every notification/cancellation-queue endpoint are out
            // of reach for them.
            'TEACHER' => [
                'schedule.read',
                'session.read', 'session.mark_attendance', 'session.write_report',
                'session.reschedule', 'session.cancel_request',
                // A teacher cannot mark a lesson free directly (the academy's free-lesson billing
                // logic differs) — they raise a request the Owner approves (like a cancellation).
                'session.free_request',
                'student.read',
                'teacher.read_own',
                'payout.read_own',
                // Write monthly progress reports about their own students and submit them for the
                // Owner to review on the Notifications page (the Owner holds student_report.review).
                'student_report.submit',
                // Video classroom — a teacher JOINS their class and views its recordings, but does
                // not create/manage rooms (the academy owns the room, V-CTL-1).
                'room.read', 'room.join', 'recording.view',
            ],
            // Non-teaching staff baseline (reception/admin desk). Deliberately MINIMAL and
            // read-only: enough to see who's enrolled and the day's schedule. Anything beyond
            // this is delegated through a CUSTOM role the academy builds (academy_roles),
            // composed from the Owner's own capability set. Never includes platform caps.
            'STAFF' => [
                'student.read',
                'guardian.read',
                'schedule.read',
                'session.read',
            ],
        ];
    }
}
